import { Dispatch, MouseEvent, PointerEvent, SetStateAction, useRef, useState, WheelEvent } from 'react';
import type { WorkbookApi } from './workbookApi';
import type {
  FormulaEvaluationSnapshot,
  Sheet,
  SheetZOrderDirection,
  Workbook,
  WorkspacePosition,
} from './workbook';
import type {
  ActiveCellSelection,
  CellNavigationDirection,
  EditingCell,
  PendingSheetMenu,
  SaveStatus,
  WorkspaceViewport,
} from './appTypes';
import { useSheetFrameInteractions } from './useSheetFrameInteractions';
import { WorkspaceSurface } from './WorkspaceSurface';
import { WorkspaceToolbar } from './WorkspaceToolbar';
import {
  clampWorkspaceZoom,
  getViewportCenter,
  getWorkspacePoint,
  WORKSPACE_ZOOM_STEP,
} from './workspaceGeometry';

export function Workspace({
  activeCell,
  editingCell,
  enqueueEdit,
  formulaResults,
  getApiMethod,
  keyboardFocusTarget,
  onAppendColumn,
  onAppendRow,
  onCancelEdit,
  onChangeSheetZOrder,
  onCommitEdit,
  onCommitEditAndNavigate,
  onCreateSheet,
  onEditValueChange,
  onNavigateCell,
  onOpenRenameDialog,
  onSelectCell,
  onStartEdit,
  runRevisionedEdit,
  saveStatus,
  setWorkbook,
  workbook,
}: {
  activeCell: ActiveCellSelection | null;
  editingCell: EditingCell | null;
  enqueueEdit: (key: string, run: () => Promise<Workbook>) => void;
  formulaResults: FormulaEvaluationSnapshot;
  getApiMethod: <K extends keyof WorkbookApi>(method: K) => WorkbookApi[K];
  keyboardFocusTarget: ActiveCellSelection | null;
  onAppendColumn: (sheetId: string) => void;
  onAppendRow: (sheetId: string) => void;
  onCancelEdit: () => void;
  onChangeSheetZOrder: (sheetId: string, direction: SheetZOrderDirection) => void;
  onCommitEdit: (editToCommit?: EditingCell) => void;
  onCommitEditAndNavigate: (editToCommit: EditingCell, direction: 'tab' | 'enter') => void;
  onCreateSheet: (position: WorkspacePosition, label: string) => void;
  onEditValueChange: (value: string) => void;
  onNavigateCell: (sheet: Sheet, cellKey: string, direction: CellNavigationDirection) => void;
  onOpenRenameDialog: (sheet: Sheet) => void;
  onSelectCell: (selection: ActiveCellSelection) => void;
  onStartEdit: (selection: ActiveCellSelection, initialValue?: string) => void;
  runRevisionedEdit: (
    sheetId: string,
    save: (revision: number | undefined) => Promise<Workbook>,
  ) => Promise<Workbook>;
  saveStatus: SaveStatus;
  setWorkbook: Dispatch<SetStateAction<Workbook>>;
  workbook: Workbook;
}) {
  const [viewport, setViewport] = useState<WorkspaceViewport>({ x: 0, y: 0, scale: 1 });
  const [pendingSheetMenu, setPendingSheetMenu] = useState<PendingSheetMenu | null>(null);
  const [isPanningWorkspace, setIsPanningWorkspace] = useState(false);
  const panDrag = useRef<{ pointerId: number; clientX: number; clientY: number } | null>(null);
  const {
    handleSheetFrameDragMove,
    handleSheetFrameDragStart,
    handleSheetFrameResizeMove,
    handleSheetFrameResizeStart,
    stopSheetFrameDrag,
    stopSheetFrameResize,
  } = useSheetFrameInteractions({
    enqueueEdit,
    getApiMethod,
    runRevisionedEdit,
    setWorkbook,
    viewportScale: viewport.scale,
    workbook,
  });

  function openSheetMenu(sheetId: string, event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setPendingSheetMenu({
      sheetId,
      x: event.clientX,
      y: event.clientY,
    });
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

  function handleToolbarCreate(event: MouseEvent<HTMLButtonElement>) {
    const workspace = event.currentTarget
      .closest('.workspace-shell')
      ?.querySelector<HTMLElement>('[data-testid="workspace-surface"]');

    if (!workspace) {
      return;
    }

    setPendingSheetMenu(null);
    onCreateSheet(getViewportCenter(workspace, viewport), 'Create sheet at viewport center');
  }

  function handleContextMenu(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    setPendingSheetMenu(null);
    onCreateSheet(getWorkspacePoint(event, event.currentTarget, viewport), 'Create sheet here');
  }

  function handleOpenRenameDialog(sheet: Sheet) {
    setPendingSheetMenu(null);
    onOpenRenameDialog(sheet);
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

  return (
    <>
      <WorkspaceToolbar
        onCreateSheet={handleToolbarCreate}
        onPanWorkspace={panWorkspace}
        onResetViewport={resetViewport}
        onZoomWorkspace={zoomWorkspace}
        saveStatus={saveStatus}
        sheetCount={workbook.sheets.length}
        viewport={viewport}
      />

      <WorkspaceSurface
        activeCell={activeCell}
        editingCell={editingCell}
        formulaResults={formulaResults}
        isPanningWorkspace={isPanningWorkspace}
        keyboardFocusTarget={keyboardFocusTarget}
        onAppendColumn={(sheetId) => {
          setPendingSheetMenu(null);
          onAppendColumn(sheetId);
        }}
        onAppendRow={(sheetId) => {
          setPendingSheetMenu(null);
          onAppendRow(sheetId);
        }}
        onCancelEdit={onCancelEdit}
        onChangeSheetZOrder={(sheetId, direction) => {
          setPendingSheetMenu(null);
          onChangeSheetZOrder(sheetId, direction);
        }}
        onCommitEdit={onCommitEdit}
        onCommitEditAndNavigate={onCommitEditAndNavigate}
        onContextMenu={handleContextMenu}
        onEditValueChange={onEditValueChange}
        onNavigateCell={onNavigateCell}
        onOpenRenameDialog={handleOpenRenameDialog}
        onOpenSheetMenu={openSheetMenu}
        onPointerCancel={stopWorkspacePan}
        onPointerDown={handleWorkspacePointerDown}
        onPointerMove={handleWorkspacePointerMove}
        onPointerUp={stopWorkspacePan}
        onResizeCancel={stopSheetFrameResize}
        onResizeMove={handleSheetFrameResizeMove}
        onResizeStart={handleSheetFrameResizeStart}
        onResizeStop={stopSheetFrameResize}
        onSelectCell={onSelectCell}
        onSheetFrameDragCancel={stopSheetFrameDrag}
        onSheetFrameDragMove={handleSheetFrameDragMove}
        onSheetFrameDragStart={handleSheetFrameDragStart}
        onSheetFrameDragStop={stopSheetFrameDrag}
        onStartEdit={onStartEdit}
        onWheel={handleWorkspaceWheel}
        pendingSheetMenu={pendingSheetMenu}
        sheets={workbook.sheets}
        viewport={viewport}
      />
    </>
  );
}
