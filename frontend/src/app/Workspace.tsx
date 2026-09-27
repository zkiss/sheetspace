import { useCallback, useEffect, useRef, useState } from 'react';
import { FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import { SheetDocument, Workbook, WorkspacePosition } from '@workbook/core/model';
import { cellKey, type CellRange } from '@workbook/core/address';
import { addressRangeOf, cellAddressOf } from '@workbook/core/cellIdentity';
import { cellRawContent, findSheetById, frameProjection, sheetsInOrder, tabularProjection } from '@workbook/read/queries';
import { projectGridAxes } from '@grid/gridAxisProjection';
import type { CreatingGridAxes } from '@application/core/gridAxisCreationState';
import type {
  SelectionGesture,
  CellTarget,
  CellNavigationDirection,
  CellEditSession,
  CellSelection,
  CellSelectionMode,
  ReferenceNavigationTarget,
} from '@grid/cellInteractionContracts';
import type { SaveStatus } from '@application/core/state';
import { cellKeyForTarget, cellTargetAt, type CellFocusRequest } from '@grid/cellInteraction';
import { FormulaReferenceInspection } from '@reference-navigation/FormulaReferenceInspection';
import { inspectFormula } from '@reference-navigation/formulaInspection';
import { SheetContextMenu } from '@workspace/SheetContextMenu';
import { SheetFrame } from '@workspace/SheetFrame';
import { SheetOverview } from '@workspace/SheetOverview';
import { CreatingSheetFrame } from '@workspace/CreatingSheetFrame';
import type { CreatingSheetFrame as CreatingSheetFrameState } from '@application/core/sheetCreationState';
import { SheetGrid } from '@grid/SheetGrid';
import { useReferenceNavigation } from '@reference-navigation/useReferenceNavigation';
import { useSheetFrameInteractions } from '@workspace/useSheetFrameInteractions';
import type { WorkbookCommands } from '@application/react/useWorkbookController';
import { useWorkspaceController } from '@workspace/useWorkspaceController';
import { WorkspaceSurface } from '@workspace/WorkspaceSurface';
import { WorkspaceToolbar } from '@workspace/WorkspaceToolbar';
import { NumberFormatControls } from '@workspace/NumberFormatControls';
import { mountedWorkspaceFrameIds } from '@workspace/workspaceFrameVirtualization';
import { effectiveSheetScreenScale, workspaceRectForFrame } from '@workspace/workspaceGeometry';
import { ClipboardPayloadStore } from '@grid/clipboardPayload';

type GridFocusTransaction = { sheetId: string; requestId: number | null; requestObserved: boolean };

export function Workspace({
  activeCell,
  canRetryFailedSaves,
  canRedo,
  canUndo,
  commands,
  contentHistoryFeedback,
  editingCell,
  formulaResults,
  keyboardFocusRequest,
  onKeyboardFocusRequestConsumed,
  onKeyboardFocusRequestCancelled,
  onCancelEdit,
  onClearCell,
  onCommitEdit,
  onCommitEditAndNavigate,
  onCreateSheet,
  onEditValueChange,
  onNavigateCell,
  onNavigateKeyboardCell,
  onOpenRenameDialog,
  onRetryFailedSaves,
  onSelectCell,
  onExtendSelection,
  onFocusSelection,
  onSettleSelectionGesture,
  onRestoreGridFocus,
  onSelectAxis,
  onSelectReferenceTarget,
  onStartEdit,
  referenceSelection,
  selectionRange,
  selectionOwner,
  saveStatus,
  creatingAxes,
  creatingFrames,
  workbook,
}: {
  activeCell: CellTarget | null;
  canRetryFailedSaves: boolean;
  canRedo: boolean;
  canUndo: boolean;
  commands: WorkbookCommands;
  contentHistoryFeedback: import('@application/react/useWorkbookController').ContentHistoryFeedback | undefined;
  editingCell: CellEditSession | null;
  formulaResults: FormulaEvaluationSnapshot;
  keyboardFocusRequest: CellFocusRequest | null;
  onKeyboardFocusRequestConsumed: (requestId: number) => void;
  onKeyboardFocusRequestCancelled: (requestId: number) => void;
  onCancelEdit: () => void;
  onClearCell: (target: CellTarget) => void;
  onCommitEdit: (session?: CellEditSession) => void;
  onCommitEditAndNavigate: (session: CellEditSession, request: Pick<import('@grid/cellInteractionContracts').CellNavigationRequest, 'key' | 'shift'>) => void;
  onCreateSheet: (position: WorkspacePosition, viewportScale: number, label: string) => void;
  onEditValueChange: (value: string) => void;
  onNavigateCell: (target: CellTarget, direction: CellNavigationDirection) => void;
  onNavigateKeyboardCell: (target: CellTarget, request: import('@grid/cellInteractionContracts').CellNavigationRequest) => boolean;
  onOpenRenameDialog: (sheet: SheetDocument) => void;
  onRetryFailedSaves: () => void;
  onSelectCell: (target: CellTarget, gesture?: SelectionGesture) => void;
  onExtendSelection: (target: CellTarget, gesture?: SelectionGesture) => void;
  onFocusSelection: (target: CellTarget, gesture?: SelectionGesture) => void;
  onSettleSelectionGesture: (owner: symbol) => void;
  onRestoreGridFocus: () => number | null;
  onSelectAxis: (mode: Exclude<CellSelectionMode, 'cells'>, target: CellTarget, extend: boolean, gesture?: SelectionGesture) => void;
  onSelectReferenceTarget: (target: ReferenceNavigationTarget) => void;
  onStartEdit: (target: CellTarget, initialValue?: string) => void;
  referenceSelection: ReferenceNavigationTarget | null;
  selectionRange: CellSelection | null;
  selectionOwner?: symbol | null;
  saveStatus: SaveStatus;
  creatingFrames: CreatingSheetFrameState[];
  creatingAxes: Readonly<Record<string, CreatingGridAxes>>;
  workbook: Workbook;
}) {
  const clipboard = useRef(new ClipboardPayloadStore());
  const [, setClipboardRevision] = useState(0);
  const [gridInteractionSheetIds, setGridInteractionSheetIds] = useState<ReadonlySet<string>>(() => new Set());
  // This belongs to the workspace rather than a SheetFrame: overview selection
  // can replace the logical owner while the original frame remains miniature.
  // Keep the intended owner so an initially-overview sheet can request focus too.
  const [pendingGridFocus, setPendingGridFocus] = useState<GridFocusTransaction | null>(null);
  const pendingGridFocusRef = useRef<GridFocusTransaction | null>(null);
  const keyboardFocusRequestRef = useRef(keyboardFocusRequest);
  keyboardFocusRequestRef.current = keyboardFocusRequest;
  const updatePendingGridFocus = useCallback((transaction: GridFocusTransaction | null) => {
    pendingGridFocusRef.current = transaction;
    setPendingGridFocus(transaction);
  }, []);
  const beginPendingGridFocus = useCallback((sheetId: string) => {
    updatePendingGridFocus({ sheetId, requestId: null, requestObserved: false });
  }, [updatePendingGridFocus]);
  const cancelPendingGridFocus = useCallback((requestId?: number) => {
    if (requestId !== undefined) onKeyboardFocusRequestCancelled(requestId);
    updatePendingGridFocus(null);
  }, [onKeyboardFocusRequestCancelled, updatePendingGridFocus]);
  useEffect(() => {
    function handleFocusIn(event: FocusEvent) {
      const request = keyboardFocusRequestRef.current;
      const transaction = pendingGridFocusRef.current;
      const pendingSheetId = request?.target.sheetId ?? transaction?.sheetId;
      const focusOwner = event.target;
      if (!pendingSheetId || !(focusOwner instanceof Element)) return;
      // Losing focus to body while a frame unmounts does not establish a new
      // owner. A subsequent focusin identifies an intentional external owner.
      if (focusOwner === document.body || focusOwner === document.documentElement) return;
      const frame = focusOwner.closest<HTMLElement>('article.sheet-frame[data-sheet-id]');
      if (frame?.dataset.sheetId !== pendingSheetId) cancelPendingGridFocus(request?.id);
    }

    document.addEventListener('focusin', handleFocusIn, true);
    return () => document.removeEventListener('focusin', handleFocusIn, true);
  }, [cancelPendingGridFocus]);
  useEffect(() => {
    const transaction = pendingGridFocus;
    if (!transaction || transaction.requestId === null) return;
    if (keyboardFocusRequest?.id === transaction.requestId) {
      if (!transaction.requestObserved) updatePendingGridFocus({ ...transaction, requestObserved: true });
      return;
    }
    // A newer request supersedes this transaction. Once the matching request
    // has appeared, its disappearance also means another action ended it.
    if (keyboardFocusRequest || transaction.requestObserved) updatePendingGridFocus(null);
  }, [keyboardFocusRequest, pendingGridFocus, updatePendingGridFocus]);
  const sheets = sheetsInOrder(workbook);
  const selectedSheet = activeCell ? findSheetById(workbook, activeCell.sheetId) : undefined;
  const selectedCellKey = selectedSheet ? cellKeyForTarget(selectedSheet, activeCell) : null;
  const selectedRaw = selectedSheet && selectedCellKey
    ? cellRawContent(selectedSheet, selectedCellKey)
    : undefined;
  const formulaInspection = selectedSheet && selectedRaw
    ? inspectFormula(selectedRaw, workbook, selectedSheet)
    : undefined;
  const workspaceController = useWorkspaceController({ onCreateSheet });
  useEffect(() => {
    if (!contentHistoryFeedback || editingCell) return;
    const destination = sheets.find((sheet) => contentHistoryFeedback.after.some((cell) => cell.sheetId === sheet.id));
    if (destination) workspaceController.navigateToTarget(workspaceRectForFrame(destination.frame));
  }, [contentHistoryFeedback?.identity]);
  const {
    navigateReference,
    navigationHighlight,
    navigationMotion,
  } = useReferenceNavigation({
    navigateToTarget: workspaceController.navigateToTarget,
    onSelectReferenceTarget,
    workbook,
  });
  const {
    cancelSheetFrameDrag,
    cancelSheetFrameResize,
    cancelSheetFrameScaleInput,
    cancelSheetFrameScalePointer,
    commitSheetFrameScale,
    frameLayoutPreview,
    frameScalePreview,
    handleSheetFrameDragMove,
    handleSheetFrameDragStart,
    handleSheetFrameResizeMove,
    handleSheetFrameResizeStart,
    handleSheetFrameScaleMove,
    handleSheetFrameScaleStart,
    interactionPinnedSheetId,
    stopSheetFrameDrag,
    stopSheetFrameResize,
    stopSheetFrameScale,
    previewSheetFrameScale,
    startSheetFrameScaleInput,
  } = useSheetFrameInteractions({
    commands,
    viewportScale: workspaceController.viewport.scale,
    workbook,
  });
  const projectedFrames = sheets.map((sheet) => {
    const frame = frameProjection(sheet);
    const layout = frameLayoutPreview?.sheetId === sheet.id
      ? { ...frame, position: frameLayoutPreview.position, size: frameLayoutPreview.size }
      : frame;
    return frameScalePreview?.sheetId === sheet.id ? { ...layout, visualScale: frameScalePreview.visualScale } : layout;
  });
  const projectedFramesById = new Map(projectedFrames.map((frame) => [frame.id, frame]));
  const mountedSheetIds = mountedWorkspaceFrameIds({
    frames: projectedFrames,
    pins: {
      editingSheetId: editingCell?.target.sheetId,
      gridInteractionSheetIds,
      interactionSheetId: interactionPinnedSheetId,
      pendingFocusSheetId: keyboardFocusRequest?.target.sheetId,
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

  const handleDetailedBodyAvailable = useCallback((sheetId: string) => {
    const transaction = pendingGridFocusRef.current;
    if (transaction?.sheetId !== sheetId || transaction.requestId !== null || activeCell?.sheetId !== sheetId) return;
    // A retained grid keeps an in-progress frame control usable, but is not yet
    // the focus destination. Re-evaluate after that control settles.
    if (interactionPinnedSheetId === sheetId) return;
    const requestId = onRestoreGridFocus();
    if (requestId === null) {
      updatePendingGridFocus(null);
      return;
    }
    // Keep ownership across conversion into the authoritative request. This
    // prevents detail availability from creating the same request repeatedly.
    updatePendingGridFocus({ sheetId, requestId, requestObserved: false });
  }, [activeCell?.sheetId, interactionPinnedSheetId, onRestoreGridFocus, updatePendingGridFocus]);

  const handleKeyboardFocusRequestConsumed = useCallback((requestId: number) => {
    if (pendingGridFocusRef.current?.requestId === requestId) updatePendingGridFocus(null);
    onKeyboardFocusRequestConsumed(requestId);
  }, [onKeyboardFocusRequestConsumed, updatePendingGridFocus]);

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
      if (moved.ok || moved.reason === 'stale-move-source' || moved.reason === 'invalid-move-source') cancelPendingCut();
    } else commands.pasteCells(destination.id, destinationKey, parsed);
  }

  return (
    <>
      <WorkspaceToolbar
        onCreateSheet={workspaceController.createSheetAtViewportCenter}
        onPanWorkspace={workspaceController.panWorkspace}
        onResetViewport={workspaceController.resetViewport}
        onRetryFailedSaves={onRetryFailedSaves}
        onRedo={commands.redo}
        onUndo={commands.undo}
        onZoomWorkspace={workspaceController.zoomWorkspaceBy}
        saveStatus={saveStatus}
        canRetryFailedSaves={canRetryFailedSaves}
        canRedo={canRedo && !editingCell}
        canUndo={canUndo && !editingCell}
        sheetCount={sheets.length}
        viewport={workspaceController.viewport}
      />
      <NumberFormatControls
        onWrite={(writes) => {
          if (!selectedSheet || writes.length === 0) return;
          commands.writeNumberFormats(selectedSheet.id, writes);
          onRestoreGridFocus();
        }}
        selection={selectionRange}
        sheet={selectedSheet}
      />

      <FormulaReferenceInspection
        inspection={formulaInspection}
        key={`${activeCell?.sheetId}:${selectedCellKey}:${selectedRaw}:${formulaInspection?.raw}`}
        onNavigate={navigateReference}
      />

      <WorkspaceSurface
        contextMenu={workspaceController.pendingSheetMenu && menuSheet ? (
          <SheetContextMenu
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
            sheet={menuSheet}
          />
        ) : undefined}
        hasSheets={sheets.length + creatingFrames.length > 0}
        isPanningWorkspace={workspaceController.isPanningWorkspace}
        navigationMotion={navigationMotion && !workspaceController.navigationInterrupted && !workspaceController.isPanningWorkspace}
        onContextMenu={workspaceController.handleWorkspaceContextMenu}
        viewport={workspaceController.viewport}
        workspaceSurfaceRef={workspaceController.workspaceSurfaceRef}
        workspacePlaneRef={workspaceController.workspacePlaneRef}
      >
        {sheets.map((sheet) => {
          if (!mountedSheetIds.has(sheet.id)) return null;
          const frame = projectedFramesById.get(sheet.id)!;
          const tabular = tabularProjection(sheet);
          const creatingSheetAxes = creatingAxes[sheet.id];
          const sheetEditingCell = editingCell?.target.sheetId === sheet.id ? editingCell : null;
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
          const historyFeedbackCells = contentHistoryFeedback
            ? historyCellsForSheet(contentHistoryFeedback, sheet)
            : undefined;
          const pendingCutCells = clipboard.current.pendingCutSource?.sheetId === sheet.id
            ? new Set(clipboard.current.pendingCutSource.cells.flatMap((row) => row.map((cell) => {
                const address = cellAddressOf(sheet.content, cell.identity);
                return address && cellKey(address);
              })).filter((key): key is string => Boolean(key)))
            : undefined;
          const overviewSelectionTarget = activeCell?.sheetId === sheet.id
            ? activeCell
            : cellTargetAt(tabular, 'A1');

          return (
            <SheetFrame
              columnCount={tabular.columns.length + (creatingSheetAxes?.columns.length ?? 0)}
              frame={frame}
              isActiveSheet={activeCell?.sheetId === sheet.id}
              isNavigationReveal={navigationHighlight?.kind === 'cell'
                ? navigationHighlight.target.sheetId === sheet.id
                : navigationHighlight?.sheetId === sheet.id}
              retainDetailedBody={Boolean(
                sheetEditingCell || interactionPinnedSheetId === sheet.id || gridInteractionSheetIds.has(sheet.id),
              )}
              onDetailedFocusDisplaced={() => beginPendingGridFocus(sheet.id)}
              onDetailedBodyAvailable={() => handleDetailedBodyAvailable(sheet.id)}
              overview={(
                <SheetOverview
                  isActive={activeCell?.sheetId === sheet.id}
                  onSelect={() => {
                    if (!overviewSelectionTarget) return;
                    // Selecting an overview explicitly asks to enter a grid that
                    // is absent now. Retarget any displaced-grid handoff to it.
                    beginPendingGridFocus(sheet.id);
                    onSelectCell(overviewSelectionTarget);
                  }}
                  screenScale={effectiveSheetScreenScale(workspaceController.viewport.scale, frame.visualScale)}
                  sheet={tabular}
                />
              )}
              key={sheet.id}
              onOpenSheetMenu={workspaceController.openSheetMenu}
              onResizeCancel={cancelSheetFrameResize}
              onResizeMove={handleSheetFrameResizeMove}
              onResizeStart={handleSheetFrameResizeStart}
              onResizeStop={stopSheetFrameResize}
              onScaleInputCancel={cancelSheetFrameScaleInput}
              onScalePointerCancel={cancelSheetFrameScalePointer}
              onScaleCommit={commitSheetFrameScale}
              onScaleMove={handleSheetFrameScaleMove}
              onScalePreview={previewSheetFrameScale}
              onScaleInputStart={startSheetFrameScaleInput}
              onScaleStart={handleSheetFrameScaleStart}
              onScaleStop={stopSheetFrameScale}
              onSheetFrameDragCancel={cancelSheetFrameDrag}
              onSheetFrameInteraction={workspaceController.closeSheetMenu}
              onSheetFrameDragMove={handleSheetFrameDragMove}
              onSheetFrameDragStart={handleSheetFrameDragStart}
              onSheetFrameDragStop={stopSheetFrameDrag}
              rowCount={tabular.rows.length + (creatingSheetAxes?.rows.length ?? 0)}
              viewportScale={workspaceController.viewport.scale}
            >
              {(scrollContainerRef) => {
                const axisProjection = projectGridAxes(tabular, creatingSheetAxes);
                return (
                  <SheetGrid
                    activeCellKey={cellKeyForTarget(sheet, activeCell)}
                    activeSheetId={activeCell?.sheetId ?? null}
                    selectionOwner={selectionOwner}
                    axisProjection={axisProjection}
                    presentation={sheet.presentation}
                    pendingCutCells={pendingCutCells}
                    logicalSelection={selectionRange}
                    onWriteAxisSizes={(writes) => commands.writeAxisSizes(sheet.id, writes)}
                    onPointerInteractionChange={handleGridPointerInteractionChange}
                    cellInteraction={{
                      clear: onClearCell,
                      navigate: onNavigateCell,
                      navigateKeyboard: onNavigateKeyboardCell,
                      select: onSelectCell,
                      extend: onExtendSelection,
                      focusSelection: onFocusSelection,
                      settleSelectionGesture: onSettleSelectionGesture,
                      startEditing: onStartEdit,
                    }}
                    editingCell={sheetEditingCell}
                    editorInteraction={{
                      cancel: onCancelEdit,
                      commit: onCommitEdit,
                      commitAndNavigate: onCommitEditAndNavigate,
                      updateValue: onEditValueChange,
                    }}
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
                    historyFeedbackCells={historyFeedbackCells}
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
}

function historyCellsForSheet(
  feedback: import('@application/react/useWorkbookController').ContentHistoryFeedback,
  sheet: SheetDocument,
) {
  const beforeByIdentity = new Map(feedback.before.map((cell) => [
    `${cell.sheetId}:${cell.rowId}:${cell.columnId}`,
    cell,
  ]));
  const cells = new Map<string, { before: string | null; beforeDisplay: string | null; after: string | null }>();
  for (const after of feedback.after) {
    if (after.sheetId !== sheet.id) continue;
    const address = cellAddressOf(sheet.content, after);
    if (!address) continue;
    const before = beforeByIdentity.get(`${after.sheetId}:${after.rowId}:${after.columnId}`);
    cells.set(cellKey(address), {
      before: before?.raw ?? null,
      beforeDisplay: before?.display ?? null,
      after: after.raw,
    });
  }
  return cells;
}

function selectionAddressRange(sheet: SheetDocument, selection: CellSelection): CellRange | undefined {
  const range = addressRangeOf(sheet.content, { start: selection.anchor.cell, end: selection.extent.cell });
  if (!range) return undefined;
  const rowStart = Math.min(range.start.rowIndex, range.end.rowIndex);
  const rowEnd = Math.max(range.start.rowIndex, range.end.rowIndex);
  const columnStart = Math.min(range.start.columnIndex, range.end.columnIndex);
  const columnEnd = Math.max(range.start.columnIndex, range.end.columnIndex);
  return {
    start: { rowIndex: selection.mode === 'columns' ? 0 : rowStart, columnIndex: selection.mode === 'rows' ? 0 : columnStart },
    end: {
      rowIndex: selection.mode === 'columns' ? sheet.content.rows.length - 1 : rowEnd,
      columnIndex: selection.mode === 'rows' ? sheet.content.columns.length - 1 : columnEnd,
    },
  };
}
