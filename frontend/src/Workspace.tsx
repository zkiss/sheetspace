import { FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import { SheetDocument, Workbook, WorkspacePosition } from '@workbook/core/model';
import { addressRangeOf } from '@workbook/core/cellIdentity';
import { cellRawContent, findSheetById, frameProjection, sheetsInOrder, tabularProjection } from '@workbook/read/queries';
import { projectGridAxes } from './gridAxisProjection';
import type { CreatingGridAxes } from './gridAxisProjection';
import type {
  CellTarget,
  CellNavigationDirection,
  CellEditSession,
  ReferenceNavigationTarget,
} from './appTypes';
import type { SaveStatus } from '@application/core/state';
import { cellKeyForTarget, type CellFocusRequest } from './cellInteraction';
import { FormulaReferenceInspection } from './FormulaReferenceInspection';
import { inspectFormula } from '@calculation/formulaInspection';
import { SheetContextMenu } from './SheetContextMenu';
import { SheetFrame } from './SheetFrame';
import { CreatingSheetFrame } from './CreatingSheetFrame';
import type { CreatingSheetFrame as CreatingSheetFrameState } from './useSheetCreationOperations';
import { SheetGrid } from './SheetGrid';
import { useReferenceNavigation } from './useReferenceNavigation';
import { useSheetFrameInteractions } from './useSheetFrameInteractions';
import type { WorkbookCommands } from './useWorkbookController';
import { useWorkspaceController } from './useWorkspaceController';
import { WorkspaceSurface } from './WorkspaceSurface';
import { WorkspaceToolbar } from './WorkspaceToolbar';
import { mountedWorkspaceFrameIds } from './workspaceFrameVirtualization';

export function Workspace({
  activeCell,
  canRetryFailedSaves,
  commands,
  editingCell,
  formulaResults,
  keyboardFocusRequest,
  onKeyboardFocusRequestConsumed,
  onCancelEdit,
  onClearCell,
  onCommitEdit,
  onCommitEditAndNavigate,
  onCreateSheet,
  onEditValueChange,
  onNavigateCell,
  onOpenRenameDialog,
  onRetryFailedSaves,
  onSelectCell,
  onSelectReferenceTarget,
  onStartEdit,
  referenceSelection,
  saveStatus,
  creatingAxes,
  creatingFrames,
  workbook,
}: {
  activeCell: CellTarget | null;
  canRetryFailedSaves: boolean;
  commands: WorkbookCommands;
  editingCell: CellEditSession | null;
  formulaResults: FormulaEvaluationSnapshot;
  keyboardFocusRequest: CellFocusRequest | null;
  onKeyboardFocusRequestConsumed: (requestId: number) => void;
  onCancelEdit: () => void;
  onClearCell: (target: CellTarget) => void;
  onCommitEdit: (session?: CellEditSession) => void;
  onCommitEditAndNavigate: (session: CellEditSession, direction: 'tab' | 'enter') => void;
  onCreateSheet: (position: WorkspacePosition, label: string) => void;
  onEditValueChange: (value: string) => void;
  onNavigateCell: (target: CellTarget, direction: CellNavigationDirection) => void;
  onOpenRenameDialog: (sheet: SheetDocument) => void;
  onRetryFailedSaves: () => void;
  onSelectCell: (target: CellTarget) => void;
  onSelectReferenceTarget: (target: ReferenceNavigationTarget) => void;
  onStartEdit: (target: CellTarget, initialValue?: string) => void;
  referenceSelection: ReferenceNavigationTarget | null;
  saveStatus: SaveStatus;
  creatingFrames: CreatingSheetFrameState[];
  creatingAxes: Readonly<Record<string, CreatingGridAxes>>;
  workbook: Workbook;
}) {
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
    frameLayoutPreview,
    handleSheetFrameDragMove,
    handleSheetFrameDragStart,
    handleSheetFrameResizeMove,
    handleSheetFrameResizeStart,
    interactionPinnedSheetId,
    stopSheetFrameDrag,
    stopSheetFrameResize,
  } = useSheetFrameInteractions({
    commands,
    viewportScale: workspaceController.viewport.scale,
    workbook,
  });
  const projectedFrames = sheets.map((sheet) => {
    const frame = frameProjection(sheet);
    return frameLayoutPreview?.sheetId === sheet.id
      ? { ...frame, position: frameLayoutPreview.position, size: frameLayoutPreview.size }
      : frame;
  });
  const projectedFramesById = new Map(projectedFrames.map((frame) => [frame.id, frame]));
  const navigationRevealSheetId = navigationHighlight?.kind === 'cell'
    ? navigationHighlight.target.sheetId
    : navigationHighlight?.sheetId;
  const mountedSheetIds = mountedWorkspaceFrameIds({
    frames: projectedFrames,
    pins: {
      editingSheetId: editingCell?.target.sheetId,
      interactionSheetId: interactionPinnedSheetId,
      navigationRevealSheetId,
      pendingFocusSheetId: keyboardFocusRequest?.target.sheetId,
    },
    surfaceSize: workspaceController.workspaceSurfaceSize,
    viewport: workspaceController.viewport,
  });

  function handleOpenRenameDialog(sheet: SheetDocument) {
    workspaceController.closeSheetMenu();
    onOpenRenameDialog(sheet);
  }

  const menuSheet = workspaceController.pendingSheetMenu
    ? sheets.find((sheet) => sheet.id === workspaceController.pendingSheetMenu!.sheetId)
    : undefined;

  return (
    <>
      <WorkspaceToolbar
        onCreateSheet={workspaceController.createSheetAtViewportCenter}
        onPanWorkspace={workspaceController.panWorkspace}
        onResetViewport={workspaceController.resetViewport}
        onRetryFailedSaves={onRetryFailedSaves}
        onZoomWorkspace={workspaceController.zoomWorkspace}
        saveStatus={saveStatus}
        canRetryFailedSaves={canRetryFailedSaves}
        sheetCount={sheets.length}
        viewport={workspaceController.viewport}
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
        navigationMotion={navigationMotion}
        onContextMenu={workspaceController.handleWorkspaceContextMenu}
        onPointerCancel={workspaceController.stopWorkspacePan}
        onPointerDown={workspaceController.handleWorkspacePointerDown}
        onPointerMove={workspaceController.handleWorkspacePointerMove}
        onPointerUp={workspaceController.stopWorkspacePan}
        onWheel={workspaceController.handleWorkspaceWheel}
        viewport={workspaceController.viewport}
        workspaceSurfaceRef={workspaceController.workspaceSurfaceRef}
      >
        {sheets.map((sheet) => {
          if (!mountedSheetIds.has(sheet.id)) return null;
          const frame = projectedFramesById.get(sheet.id)!;
          const tabular = tabularProjection(sheet);
          const axisProjection = projectGridAxes(tabular, creatingAxes[sheet.id]);
          const sheetEditingCell = editingCell?.target.sheetId === sheet.id ? editingCell : null;
          const selectedRange = referenceSelection?.kind === 'range'
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

          return (
            <SheetFrame
              columnCount={axisProjection.columns.length}
              frame={frame}
              isActiveSheet={activeCell?.sheetId === sheet.id}
              isNavigationReveal={navigationHighlight?.kind === 'cell'
                ? navigationHighlight.target.sheetId === sheet.id
                : navigationHighlight?.sheetId === sheet.id}
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
              rowCount={axisProjection.rows.length}
            >
              {(scrollContainerRef) => (
                <SheetGrid
                  activeCellKey={cellKeyForTarget(sheet, activeCell)}
                  axisProjection={axisProjection}
                  cellInteraction={{
                    clear: onClearCell,
                    navigate: onNavigateCell,
                    select: onSelectCell,
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
                  onKeyboardFocusRequestConsumed={onKeyboardFocusRequestConsumed}
                  navigationHighlightCellKey={cellKeyForTarget(sheet, highlightTarget)}
                  navigationHighlightRange={navigationHighlightRange}
                  scrollContainerRef={scrollContainerRef}
                  selectedRange={selectedRange}
                  sheet={tabular}
                />
              )}
            </SheetFrame>
          );
        })}
        {creatingFrames.map((frame) => <CreatingSheetFrame frame={frame} key={frame.operationKey} />)}
      </WorkspaceSurface>
    </>
  );
}
