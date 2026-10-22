/* eslint-disable max-lines -- Workspace remains the existing composition root; focused history ownership is extracted. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import { SheetDocument, Workbook, WorkspacePosition } from '@workbook/core/model';
import { cellKey } from '@workbook/core/address';
import { addressRangeOf, cellAddressOf, cellIdentityAt } from '@workbook/core/cellIdentity';
import { selectionAddressRange } from './workspaceSelection';
import { cellRawContent, findSheetById, frameProjection, sheetsInOrder, tabularProjection } from '@workbook/read/queries';
import { projectGridAxes } from '@grid/gridAxisProjection';
import type { CreatingGridAxes } from '@application/core/gridAxisCreationState';
import type { SelectionGesture, CellTarget, CellNavigationDirection, CellEditSession, CellSelection, CellSelectionMode, ReferenceNavigationTarget } from '@grid/cellInteractionContracts';
import type { SaveStatus } from '@application/core/state';
import { cellKeyForTarget, type CellFocusRequest } from '@grid/cellInteraction';
import { FormulaReferenceInspection } from '@reference-navigation/FormulaReferenceInspection';
import { inspectFormula } from '@reference-navigation/formulaInspection';
import { FormulaEditorPanel } from '@application/react/FormulaEditorPanel';
import { formulaPanelReferenceValues } from './formulaPanelValues';
import { workbookFormulaReferenceResolver } from '@workbook/formula/reference';
import { SheetContextMenu } from '@workspace/SheetContextMenu';
import { SheetFrame } from '@workspace/SheetFrame';
import { SheetOverview } from '@workspace/SheetOverview';
import { CreatingSheetFrame } from '@workspace/CreatingSheetFrame';
import type { CreatingSheetFrame as CreatingSheetFrameState } from '@application/core/sheetCreationState';
import { SheetGrid } from '@grid/SheetGrid';
import { useReferenceNavigation } from '@reference-navigation/useReferenceNavigation';
import { useWorkspaceNavigationHistory } from './useWorkspaceNavigationHistory';
import { useSheetFrameInteractions } from '@workspace/useSheetFrameInteractions';
import type { WorkbookCommands } from '@application/react/useWorkbookController';
import { useWorkspaceController } from '@workspace/useWorkspaceController';
import { WorkspaceSurface } from '@workspace/WorkspaceSurface';
import { WorkspaceToolbar } from '@workspace/WorkspaceToolbar';
import { NumberFormatControls } from '@workspace/NumberFormatControls';
import { formattingActionWrites, formattingShortcut } from '@workspace/formattingActions';
import { useFormattingSelection } from '@workspace/useFormattingSelection';
import { mountedWorkspaceFrameIds } from '@workspace/workspaceFrameVirtualization';
import { useWorkspaceHistoryReveal } from './useWorkspaceHistoryReveal';
import { ClipboardPayloadStore } from '@grid/clipboardPayload';
import { useGridFocusLease } from './useGridFocusLease';
import { SheetModelControls } from '@workspace/SheetModelControls';
import { historyCellsForSheet } from './historyCellsForSheet';
import { modelColumnPresentation, selectionIncludesCalculatedColumn } from './modelColumnPresentation';
import type { CellWriteResult } from '@application/core/userActions';
import { usageQueries } from '@calculation/usageQueries';
import { NavigationPalette, type NavigationCommand } from './NavigationPalette';
const CALCULATED_CELL_PROTECTION = 'This cell is calculated in the data model. Edit the calculation in Data models.'; export function Workspace({
  activeCell,
  canRetryFailedSaves,
  commands,
  contentHistoryFeedback,
  editingCell,
  formulaResults,
  keyboardFocusRequest,
  onKeyboardFocusRequestConsumed,
  onKeyboardFocusRequestCancelled,
  onCancelEdit,
  onClearCell,
  onClearSelection,
  onActivateSheet,
  onCommitEdit,
  onCommitEditAndNavigate,
  onSuspendEdit,
  onCreateSheet,
  onEditValueChange,
  onUpdateEditView,
  onNavigateCell,
  onNavigateKeyboardCell,
  onOpenDataModels,
  onOpenRenameDialog,
  onRetryFailedSaves,
  onSelectCell,
  onExtendSelection,
  onFocusSelection,
  onSettleSelectionGesture,
  onRestoreGridFocus,
  onSelectAxis,
  onSelectReferenceTarget,
  onRestoreSelection,
  onStartEdit,
  referenceSelection,
  selectionRange,
  selectionOwner,
  saveStatus,
  sheetDialogOpen = false,
  creatingAxes,
  creatingFrames,
  workbook,
}: {
  activeCell: CellTarget | null;
  canRetryFailedSaves: boolean;
  commands: WorkbookCommands;
  contentHistoryFeedback: import('@application/react/useWorkbookController').ContentHistoryFeedback | undefined;
  editingCell: CellEditSession | null;
  formulaResults: FormulaEvaluationSnapshot;
  keyboardFocusRequest: CellFocusRequest | null;
  onKeyboardFocusRequestConsumed: (requestId: number) => void;
  onKeyboardFocusRequestCancelled: (requestId: number) => void;
  onCancelEdit: () => void;
  onClearCell: (target: CellTarget) => CellWriteResult | undefined;
  onClearSelection: () => void;
  onActivateSheet: (sheetId: string, requestFocus?: boolean) => CellTarget | undefined;
  onCommitEdit: (session?: CellEditSession) => CellWriteResult | undefined;
  onCommitEditAndNavigate: (session: CellEditSession, request: Pick<import('@grid/cellInteractionContracts').CellNavigationRequest, 'key' | 'shift'>) => CellWriteResult | undefined;
  onSuspendEdit?: (session: CellEditSession) => void;
  onCreateSheet: (position: WorkspacePosition, viewportScale: number, label: string) => void;
  onEditValueChange: (value: string) => void;
  onUpdateEditView?: (selection: { start: number; end: number }, scrollTop: number) => void;
  onNavigateCell: (target: CellTarget, direction: CellNavigationDirection) => void;
  onNavigateKeyboardCell: (target: CellTarget, request: import('@grid/cellInteractionContracts').CellNavigationRequest) => boolean;
  onOpenDataModels?: (modelId?: string) => void;
  onOpenRenameDialog: (sheet: SheetDocument) => void;
  onRetryFailedSaves: () => void;
  onSelectCell: (target: CellTarget, gesture?: SelectionGesture) => void;
  onExtendSelection: (target: CellTarget, gesture?: SelectionGesture) => void;
  onFocusSelection: (target: CellTarget, gesture?: SelectionGesture) => void;
  onSettleSelectionGesture: (owner: symbol) => void;
  onRestoreGridFocus: () => number | null;
  onSelectAxis: (mode: Exclude<CellSelectionMode, 'cells'>, target: CellTarget, extend: boolean, gesture?: SelectionGesture) => void;
  onSelectReferenceTarget: (target: ReferenceNavigationTarget) => void;
  onRestoreSelection: (selection: CellSelection | null) => boolean;
  onStartEdit: (target: CellTarget, initialValue?: string) => void;
  referenceSelection: ReferenceNavigationTarget | null;
  selectionRange: CellSelection | null;
  selectionOwner?: symbol | null;
  saveStatus: SaveStatus;
  sheetDialogOpen?: boolean;
  creatingFrames: CreatingSheetFrameState[];
  creatingAxes: Readonly<Record<string, CreatingGridAxes>>;
  workbook: Workbook;
}) {
  const clipboard = useRef(new ClipboardPayloadStore());
  const [, setClipboardRevision] = useState(0);
  const [calculatedCellFeedback, setCalculatedCellFeedback] = useState('');
  const [navigationFeedback, setNavigationFeedback] = useState('');
  const [formulaPanelOpen, setFormulaPanelOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const paletteInvoker = useRef<HTMLElement | null>(null);
  const [gridInteractionSheetIds, setGridInteractionSheetIds] = useState<ReadonlySet<string>>(() => new Set());
  const gridHistoryReveals = useRef<{ identity?: string; sheetIds: Set<string> }>({ sheetIds: new Set() });
  const handleHistoryRevealConsumed = useCallback((sheetId: string, identity: string) => {
    if (gridHistoryReveals.current.identity !== identity) gridHistoryReveals.current = { identity, sheetIds: new Set() };
    gridHistoryReveals.current.sheetIds.add(sheetId);
  }, []);
  const sheets = sheetsInOrder(workbook);
  const selectedSheet = activeCell ? findSheetById(workbook, activeCell.sheetId) : undefined;
  const dataModels = Object.values(workbook.dataModels ?? {});
  const selectedCellKey = selectedSheet ? cellKeyForTarget(selectedSheet, activeCell) : null;
  const selectedRaw = selectedSheet && selectedCellKey
    ? cellRawContent(selectedSheet, selectedCellKey)
    : undefined;
  useEffect(() => { if (!editingCell) setFormulaPanelOpen(false); }, [editingCell]);
  const formulaInspection = selectedSheet && selectedRaw
    ? inspectFormula(selectedRaw, workbook, selectedSheet)
    : undefined;
  // A sheet dialog takes ownership from all background transient sessions.
  const interactionsEnabled = !sheetDialogOpen;
  const formattingProjection = useFormattingSelection(selectedSheet, selectionRange);
  const cancelNavigationBeforeUserMovement = useRef<() => void>(() => {});
  const workspaceController = useWorkspaceController({
    onBeforeUserMovement: () => cancelNavigationBeforeUserMovement.current(),
    onClearSelection,
    onCreateSheet,
    interactionsEnabled,
  });
  const navigationKeyboardEnabled = interactionsEnabled && !workspaceController.pendingSheetMenu;
  const { acknowledgeGridRestore, cancelNavigationRestore, history: navigationHistory, historyRestoreForSheet, navigationRestoreForSheet, navigationRequestForSheet, registerScrollContainer, recordUserGridMovement, startExplicitNavigation } = useWorkspaceNavigationHistory({
    onRestoreSelection, onUnavailableTarget: () => setNavigationFeedback('The saved navigation target is no longer available.'), restoreViewport: workspaceController.restoreViewport,
    selection: selectionRange, viewport: workspaceController.viewport,
  });
  cancelNavigationBeforeUserMovement.current = cancelNavigationRestore;
  const lastViewport = useRef(workspaceController.viewport);
  useEffect(() => {
    if (lastViewport.current !== workspaceController.viewport) {
      lastViewport.current = workspaceController.viewport;
      // Viewport effects do not establish movement provenance. A restored or
      // animated viewport may commit after its restore transaction completes;
      // only the controller can identify a gesture that should enter history.
      if (workspaceController.consumeViewportMovementIsUser()) navigationHistory.recordUserMovement();
    }
  }, [navigationHistory, workspaceController]);
  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (!interactionsEnabled) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('textarea, input, select, [contenteditable="true"]') || event.defaultPrevented) return;
      const key = event.key.toLowerCase();
      const primaryModifier = event.ctrlKey || event.metaKey;
      if (!primaryModifier && event.shiftKey && !event.altKey && key === 'n') {
        event.preventDefault();
        workspaceController.createSheetAtViewportCenter();
        return;
      }
      if (event.altKey && !event.shiftKey && !primaryModifier && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        if (!navigationKeyboardEnabled) return;
        if (navigationHistory.traverse(event.key === 'ArrowLeft' ? 'back' : 'forward')) event.preventDefault();
        return;
      }
      if (primaryModifier && event.shiftKey && !event.altKey && key === 'p' && navigationKeyboardEnabled) {
        event.preventDefault();
        paletteInvoker.current = target;
        setCommandPaletteOpen(true);
        return;
      }
      if (event.altKey && event.shiftKey && !primaryModifier && key === 'u' && navigationKeyboardEnabled) {
        event.preventDefault();
        paletteInvoker.current = target;
        setCommandPaletteOpen(true);
        return;
      }
      const action = formattingShortcut(event);
      if (!action) return;
      event.preventDefault();
      const writes = formattingActionWrites(formattingProjection, action, { editing: editingCell !== null, modal: !interactionsEnabled });
      if (writes.length === 0 || !formattingProjection.descriptor.valid) return;
      commands.writeNumberFormats(formattingProjection.descriptor.sheetId, writes);
      onRestoreGridFocus();
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [commands, editingCell, formattingProjection, interactionsEnabled, navigationHistory, navigationKeyboardEnabled, onRestoreGridFocus, workspaceController]);
  useWorkspaceHistoryReveal(contentHistoryFeedback, editingCell !== null, sheets, creatingAxes, workspaceController);
  const {
    navigateReference,
    navigateTarget,
    navigationHighlight,
    navigationHighlightIdentity,
    navigationMotion,
  } = useReferenceNavigation({
    navigateToTarget: workspaceController.navigateToTarget,
    onSelectReferenceTarget,
    onExplicitNavigation: navigationHistory.explicitNavigation,
    startNavigation: startExplicitNavigation,
    workbook,
  });
  const closeCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false);
    queueMicrotask(() => { if (paletteInvoker.current?.isConnected) paletteInvoker.current.focus(); });
  }, []);
  const navigateCellTarget = useCallback((target: CellTarget) => {
    const sheet = findSheetById(workbook, target.sheetId);
    if (!sheet || !navigateTarget({ kind: 'cell', target }, sheet)) setNavigationFeedback('The navigation target is no longer available.');
  }, [navigateTarget, workbook]);
  const paletteCommands = useMemo<NavigationCommand[]>(() => {
    const result: NavigationCommand[] = sheets.map((sheet) => {
      const first = cellIdentityAt(sheet.content, { columnIndex: 0, rowIndex: 0 });
      return { id: `sheet:${sheet.id}`, label: `Go to sheet: ${sheet.name}`,
        unavailable: first ? undefined : 'This sheet has no cells',
        run: () => { if (first) { navigateCellTarget({ sheetId: sheet.id, cell: first }); closeCommandPalette(); } } };
    });
    result.unshift({ id: 'row', label: 'Go to row…', unavailable: selectedSheet?.content.rows.length ? undefined : 'No current sheet rows', run: () => {
      const raw = window.prompt('Row number');
      if (!raw || !/^\d+$/.test(raw)) return;
      const row = Number(raw);
      if (!selectedSheet || row < 1 || row > selectedSheet.content.rows.length) { setNavigationFeedback('Enter an existing positive row number.'); return; }
      const columnId = activeCell && selectedSheet.content.columns.includes(activeCell.cell.columnId) ? activeCell.cell.columnId : selectedSheet.content.columns[0];
      if (columnId) navigateCellTarget({ sheetId: selectedSheet.id, cell: { rowId: selectedSheet.content.rows[row - 1]!, columnId } });
      closeCommandPalette();
    } });
    result.unshift({ id: 'usages', label: 'Find usages of selected cell', shortcut: 'Alt+Shift+U', unavailable: activeCell ? undefined : 'Select a cell first', run: () => {
      if (!activeCell) return;
      const usages = usageQueries(workbook).forCell(activeCell);
      const target = usages.directUsages[0] ?? usages.transitiveDependents[0];
      if (!target) { setNavigationFeedback(usages.available ? 'No direct usages or indirect dependents.' : 'The selected target is unavailable.'); return; }
      navigateCellTarget(target); closeCommandPalette();
    } });
    return result;
  }, [activeCell, closeCommandPalette, navigateCellTarget, selectedSheet, sheets, workbook]);
  const {
    cancelSheetFrameDrag,
    cancelSheetFrameResize,
    frameLayoutPreview,
    frameScalePreview,
    handleSheetFrameDragMove,
    handleSheetFrameDragStart,
    handleSheetFrameResizeMove,
    handleSheetFrameResizeStart,
    interactionPinnedSheetId,
    stopSheetFrameDrag,
    stopSheetFrameResize,
  } = useSheetFrameInteractions({
    commands,
    interactionsEnabled,
    viewportScale: workspaceController.viewport.scale,
    workbook,
  });
  const gridFocus = useGridFocusLease({
    activeCell, keyboardFocusRequest, onKeyboardFocusRequestCancelled,
    onKeyboardFocusRequestConsumed, onRestoreGridFocus,
    interactionPinnedSheetId: interactionPinnedSheetId ?? undefined, sheetIds: sheets.map((sheet) => sheet.id),
  });
  const { beginPendingGridFocus, gridFocusLease, handleDetailedBodyAvailable,
    handleDetailedFocusDisplaced, handleDetailedNativeFocus,
    handleDetailedNativeFocusReleased, handleKeyboardFocusRequestConsumed, pinsFocusedFrame } = gridFocus;
  const projectedFrames = sheets.map((sheet) => {
    const frame = frameProjection(sheet);
    const layout = frameLayoutPreview?.sheetId === sheet.id
      ? { ...frame, position: frameLayoutPreview.position, size: frameLayoutPreview.size }
      : frame;
    return frameScalePreview?.sheetId === sheet.id
      ? { ...layout, position: frameScalePreview.position, visualScale: frameScalePreview.visualScale }
      : layout;
  });
  const projectedFramesById = new Map(projectedFrames.map((frame) => [frame.id, frame]));
  const mountedSheetIds = mountedWorkspaceFrameIds({
    frames: projectedFrames,
    pins: {
      editingSheetId: editingCell?.target.sheetId,
      gridInteractionSheetIds,
      interactionSheetId: interactionPinnedSheetId,
      pendingFocusSheetId: pinsFocusedFrame(gridFocusLease) ? gridFocusLease?.sheetId : undefined,
    },
    surfaceSize: workspaceController.workspaceSurfaceSize,
    viewport: workspaceController.viewport,
  });
  const handleGridPointerInteractionChange = useCallback((sheetId: string, active: boolean) => {
    setGridInteractionSheetIds((current) => {
      if (current.has(sheetId) === active) return current;
      const next = new Set(current);
      if (active) next.add(sheetId);
      else next.delete(sheetId);
      return next;
    });
  }, []);
  function handleOpenRenameDialog(sheet: SheetDocument) {
    workspaceController.closeSheetMenu();
    onOpenRenameDialog(sheet);
  }
  const menuSheet = workspaceController.pendingSheetMenu
    ? sheets.find((sheet) => sheet.id === workspaceController.pendingSheetMenu!.sheetId)
    : undefined;
  function copyGridSelection() {
    const selection = selectionRange ?? (activeCell
      ? { mode: 'cells' as const, anchor: activeCell, extent: activeCell }
      : undefined);
    if (!selection) return undefined;
    const hadPendingCut = clipboard.current.pendingCutSource !== undefined;
    const copied = clipboard.current.copy(workbook, selection);
    if (hadPendingCut && !clipboard.current.pendingCutSource) setClipboardRevision((revision) => revision + 1);
    return copied.ok ? copied.value : undefined;
  }
  function cutGridSelection() {
    const selection = selectionRange ?? (activeCell
      ? { mode: 'cells' as const, anchor: activeCell, extent: activeCell }
      : undefined);
    if (!selection) return undefined;
    if (selectionIncludesCalculatedColumn(workbook, selection)) {
      cancelPendingCut();
      setCalculatedCellFeedback(CALCULATED_CELL_PROTECTION);
      return undefined;
    }
    const cut = clipboard.current.cut(workbook, selection);
    if (cut.ok) setClipboardRevision((revision) => revision + 1);
    return cut.ok ? cut.value : undefined;
  }
  function cancelPendingCut() {
    clipboard.current.cancelCut();
    setClipboardRevision((revision) => revision + 1);
  }
  function pasteGridSelection(clipboardData: { text: string; marker?: string }) {
    if (!activeCell) return;
    const destination = findSheetById(workbook, activeCell.sheetId);
    const destinationKey = destination && cellKeyForTarget(destination, activeCell);
    if (!destination || !destinationKey) return;
    const hadPendingCut = clipboard.current.pendingCutSource !== undefined;
    const parsed = clipboard.current.parse(workbook, clipboardData);
    if (hadPendingCut && !clipboard.current.pendingCutSource) setClipboardRevision((revision) => revision + 1);
    if (parsed.ok && parsed.value.kind === 'cut') {
      const moved = commands.moveCells(destination.id, destinationKey, parsed.value.source);
      if (moved.ok || moved.reason === 'stale-move-source' || moved.reason === 'invalid-move-source' || moved.reason === 'calculated-cell-write') cancelPendingCut();
      if (!moved.ok && moved.reason === 'calculated-cell-write') setCalculatedCellFeedback(CALCULATED_CELL_PROTECTION);
    } else {
      const pasted = commands.pasteCells(destination.id, destinationKey, parsed);
      if (!pasted.ok && pasted.reason === 'calculated-cell-write') setCalculatedCellFeedback(CALCULATED_CELL_PROTECTION);
    }
  }
  /** Reports a rejected content write instead of leaving the user without a reason. */
  function reportWriteOutcome(outcome: CellWriteResult | undefined) {
    if (outcome && !outcome.ok && outcome.reason === 'calculated-cell-write') {
      setCalculatedCellFeedback(CALCULATED_CELL_PROTECTION);
    }
  }
  return (
    <>
      <WorkspaceToolbar
        formatControls={<NumberFormatControls
            disabled={!interactionsEnabled}
            onWrite={(writes) => {
              if (!selectedSheet || writes.length === 0) return;
              commands.writeNumberFormats(selectedSheet.id, writes);
              onRestoreGridFocus();
            }}
            projection={formattingProjection}
            selection={selectionRange}
          />}
        onCreateSheet={workspaceController.createSheetAtViewportCenter}
        canGoBack={navigationHistory.canGoBack}
        canGoForward={navigationHistory.canGoForward}
        onGoBack={() => navigationHistory.traverse('back')}
        onGoForward={() => navigationHistory.traverse('forward')}
        onOpenDataModels={onOpenDataModels}
        onOpenCommandPalette={() => { paletteInvoker.current = document.activeElement as HTMLElement; setCommandPaletteOpen(true); }}
        modelControls={selectedSheet ? <SheetModelControls key={selectedSheet.id} models={dataModels} onBind={commands.bindSheetToModel} onOpenDataModels={(modelId) => onOpenDataModels?.(modelId)} onUnbind={commands.unbindSheetFromModel} sheet={selectedSheet} /> : undefined}
        onRetryFailedSaves={onRetryFailedSaves}
        saveStatus={saveStatus}
        canRetryFailedSaves={canRetryFailedSaves}
      />
      {calculatedCellFeedback ? <p className="form-error" role="alert">{calculatedCellFeedback}</p> : null}
      {navigationFeedback ? <p className="form-error" role="alert">{navigationFeedback}</p> : null}
      {commandPaletteOpen ? <NavigationPalette commands={paletteCommands} onClose={closeCommandPalette} /> : null}
        <FormulaPanel activeCell={activeCell} editingCell={editingCell} formulaResults={formulaResults} onCancel={onCancelEdit} onCommit={(session) => { const outcome = onCommitEdit(session); reportWriteOutcome(outcome); return outcome; }} onOpenModel={onOpenDataModels} onRawChange={onEditValueChange} onStart={onStartEdit} onSuspend={onSuspendEdit} onViewChange={onUpdateEditView} open={formulaPanelOpen} selectedSheet={selectedSheet} setOpen={setFormulaPanelOpen} sheets={sheets} workbook={workbook} />
      <WorkspaceSurface
        contextMenu={workspaceController.pendingSheetMenu && menuSheet ? (
          <SheetContextMenu
            key={menuSheet.id}
            menu={workspaceController.pendingSheetMenu}
            onAppendColumn={(sheetId) => {
              workspaceController.closeSheetMenu();
              commands.appendColumn(sheetId);
            }}
            onAppendRow={(sheetId) => {
              workspaceController.closeSheetMenu();
              commands.appendRow(sheetId);
            }}
            onChangeZOrder={(sheetId, direction) => {
              workspaceController.closeSheetMenu();
              commands.changeSheetZOrder(sheetId, direction);
            }}
            onDelete={(sheetId) => {
              workspaceController.closeSheetMenu();
              if (editingCell?.target.sheetId === sheetId) onCancelEdit();
              commands.deleteSheet(sheetId);
            }}
            onRename={handleOpenRenameDialog}
            onSetScale={(sheetId, visualScale) => {
              workspaceController.closeSheetMenu();
              commands.setSheetVisualScale(sheetId, visualScale);
            }}
            sheet={menuSheet}
          />
        ) : undefined}
        hasSheets={sheets.length + creatingFrames.length > 0}
        isPanningWorkspace={workspaceController.isPanningWorkspace}
        navigationMotion={(navigationMotion || workspaceController.navigationMotion) && !workspaceController.navigationInterrupted && !workspaceController.isPanningWorkspace}
        onCreateSheet={workspaceController.createSheetAtViewportCenter}
        onContextMenu={workspaceController.handleWorkspaceContextMenu}
        overlay={(
          <FormulaReferenceInspection
            inspection={formulaInspection}
            key={`${activeCell?.sheetId}:${selectedCellKey}:${selectedRaw}:${formulaInspection?.raw}`}
            onNavigate={navigateReference}
          />
        )}
        viewport={workspaceController.viewport}
        workspaceSurfaceRef={workspaceController.workspaceSurfaceRef}
        workspacePlaneRef={workspaceController.workspacePlaneRef}
      >
        {sheets.map((sheet) => {
          if (!mountedSheetIds.has(sheet.id)) return null;
          const frame = projectedFramesById.get(sheet.id)!;
          const tabular = tabularProjection(sheet);
          const { calculatedColumnIds, columnLabels } = modelColumnPresentation(sheet, workbook.dataModels);
          const creatingSheetAxes = creatingAxes[sheet.id];
          // The grid overlay and the rich panel are mutually exclusive editing
          // surfaces. The panel owns the current session while it is open; its
          // fresh session generation also rejects the overlay's unmount snapshot.
          const sheetEditingCell = !formulaPanelOpen && editingCell?.target.sheetId === sheet.id ? editingCell : null;
          const selectedRange = selectionRange?.anchor.sheetId === sheet.id
            ? selectionAddressRange(sheet, selectionRange)
            : referenceSelection?.kind === 'range'
            && referenceSelection.sheetId === sheet.id
            ? addressRangeOf(sheet.content, referenceSelection.range)
            : undefined;
          const highlightTarget = navigationHighlight?.kind === 'cell'
            ? navigationHighlight.target
            : null;
          const navigationHighlightRange = navigationHighlight?.kind === 'range'
            && navigationHighlight.sheetId === sheet.id
            ? addressRangeOf(sheet.content, navigationHighlight.range)
            : undefined;
          const navigationRequest = navigationRequestForSheet(sheet.id);
          const navigationRequestTarget = navigationRequest?.target.kind === 'cell'
            ? navigationRequest.target.target
            : null;
          const navigationRequestRange = navigationRequest?.target.kind === 'range'
            ? addressRangeOf(sheet.content, navigationRequest.target.range)
            : undefined;
          const historyFeedbackCells = contentHistoryFeedback
            ? historyCellsForSheet(contentHistoryFeedback, sheet)
            : undefined;
          const pendingCutCells = clipboard.current.pendingCutSource?.sheetId === sheet.id
            ? new Set(clipboard.current.pendingCutSource.cells.flatMap((row) => row.map((cell) => {
                const address = cellAddressOf(sheet.content, cell.identity);
                return address && cellKey(address);
              })).filter((key): key is string => Boolean(key)))
            : undefined;
          return (
            <SheetFrame
              columnCount={tabular.columns.length + (creatingSheetAxes?.columns.length ?? 0)}
              frame={frame}
              isActiveSheet={activeCell?.sheetId === sheet.id}
              isNavigationReveal={navigationHighlight?.kind === 'cell'
                ? navigationHighlight.target.sheetId === sheet.id
                : navigationHighlight?.sheetId === sheet.id}
              retainDetailedBody={Boolean(
                sheetEditingCell
                || interactionPinnedSheetId === sheet.id
                || gridInteractionSheetIds.has(sheet.id)
                || (gridFocusLease?.phase === 'request-active' && gridFocusLease.sheetId === sheet.id),
              )}
              onDetailedFocusDisplaced={() => handleDetailedFocusDisplaced(sheet.id)}
              onDetailedBodyAvailable={() => handleDetailedBodyAvailable(sheet.id)}
              onDetailedNativeFocusReleased={() => handleDetailedNativeFocusReleased(sheet.id)}
              overview={(
                <SheetOverview
                  isActive={activeCell?.sheetId === sheet.id}
                  onSelect={() => {
                    const target = onActivateSheet(sheet.id, false);
                    if (target) beginPendingGridFocus(target);
                  }}
                  sheet={tabular}
                />
              )}
              key={sheet.id}
              onOpenSheetMenu={workspaceController.openSheetMenu}
              onResizeCancel={cancelSheetFrameResize}
              onResizeMove={handleSheetFrameResizeMove}
              onResizeStart={handleSheetFrameResizeStart}
              onResizeStop={stopSheetFrameResize}
              onSheetFrameDragCancel={cancelSheetFrameDrag}
              onSheetFrameInteraction={workspaceController.closeSheetMenu}
              onSheetFrameDragMove={handleSheetFrameDragMove}
              onSheetFrameDragStart={handleSheetFrameDragStart}
              onSheetFrameDragStop={stopSheetFrameDrag}
              onSelectSheet={() => { onActivateSheet(sheet.id); }}
              rowCount={tabular.rows.length + (creatingSheetAxes?.rows.length ?? 0)}
              viewportScale={workspaceController.viewport.scale}
            >
              {(scrollContainerRef) => {
                const axisProjection = projectGridAxes(tabular, creatingSheetAxes);
                return (
                  <SheetGrid
                    interactionsEnabled={interactionsEnabled}
                    activeCellKey={cellKeyForTarget(sheet, activeCell)}
                    activeSheetId={activeCell?.sheetId ?? null}
                    selectionOwner={selectionOwner}
                    axisProjection={axisProjection}
                    presentation={sheet.presentation}
                    pendingCutCells={pendingCutCells}
                    columnLabels={columnLabels}
                    calculatedColumnIds={calculatedColumnIds}
                    logicalSelection={selectionRange}
                    onWriteAxisSizes={(writes) => commands.writeAxisSizes(sheet.id, writes)}
                    onPointerInteractionChange={handleGridPointerInteractionChange}
                    onScrollContainerAvailable={(element) => registerScrollContainer(sheet.id, element)}
                    onUserViewportMovement={recordUserGridMovement}
                    historyRestore={historyRestoreForSheet(sheet.id)}
                    navigationRestoreGeneration={navigationRequest ? undefined : navigationRestoreForSheet(sheet.id)}
                    navigationRequestGeneration={navigationRequest?.generation}
                    navigationRequestCellKey={cellKeyForTarget(sheet, navigationRequestTarget)}
                    navigationRequestRange={navigationRequestRange}
                    onNavigationSettled={(generation) => acknowledgeGridRestore(sheet.id, generation)}
                    onNativeFocusTarget={handleDetailedNativeFocus}
                    cellInteraction={{
                      clear: (target) => reportWriteOutcome(onClearCell(target)),
                      navigate: onNavigateCell,
                      navigateKeyboard: onNavigateKeyboardCell,
                      select: onSelectCell,
                      extend: onExtendSelection,
                      focusSelection: onFocusSelection,
                      settleSelectionGesture: onSettleSelectionGesture,
                      startEditing: onStartEdit,
                    }}
                    editingCell={sheetEditingCell}
                    editorInteraction={{ cancel: onCancelEdit, commit: (session) => reportWriteOutcome(onCommitEdit(session)), commitAndNavigate: (session, request) => reportWriteOutcome(onCommitEditAndNavigate(session, request)), suspend: onSuspendEdit, updateValue: onEditValueChange, updateView: onUpdateEditView }}
                    formulaResults={formulaResults}
                    keyboardFocusRequest={keyboardFocusRequest?.target.sheetId === sheet.id
                      ? {
                          id: keyboardFocusRequest.id,
                          targetKey: cellKeyForTarget(sheet, keyboardFocusRequest.target),
                        }
                      : null}
                    onKeyboardFocusRequestConsumed={handleKeyboardFocusRequestConsumed}
                    navigationHighlightCellKey={cellKeyForTarget(sheet, highlightTarget)}
                    navigationHighlightRange={navigationHighlightRange}
                    navigationHighlightIdentity={navigationHighlightIdentity}
                    historyFeedbackCells={historyFeedbackCells}
                    historyFeedbackIdentity={gridHistoryReveals.current.identity === contentHistoryFeedback?.identity
                      && gridHistoryReveals.current.sheetIds.has(sheet.id)
                      ? undefined : contentHistoryFeedback?.identity}
                    onHistoryRevealConsumed={handleHistoryRevealConsumed}
                    scrollContainerRef={scrollContainerRef}
                    selectedRange={selectedRange}
                    selectionMode={selectionRange?.anchor.sheetId === sheet.id ? selectionRange.mode : undefined}
                    onSelectAxis={onSelectAxis}
                    clipboardInteraction={{ copy: copyGridSelection, cut: cutGridSelection, paste: pasteGridSelection, cancelCut: cancelPendingCut }}
                    sheet={tabular}
                  />
                );
              }}
            </SheetFrame>
          );
        })}
        {creatingFrames.map((frame) => <CreatingSheetFrame frame={frame} key={frame.operationKey} />)}
      </WorkspaceSurface>
    </>
  );
} export function FormulaPanel({ activeCell, editingCell, formulaResults, onCancel, onCommit, onOpenModel, onRawChange, onStart, onSuspend, onViewChange, open, selectedSheet, setOpen, sheets, workbook }: {
  activeCell: CellTarget | null; editingCell: CellEditSession | null; formulaResults: FormulaEvaluationSnapshot; onCancel: () => void; onCommit: (session?: CellEditSession) => CellWriteResult | undefined; onOpenModel?: (modelId?: string) => void; onRawChange: (raw: string) => void; onStart: (target: CellTarget, initialValue?: string) => void; onSuspend?: (session: CellEditSession) => void; onViewChange?: (selection: { start: number; end: number }, scrollTop: number) => void; open: boolean; selectedSheet: SheetDocument | undefined; setOpen: (open: boolean) => void; sheets: readonly SheetDocument[]; workbook: Workbook;
}) {
  const calculated = activeCell && selectedSheet?.modelId && Object.values(workbook.dataModels?.[selectedSheet.modelId]?.columns ?? []).some((column) => column.kind === 'calculated' && selectedSheet.modelColumnBindings?.[column.id] === activeCell.cell.columnId); const resolver = selectedSheet && workbookFormulaReferenceResolver(workbook, selectedSheet.id);
  return <aside className="workspace-formula-panel" data-workspace-native-content>{editingCell && selectedSheet && resolver && open ? <FormulaEditorPanel ariaLabel="Cell formula" autoFocus initialView={editingCell.selection && { ...editingCell.selection, scrollTop: editingCell.scrollTop }} onApply={() => { const outcome = onCommit(editingCell); if (!outcome || outcome.ok) setOpen(false); }} onCancel={() => { onCancel(); setOpen(false); }} onFocusLeave={(view) => { onSuspend?.({ ...editingCell, selection: { start: view.start, end: view.end }, scrollTop: view.scrollTop }); setOpen(false); }} onRawChange={onRawChange} onViewChange={(view) => onViewChange?.({ start: view.start, end: view.end }, view.scrollTop)} propertyNames={selectedSheet.modelId ? (workbook.dataModels?.[selectedSheet.modelId]?.columns.map((column) => column.name) ?? []) : []} raw={editingCell.draft} referenceValues={(identity) => formulaPanelReferenceValues(identity, resolver, formulaResults)} resolver={resolver} sheetNames={sheets.map((sheet) => sheet.name)} /> : calculated ? <button data-workspace-navigation onClick={() => onOpenModel?.(selectedSheet?.modelId)} type="button">Edit in Data models</button> : activeCell && selectedSheet ? <button data-workspace-navigation onClick={() => { onStart(activeCell); setOpen(true); }} type="button">Edit formula</button> : null}</aside>;
}
