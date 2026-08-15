import type {
  FormulaEvaluationSnapshot,
  SheetDocument,
  Workbook,
  WorkspacePosition,
} from './workbook';
import {
  addressRangeOf,
  cellRawContent,
  findSheetById,
  frameProjection,
  sheetsInOrder,
  tabularProjection,
} from './workbook';
import type {
  CellTarget,
  CellNavigationDirection,
  CellEditSession,
  ReferenceNavigationTarget,
  SaveStatus,
} from './appTypes';
import { cellKeyForTarget } from './cellInteraction';
import { FormulaReferenceInspection } from './FormulaReferenceInspection';
import { inspectFormula } from './formulaInspection';
import { SheetContextMenu } from './SheetContextMenu';
import { SheetFrame } from './SheetFrame';
import { SheetGrid } from './SheetGrid';
import { useReferenceNavigation } from './useReferenceNavigation';
import { useSheetFrameInteractions } from './useSheetFrameInteractions';
import type { WorkbookCommands } from './useWorkbookController';
import { useWorkspaceController } from './useWorkspaceController';
import { WorkspaceSurface } from './WorkspaceSurface';
import { WorkspaceToolbar } from './WorkspaceToolbar';

export function Workspace({
  activeCell,
  commands,
  editingCell,
  formulaResults,
  keyboardFocusTarget,
  onCancelEdit,
  onClearCell,
  onCommitEdit,
  onCommitEditAndNavigate,
  onCreateSheet,
  onEditValueChange,
  onNavigateCell,
  onOpenRenameDialog,
  onSelectCell,
  onSelectReferenceTarget,
  onStartEdit,
  referenceSelection,
  saveStatus,
  sheetIdRemaps,
  workbook,
}: {
  activeCell: CellTarget | null;
  commands: WorkbookCommands;
  editingCell: CellEditSession | null;
  formulaResults: FormulaEvaluationSnapshot;
  keyboardFocusTarget: CellTarget | null;
  onCancelEdit: () => void;
  onClearCell: (target: CellTarget) => void;
  onCommitEdit: (session?: CellEditSession) => void;
  onCommitEditAndNavigate: (session: CellEditSession, direction: 'tab' | 'enter') => void;
  onCreateSheet: (position: WorkspacePosition, label: string) => void;
  onEditValueChange: (value: string) => void;
  onNavigateCell: (target: CellTarget, direction: CellNavigationDirection) => void;
  onOpenRenameDialog: (sheet: SheetDocument) => void;
  onSelectCell: (target: CellTarget) => void;
  onSelectReferenceTarget: (target: ReferenceNavigationTarget) => void;
  onStartEdit: (target: CellTarget, initialValue?: string) => void;
  referenceSelection: ReferenceNavigationTarget | null;
  saveStatus: SaveStatus;
  sheetIdRemaps: Readonly<Record<string, string>>;
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
    sheetIdRemaps,
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
    stopSheetFrameDrag,
    stopSheetFrameResize,
  } = useSheetFrameInteractions({
    commands,
    viewportScale: workspaceController.viewport.scale,
    workbook,
  });

  function handleOpenRenameDialog(sheet: SheetDocument) {
    workspaceController.closeSheetMenu();
    onOpenRenameDialog(sheet);
  }

  const resolvedPendingSheetMenu = workspaceController.pendingSheetMenu
    ? {
        ...workspaceController.pendingSheetMenu,
        sheetId: sheetIdRemaps[workspaceController.pendingSheetMenu.sheetId]
          ?? workspaceController.pendingSheetMenu.sheetId,
      }
    : null;
  const menuSheet = resolvedPendingSheetMenu
    ? sheets.find((sheet) => sheet.id === resolvedPendingSheetMenu.sheetId)
    : undefined;

  return (
    <>
      <WorkspaceToolbar
        onCreateSheet={workspaceController.createSheetAtViewportCenter}
        onPanWorkspace={workspaceController.panWorkspace}
        onResetViewport={workspaceController.resetViewport}
        onZoomWorkspace={workspaceController.zoomWorkspace}
        saveStatus={saveStatus}
        sheetCount={sheets.length}
        viewport={workspaceController.viewport}
      />

      <FormulaReferenceInspection
        inspection={formulaInspection}
        key={`${activeCell?.sheetId}:${selectedCellKey}:${selectedRaw}:${formulaInspection?.raw}`}
        onNavigate={navigateReference}
      />

      <WorkspaceSurface
        contextMenu={resolvedPendingSheetMenu && menuSheet ? (
          <SheetContextMenu
            menu={resolvedPendingSheetMenu}
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
        hasSheets={sheets.length > 0}
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
          const projectedFrame = frameProjection(sheet);
          const frame = frameLayoutPreview?.sheetId === sheet.id
            ? {
                ...projectedFrame,
                position: frameLayoutPreview.position,
                size: frameLayoutPreview.size,
              }
            : projectedFrame;
          const tabular = tabularProjection(sheet);
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
              columnCount={tabular.columns.length}
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
              rowCount={tabular.rows.length}
            >
              {(scrollContainerRef) => (
                <SheetGrid
                  activeCellKey={cellKeyForTarget(sheet, activeCell)}
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
                  keyboardFocusCellKey={cellKeyForTarget(sheet, keyboardFocusTarget)}
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
      </WorkspaceSurface>
    </>
  );
}
