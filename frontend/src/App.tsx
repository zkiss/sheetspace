import {
  FormEvent,
  MouseEvent,
  PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  WheelEvent,
} from 'react';
import './App.css';
import { WorkbookApiError, workbookApi, type WorkbookApi } from './workbookApi';
import {
  appendColumn,
  appendRow,
  cellKey,
  commitCellRawContent,
  createEmptyWorkbook,
  createSheet,
  evaluateFormulaCells,
  moveSheetZOrder,
  parseA1Address,
  renameSheet,
  type SheetZOrderDirection,
  type CellAddress,
  type Sheet,
  type SheetFrameSize,
  type Workbook,
  type WorkspacePosition,
} from './workbook';
import {
  type ActiveCellSelection,
  type CellNavigationDirection,
  type EditingCell,
  type PendingSheetCreation,
  type PendingSheetMenu,
  type PendingSheetRename,
  type SaveStatus,
  type SheetFrameDrag,
  type SheetFrameResize,
  type SheetFrameResizeDirection,
  type StartupLoadState,
  type WorkspaceViewport,
} from './appTypes';
import { CreateSheetDialog, RenameSheetDialog } from './SheetDialogs';
import { SheetContextMenu } from './SheetContextMenu';
import { SheetGrid } from './SheetGrid';
import { StartupErrorScreen, StartupLoadingScreen } from './StartupScreen';
import { WorkspaceToolbar } from './WorkspaceToolbar';
import {
  clampSheetFrameSize,
  clampWorkspaceZoom,
  getViewportCenter,
  getWorkspacePoint,
  resizeSheetFrame,
  WORKSPACE_ZOOM_STEP,
} from './workspaceGeometry';

const SHEET_FRAME_RESIZE_HANDLES: [string, SheetFrameResizeDirection][] = [
  ['top', { horizontal: 0, vertical: -1 }],
  ['right', { horizontal: 1, vertical: 0 }],
  ['bottom', { horizontal: 0, vertical: 1 }],
  ['left', { horizontal: -1, vertical: 0 }],
  ['top-left', { horizontal: -1, vertical: -1 }],
  ['top-right', { horizontal: 1, vertical: -1 }],
  ['bottom-right', { horizontal: 1, vertical: 1 }],
  ['bottom-left', { horizontal: -1, vertical: 1 }],
];

type AppProps = {
  apiClient?: Partial<WorkbookApi>;
  initialWorkbook?: Workbook;
};

type AutosaveTask = {
  key: string;
  run: () => Promise<Workbook>;
};

type AutosaveQueue = {
  running: AutosaveTask | null;
  queued: AutosaveTask | null;
};

function validationMessage(reason: 'empty' | 'duplicate' | 'unknown-sheet') {
  if (reason === 'empty') {
    return 'Sheet name is required.';
  }

  if (reason === 'unknown-sheet') {
    return 'The target sheet could not be found.';
  }

  return 'A sheet with that name already exists.';
}

export function App({ apiClient, initialWorkbook }: AppProps = {}) {
  const resolvedApiClient = apiClient ?? workbookApi;
  const autosaveEnabled = !initialWorkbook || Boolean(apiClient);
  const [workbook, setWorkbook] = useState<Workbook>(() => initialWorkbook ?? createEmptyWorkbook());
  const [startupLoad, setStartupLoad] = useState<StartupLoadState>(
    initialWorkbook ? { status: 'loaded' } : { status: 'loading' },
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [viewport, setViewport] = useState<WorkspaceViewport>({ x: 0, y: 0, scale: 1 });
  const [pendingCreation, setPendingCreation] = useState<PendingSheetCreation | null>(null);
  const [pendingRename, setPendingRename] = useState<PendingSheetRename | null>(null);
  const [pendingSheetMenu, setPendingSheetMenu] = useState<PendingSheetMenu | null>(null);
  const [activeCell, setActiveCell] = useState<ActiveCellSelection | null>(null);
  const [keyboardFocusTarget, setKeyboardFocusTarget] = useState<ActiveCellSelection | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [isPanningWorkspace, setIsPanningWorkspace] = useState(false);
  const [sheetName, setSheetName] = useState('');
  const [error, setError] = useState('');
  const panDrag = useRef<{ pointerId: number; clientX: number; clientY: number } | null>(null);
  const sheetFrameDrag = useRef<SheetFrameDrag | null>(null);
  const sheetFrameResize = useRef<SheetFrameResize | null>(null);
  const tabRunOriginColumn = useRef<number | null>(null);
  const autosaveQueues = useRef(new Map<string, AutosaveQueue>());
  const failedAutosaveKeys = useRef(new Set<string>());
  const formulaResults = useMemo(() => evaluateFormulaCells(workbook), [workbook]);

  useEffect(() => {
    if (initialWorkbook || startupLoad.status !== 'loading') {
      return;
    }

    let active = true;

    const loadWorkbook = resolvedApiClient.loadWorkbook ?? workbookApi.loadWorkbook;

    loadWorkbook()
      .then((loadedWorkbook) => {
        if (!active) {
          return;
        }

        setWorkbook(loadedWorkbook);
        setStartupLoad({ status: 'loaded' });
        setSaveStatus('saved');
      })
      .catch((cause: unknown) => {
        if (!active) {
          return;
        }

        const message = cause instanceof Error ? cause.message : 'Workbook could not be loaded.';
        setStartupLoad({
          status: 'error',
          message,
        });
      });

    return () => {
      active = false;
    };
  }, [resolvedApiClient, initialWorkbook, startupLoad.status]);

  function hasPendingAutosaves() {
    for (const queue of autosaveQueues.current.values()) {
      if (queue.running || queue.queued) {
        return true;
      }
    }

    return false;
  }

  function refreshSaveStatus() {
    if (failedAutosaveKeys.current.size > 0) {
      setSaveStatus('failed');
      return;
    }

    setSaveStatus(hasPendingAutosaves() ? 'saving' : 'saved');
  }

  function startAutosaveTask(queue: AutosaveQueue, task: AutosaveTask) {
    queue.running = task;
    task
      .run()
      .then((savedWorkbook) => {
        mergeSheetRevisions(savedWorkbook);
      })
      .catch(() => {
        if (!queue.queued) {
          failedAutosaveKeys.current.add(task.key);
        }
      })
      .finally(() => {
        const nextTask = queue.queued;
        queue.running = null;
        queue.queued = null;

        if (nextTask) {
          startAutosaveTask(queue, nextTask);
          return;
        }

        autosaveQueues.current.delete(task.key);
        refreshSaveStatus();
      });
  }

  function enqueueAutosave(key: string, run: () => Promise<Workbook>) {
    if (!autosaveEnabled) {
      return;
    }

    const task = {
      key,
      run,
    };
    failedAutosaveKeys.current.delete(key);

    const queue = autosaveQueues.current.get(key) ?? { running: null, queued: null };
    autosaveQueues.current.set(key, queue);

    if (queue.running) {
      queue.queued = task;
      refreshSaveStatus();
      return;
    }

    startAutosaveTask(queue, task);
    refreshSaveStatus();
  }

  function getApiMethod<K extends keyof WorkbookApi>(method: K): WorkbookApi[K] {
    return resolvedApiClient[method] ?? workbookApi[method];
  }

  function currentSheetRevision(sheetId: string) {
    return workbook.sheets.find((sheet) => sheet.id === sheetId)?.revision;
  }

  function mergeSheetRevisions(savedWorkbook: Workbook) {
    setWorkbook((currentWorkbook) => ({
      ...currentWorkbook,
      sheets: currentWorkbook.sheets.map((sheet) => {
        const savedSheet = savedWorkbook.sheets.find((candidate) => candidate.id === sheet.id);
        return savedSheet ? { ...sheet, revision: Math.max(sheet.revision, savedSheet.revision) } : sheet;
      }),
    }));
  }

  function runRevisionedAutosave(sheetId: string, save: (revision: number | undefined) => Promise<Workbook>) {
    const loadWorkbook = resolvedApiClient.loadWorkbook ?? workbookApi.loadWorkbook;
    const startingRevision = currentSheetRevision(sheetId);

    return save(startingRevision).catch(async (cause: unknown) => {
      if (!(cause instanceof WorkbookApiError) || cause.status !== 409 || cause.code !== 'sheet-revision-conflict') {
        throw cause;
      }

      const latestWorkbook = await loadWorkbook();
      const latestRevision = latestWorkbook.sheets.find((sheet) => sheet.id === sheetId)?.revision;
      mergeSheetRevisions(latestWorkbook);
      return save(latestRevision);
    });
  }

  function commitActiveEdit(editToCommit = editingCell) {
    if (!editToCommit) {
      return;
    }

    const currentSheet = workbook.sheets.find((sheet) => sheet.id === editToCommit.sheetId);
    const currentRaw = currentSheet?.cells[editToCommit.cellKey]?.raw ?? '';
    const nextWorkbook = commitCellRawContent(workbook, editToCommit.sheetId, editToCommit.cellKey, editToCommit.value);

    if (nextWorkbook !== workbook) {
      setWorkbook(nextWorkbook);
    }
    if (nextWorkbook !== workbook && currentRaw !== editToCommit.value) {
      enqueueAutosave(`cell:${editToCommit.sheetId}:${editToCommit.cellKey}`, () =>
        runRevisionedAutosave(editToCommit.sheetId, (revision) =>
          getApiMethod('updateCellContent')(editToCommit.sheetId, editToCommit.cellKey, editToCommit.value, {
            revision,
          }),
        ),
      );
    }
    setEditingCell(null);
  }

  function startEditingCell(selection: ActiveCellSelection, initialValue?: string) {
    const sheet = workbook.sheets.find((candidate) => candidate.id === selection.sheetId);
    const value = initialValue ?? sheet?.cells[selection.cellKey]?.raw ?? '';

    setActiveCell(selection);
    setEditingCell({
      ...selection,
      value,
    });
  }

  function cancelActiveEdit() {
    if (editingCell) {
      setKeyboardFocusTarget({ sheetId: editingCell.sheetId, cellKey: editingCell.cellKey });
    }
    setEditingCell(null);
  }

  function selectCell(selection: ActiveCellSelection) {
    if (selection.sheetId !== activeCell?.sheetId || selection.cellKey !== activeCell.cellKey) {
      tabRunOriginColumn.current = null;
    }
    setKeyboardFocusTarget(null);
    setActiveCell(selection);
  }

  function clampedCellAddress(
    sheet: Sheet,
    address: CellAddress,
    delta: { columnIndex: number; rowIndex: number },
  ): CellAddress {
    return {
      columnIndex: Math.min(sheet.columnCount - 1, Math.max(0, address.columnIndex + delta.columnIndex)),
      rowIndex: Math.min(sheet.rowCount - 1, Math.max(0, address.rowIndex + delta.rowIndex)),
    };
  }

  function navigateCell(sheet: Sheet, currentCellKey: string, direction: CellNavigationDirection) {
    const parsedAddress = parseA1Address(currentCellKey, sheet);
    if (!parsedAddress.ok) {
      return;
    }

    const directionDelta = {
      left: { columnIndex: -1, rowIndex: 0 },
      right: { columnIndex: 1, rowIndex: 0 },
      up: { columnIndex: 0, rowIndex: -1 },
      down: { columnIndex: 0, rowIndex: 1 },
    } satisfies Record<CellNavigationDirection, { columnIndex: number; rowIndex: number }>;
    const nextAddress = clampedCellAddress(sheet, parsedAddress.value, directionDelta[direction]);

    tabRunOriginColumn.current = null;
    const nextSelection = { sheetId: sheet.id, cellKey: cellKey(nextAddress) };
    setActiveCell(nextSelection);
    setKeyboardFocusTarget(nextSelection);
  }

  function commitEditAndNavigate(editToCommit: EditingCell, direction: 'tab' | 'enter') {
    const sheet = workbook.sheets.find((candidate) => candidate.id === editToCommit.sheetId);
    if (!sheet) {
      commitActiveEdit(editToCommit);
      return;
    }

    const parsedAddress = parseA1Address(editToCommit.cellKey, sheet);
    if (!parsedAddress.ok) {
      commitActiveEdit(editToCommit);
      return;
    }

    commitActiveEdit(editToCommit);

    if (direction === 'tab') {
      if (tabRunOriginColumn.current === null) {
        tabRunOriginColumn.current = parsedAddress.value.columnIndex;
      }

      const nextAddress = clampedCellAddress(sheet, parsedAddress.value, { columnIndex: 1, rowIndex: 0 });
      const nextSelection = { sheetId: sheet.id, cellKey: cellKey(nextAddress) };
      setActiveCell(nextSelection);
      setKeyboardFocusTarget(nextSelection);
      return;
    }

    const originColumn = tabRunOriginColumn.current ?? parsedAddress.value.columnIndex;
    const nextAddress = clampedCellAddress(
      sheet,
      {
        columnIndex: originColumn,
        rowIndex: parsedAddress.value.rowIndex,
      },
      { columnIndex: 0, rowIndex: 1 },
    );

    tabRunOriginColumn.current = null;
    const nextSelection = { sheetId: sheet.id, cellKey: cellKey(nextAddress) };
    setActiveCell(nextSelection);
    setKeyboardFocusTarget(nextSelection);
  }

  function openCreationDialog(position: WorkspacePosition, label: string) {
    setPendingSheetMenu(null);
    setPendingCreation({ position, label });
    setSheetName('');
    setError('');
  }

  function openRenameDialog(sheet: Sheet) {
    setPendingSheetMenu(null);
    setPendingRename({ sheetId: sheet.id, currentName: sheet.name });
    setSheetName(sheet.name);
    setError('');
  }

  function openSheetMenu(sheetId: string, event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setPendingSheetMenu({
      sheetId,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function handleToolbarCreate(event: MouseEvent<HTMLButtonElement>) {
    const workspace = event.currentTarget
      .closest('.workspace-shell')
      ?.querySelector<HTMLElement>('[data-testid="workspace-surface"]');

    if (!workspace) {
      return;
    }

    openCreationDialog(getViewportCenter(workspace, viewport), 'Create sheet at viewport center');
  }

  function handleContextMenu(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    openCreationDialog(getWorkspacePoint(event, event.currentTarget, viewport), 'Create sheet here');
  }

  function panWorkspace(deltaX: number, deltaY: number) {
    setViewport((currentViewport) => ({
      ...currentViewport,
      x: currentViewport.x + deltaX,
      y: currentViewport.y + deltaY,
    }));
  }

  function zoomWorkspace(nextScale: number, origin?: WorkspacePosition) {
    setViewport((currentViewport) => {
      const scale = clampWorkspaceZoom(nextScale);
      const zoomOrigin = origin ?? { x: 0, y: 0 };
      const workspaceOrigin = {
        x: (zoomOrigin.x - currentViewport.x) / currentViewport.scale,
        y: (zoomOrigin.y - currentViewport.y) / currentViewport.scale,
      };

      return {
        x: Math.round(zoomOrigin.x - workspaceOrigin.x * scale),
        y: Math.round(zoomOrigin.y - workspaceOrigin.y * scale),
        scale,
      };
    });
  }

  function resetViewport() {
    setViewport({ x: 0, y: 0, scale: 1 });
  }

  function handleWorkspacePointerDown(event: PointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('.sheet-context-menu')) {
      return;
    }

    setPendingSheetMenu(null);

    if (
      (event.button !== 0 && event.button !== undefined) ||
      (event.target as HTMLElement).closest('[data-testid="sheet-frame"]')
    ) {
      return;
    }

    panDrag.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    setIsPanningWorkspace(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleWorkspacePointerMove(event: PointerEvent<HTMLElement>) {
    if (!panDrag.current || panDrag.current.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - panDrag.current.clientX;
    const deltaY = event.clientY - panDrag.current.clientY;
    panDrag.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    panWorkspace(deltaX, deltaY);
  }

  function stopWorkspacePan(event: PointerEvent<HTMLElement>) {
    if (!panDrag.current || panDrag.current.pointerId !== event.pointerId) {
      return;
    }

    panDrag.current = null;
    setIsPanningWorkspace(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function moveSheetFrame(sheetId: string, position: WorkspacePosition) {
    setWorkbook((currentWorkbook) => ({
      ...currentWorkbook,
      sheets: currentWorkbook.sheets.map((sheet) =>
        sheet.id === sheetId
          ? {
              ...sheet,
              position,
            }
          : sheet,
      ),
    }));
  }

  function resizeSheetFrameInWorkbook(sheetId: string, position: WorkspacePosition, frameSize: SheetFrameSize) {
    setWorkbook((currentWorkbook) => ({
      ...currentWorkbook,
      sheets: currentWorkbook.sheets.map((sheet) =>
        sheet.id === sheetId
          ? {
              ...sheet,
              position,
              frameSize,
            }
          : sheet,
      ),
    }));
  }

  function handleSheetFrameDragStart(sheetId: string, event: PointerEvent<HTMLElement>) {
    if (
      (event.button !== 0 && event.button !== undefined) ||
      (event.target as HTMLElement).closest('button, input, textarea, select')
    ) {
      return;
    }

    const sheet = workbook.sheets.find((candidate) => candidate.id === sheetId);
    if (!sheet) {
      return;
    }

    sheetFrameDrag.current = {
      pointerId: event.pointerId,
      sheetId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition: sheet.position,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handleSheetFrameDragMove(event: PointerEvent<HTMLElement>) {
    if (!sheetFrameDrag.current || sheetFrameDrag.current.pointerId !== event.pointerId) {
      return;
    }

    const nextPosition = {
      x: Math.round(
        sheetFrameDrag.current.startPosition.x +
          (event.clientX - sheetFrameDrag.current.startClientX) / viewport.scale,
      ),
      y: Math.round(
        sheetFrameDrag.current.startPosition.y +
          (event.clientY - sheetFrameDrag.current.startClientY) / viewport.scale,
      ),
    };
    moveSheetFrame(sheetFrameDrag.current.sheetId, nextPosition);
  }

  function stopSheetFrameDrag(event: PointerEvent<HTMLElement>) {
    if (!sheetFrameDrag.current || sheetFrameDrag.current.pointerId !== event.pointerId) {
      return;
    }

    const finishedDrag = sheetFrameDrag.current;
    const position = {
      x: Math.round(finishedDrag.startPosition.x + (event.clientX - finishedDrag.startClientX) / viewport.scale),
      y: Math.round(finishedDrag.startPosition.y + (event.clientY - finishedDrag.startClientY) / viewport.scale),
    };
    if (position.x !== finishedDrag.startPosition.x || position.y !== finishedDrag.startPosition.y) {
      enqueueAutosave(`sheet:${finishedDrag.sheetId}:position`, () =>
        runRevisionedAutosave(finishedDrag.sheetId, (revision) =>
          getApiMethod('updateSheetPosition')(finishedDrag.sheetId, position, { revision }),
        ),
      );
    }

    sheetFrameDrag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function handleSheetFrameResizeStart(
    sheetId: string,
    direction: SheetFrameResizeDirection,
    event: PointerEvent<HTMLElement>,
  ) {
    if (event.button !== 0 && event.button !== undefined) {
      return;
    }

    const sheet = workbook.sheets.find((candidate) => candidate.id === sheetId);
    if (!sheet) {
      return;
    }

    sheetFrameResize.current = {
      pointerId: event.pointerId,
      sheetId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition: sheet.position,
      startFrameSize: sheet.frameSize,
      direction,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function handleSheetFrameResizeMove(event: PointerEvent<HTMLElement>) {
    if (!sheetFrameResize.current || sheetFrameResize.current.pointerId !== event.pointerId) {
      return;
    }

    const resize = sheetFrameResize.current;
    const nextLayout = resizeSheetFrame(resize, {
      x: (event.clientX - resize.startClientX) / viewport.scale,
      y: (event.clientY - resize.startClientY) / viewport.scale,
    });
    resizeSheetFrameInWorkbook(resize.sheetId, nextLayout.position, nextLayout.frameSize);
  }

  function stopSheetFrameResize(event: PointerEvent<HTMLElement>) {
    if (!sheetFrameResize.current || sheetFrameResize.current.pointerId !== event.pointerId) {
      return;
    }

    const resize = sheetFrameResize.current;
    const nextLayout = resizeSheetFrame(resize, {
      x: (event.clientX - resize.startClientX) / viewport.scale,
      y: (event.clientY - resize.startClientY) / viewport.scale,
    });

    if (
      nextLayout.position.x !== resize.startPosition.x ||
      nextLayout.position.y !== resize.startPosition.y ||
      nextLayout.frameSize.width !== resize.startFrameSize.width ||
      nextLayout.frameSize.height !== resize.startFrameSize.height
    ) {
      enqueueAutosave(`sheet:${resize.sheetId}:frame-size`, () =>
        runRevisionedAutosave(resize.sheetId, (revision) =>
          getApiMethod('updateSheetFrameSize')(resize.sheetId, nextLayout.frameSize, { revision }),
        ),
      );
      if (nextLayout.position.x !== resize.startPosition.x || nextLayout.position.y !== resize.startPosition.y) {
        enqueueAutosave(`sheet:${resize.sheetId}:position`, () =>
          runRevisionedAutosave(resize.sheetId, (revision) =>
            getApiMethod('updateSheetPosition')(resize.sheetId, nextLayout.position, { revision }),
          ),
        );
      }
    }

    sheetFrameResize.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function handleWorkspaceWheel(event: WheelEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('[data-testid="sheet-frame"]')) {
      return;
    }

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const origin = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    const delta = event.deltaY < 0 ? WORKSPACE_ZOOM_STEP : -WORKSPACE_ZOOM_STEP;
    zoomWorkspace(viewport.scale + delta, origin);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingCreation) {
      return;
    }

    const result = createSheet({
      id: `sheet-${workbook.sheets.length + 1}`,
      name: sheetName,
      existingSheets: workbook.sheets,
      position: pendingCreation.position,
    });

    if (!result.ok) {
      setError(validationMessage(result.reason));
      return;
    }

    setWorkbook((currentWorkbook) => ({
      ...currentWorkbook,
      sheets: [...currentWorkbook.sheets, result.value],
    }));
    enqueueAutosave(`sheet:${result.value.id}:create`, () =>
      getApiMethod('createSheet')({
        id: result.value.id,
        name: result.value.name,
        position: result.value.position,
        frameSize: result.value.frameSize,
        zIndex: result.value.zIndex,
      }),
    );
    setPendingCreation(null);
    setSheetName('');
    setError('');
  }

  function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingRename) {
      return;
    }

    const result = renameSheet(workbook, pendingRename.sheetId, sheetName);
    if (!result.ok) {
      setError(validationMessage(result.reason));
      return;
    }

    const renamedSheet = result.value.sheets.find((sheet) => sheet.id === pendingRename.sheetId);
    setWorkbook(result.value);
    if (renamedSheet) {
      enqueueAutosave(`sheet:${pendingRename.sheetId}:name`, () =>
        runRevisionedAutosave(pendingRename.sheetId, (revision) =>
          getApiMethod('renameSheet')(pendingRename.sheetId, renamedSheet.name, { revision }),
        ),
      );
    }
    setPendingRename(null);
    setSheetName('');
    setError('');
  }

  function appendSheetRow(sheetId: string) {
    let changed = false;
    const nextWorkbook = {
      ...workbook,
      sheets: workbook.sheets.map((sheet) => {
        if (sheet.id !== sheetId) {
          return sheet;
        }

        changed = true;
        return appendRow(sheet);
      }),
    };

    if (!changed) {
      return;
    }

    setWorkbook(nextWorkbook);
    enqueueAutosave(`sheet:${sheetId}:rows`, () =>
      runRevisionedAutosave(sheetId, (revision) => getApiMethod('appendRow')(sheetId, { revision })),
    );
  }

  function appendSheetColumn(sheetId: string) {
    let changed = false;
    const nextWorkbook = {
      ...workbook,
      sheets: workbook.sheets.map((sheet) => {
        if (sheet.id !== sheetId) {
          return sheet;
        }

        changed = true;
        return appendColumn(sheet);
      }),
    };

    if (!changed) {
      return;
    }

    setWorkbook(nextWorkbook);
    enqueueAutosave(`sheet:${sheetId}:columns`, () =>
      runRevisionedAutosave(sheetId, (revision) => getApiMethod('appendColumn')(sheetId, { revision })),
    );
  }

  function changeSheetZOrder(sheetId: string, direction: SheetZOrderDirection) {
    setPendingSheetMenu(null);
    const result = moveSheetZOrder(workbook, sheetId, direction);
    if (!result.ok) {
      return;
    }

    setWorkbook(result.value);
    for (const nextSheet of result.value.sheets) {
      const currentSheet = workbook.sheets.find((sheet) => sheet.id === nextSheet.id);
      if (currentSheet && currentSheet.zIndex !== nextSheet.zIndex) {
        enqueueAutosave(`sheet:${nextSheet.id}:z-index`, () =>
          runRevisionedAutosave(nextSheet.id, (revision) =>
            getApiMethod('updateSheetZIndex')(nextSheet.id, nextSheet.zIndex, { revision }),
          ),
        );
      }
    }
  }

  function closeDialog() {
    setPendingCreation(null);
    setPendingRename(null);
    setPendingSheetMenu(null);
    setSheetName('');
    setError('');
  }

  const menuSheet = pendingSheetMenu
    ? workbook.sheets.find((candidate) => candidate.id === pendingSheetMenu.sheetId)
    : undefined;

  if (startupLoad.status === 'loading') {
    return <StartupLoadingScreen />;
  }

  if (startupLoad.status === 'error') {
    return <StartupErrorScreen message={startupLoad.message} onRetry={() => setStartupLoad({ status: 'loading' })} />;
  }

  return (
    <main className="workspace-shell">
      <WorkspaceToolbar
        onCreateSheet={handleToolbarCreate}
        onPanWorkspace={panWorkspace}
        onResetViewport={resetViewport}
        onZoomWorkspace={zoomWorkspace}
        saveStatus={saveStatus}
        sheetCount={workbook.sheets.length}
        viewport={viewport}
      />

      <section
        aria-label="Spatial workspace"
        className={`workspace-surface${isPanningWorkspace ? ' workspace-surface-panning' : ''}`}
        data-viewport-scale={viewport.scale}
        data-viewport-x={viewport.x}
        data-viewport-y={viewport.y}
        data-testid="workspace-surface"
        onContextMenu={handleContextMenu}
        onPointerCancel={stopWorkspacePan}
        onPointerDown={handleWorkspacePointerDown}
        onPointerMove={handleWorkspacePointerMove}
        onPointerUp={stopWorkspacePan}
        onWheel={handleWorkspaceWheel}
      >
        {workbook.sheets.length === 0 ? (
          <p className="empty-workspace">Right-click the workspace or use New sheet to create a sheet.</p>
        ) : null}

        <div
          className="workspace-plane"
          data-testid="workspace-plane"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          }}
        >
          {workbook.sheets.map((sheet) => {
            const frameSize = clampSheetFrameSize(sheet.frameSize);

            return (
              <article
                aria-label={`Sheet ${sheet.name}`}
                className={`sheet-frame${activeCell?.sheetId === sheet.id ? ' sheet-frame-active' : ''}`}
                data-active-sheet={activeCell?.sheetId === sheet.id ? 'true' : undefined}
                data-column-count={sheet.columnCount}
                data-frame-height={frameSize.height}
                data-frame-width={frameSize.width}
                data-row-count={sheet.rowCount}
                data-position-x={sheet.position.x}
                data-position-y={sheet.position.y}
                data-sheet-id={sheet.id}
                data-testid="sheet-frame"
                data-z-index={sheet.zIndex}
                key={sheet.id}
                onContextMenu={(event) => openSheetMenu(sheet.id, event)}
                style={{
                  left: sheet.position.x,
                  top: sheet.position.y,
                  zIndex: sheet.zIndex,
                  width: frameSize.width,
                  height: frameSize.height,
                }}
              >
                {SHEET_FRAME_RESIZE_HANDLES.map(([handle, direction]) => (
                  <div
                    aria-label={`Resize sheet ${sheet.name} from ${handle}`}
                    className={`sheet-frame-resize-handle sheet-frame-resize-handle-${handle}`}
                    data-resize-handle={handle}
                    data-testid="sheet-frame-resize-handle"
                    key={handle}
                    onPointerCancel={stopSheetFrameResize}
                    onPointerDown={(event) => handleSheetFrameResizeStart(sheet.id, direction, event)}
                    onPointerMove={handleSheetFrameResizeMove}
                    onPointerUp={stopSheetFrameResize}
                    role="separator"
                  />
                ))}
                <header
                  className="sheet-frame-header"
                  data-testid="sheet-frame-header"
                  onPointerCancel={stopSheetFrameDrag}
                  onPointerDown={(event) => handleSheetFrameDragStart(sheet.id, event)}
                  onPointerMove={handleSheetFrameDragMove}
                  onPointerUp={stopSheetFrameDrag}
                >
                  <h2>{sheet.name}</h2>
                </header>
                <div className="sheet-frame-body" data-testid="sheet-frame-body">
                  <SheetGrid
                    activeCell={activeCell}
                    editingCell={editingCell}
                    keyboardFocusTarget={keyboardFocusTarget}
                    onCancelEdit={cancelActiveEdit}
                    onCommitEdit={commitActiveEdit}
                    onCommitEditAndNavigate={commitEditAndNavigate}
                    onEditValueChange={(value) =>
                      setEditingCell((currentEditingCell) =>
                        currentEditingCell ? { ...currentEditingCell, value } : currentEditingCell,
                      )
                    }
                    onNavigateCell={navigateCell}
                    onSelectCell={selectCell}
                    onStartEdit={startEditingCell}
                    formulaResults={formulaResults}
                    sheet={sheet}
                  />
                </div>
              </article>
            );
          })}
        </div>

        {pendingSheetMenu && menuSheet ? (
          <SheetContextMenu
            menu={pendingSheetMenu}
            onAppendColumn={(sheetId) => {
              setPendingSheetMenu(null);
              appendSheetColumn(sheetId);
            }}
            onAppendRow={(sheetId) => {
              setPendingSheetMenu(null);
              appendSheetRow(sheetId);
            }}
            onChangeZOrder={changeSheetZOrder}
            onRename={openRenameDialog}
            sheet={menuSheet}
          />
        ) : null}
      </section>

      {pendingCreation ? (
        <CreateSheetDialog
          error={error}
          pendingCreation={pendingCreation}
          sheetName={sheetName}
          onCancel={() => setPendingCreation(null)}
          onNameChange={(name) => {
            setSheetName(name);
            setError('');
          }}
          onSubmit={handleSubmit}
        />
      ) : null}

      {pendingRename ? (
        <RenameSheetDialog
          error={error}
          pendingRename={pendingRename}
          sheetName={sheetName}
          onCancel={closeDialog}
          onNameChange={(name) => {
            setSheetName(name);
            setError('');
          }}
          onSubmit={handleRenameSubmit}
        />
      ) : null}
    </main>
  );
}
