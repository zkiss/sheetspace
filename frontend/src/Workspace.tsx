import { MouseEvent } from 'react';
import type {
  FormulaEvaluationSnapshot,
  SheetDocument,
  Workbook,
  WorkspacePosition,
} from './workbook';
import { cellRawContent, findSheetById, sheetsInOrder } from './workbook';
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
    workspaceSurfaceRef,
  } = useReferenceNavigation({
    navigateToTarget: workspaceController.navigateToTarget,
    onSelectReferenceTarget,
    sheetIdRemaps,
    workbook,
  });
  const {
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

  function handleToolbarCreate(event: MouseEvent<HTMLButtonElement>) {
    const workspace = event.currentTarget
      .closest('.workspace-shell')
      ?.querySelector<HTMLElement>('[data-testid="workspace-surface"]');

    if (!workspace) {
      return;
    }

    workspaceController.createSheetAtViewportCenter(workspace);
  }

  function handleOpenRenameDialog(sheet: SheetDocument) {
    workspaceController.closeSheetMenu();
    onOpenRenameDialog(sheet);
  }

  return (
    <>
      <WorkspaceToolbar
        onCreateSheet={handleToolbarCreate}
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
        activeCell={activeCell}
        editingCell={editingCell}
        formulaResults={formulaResults}
        isPanningWorkspace={workspaceController.isPanningWorkspace}
        keyboardFocusTarget={keyboardFocusTarget}
        navigationHighlight={navigationHighlight}
        navigationMotion={navigationMotion}
        referenceSelection={referenceSelection}
        onAppendColumn={(sheetId) => {
          workspaceController.closeSheetMenu();
          commands.appendColumn(sheetId);
        }}
        onAppendRow={(sheetId) => {
          workspaceController.closeSheetMenu();
          commands.appendRow(sheetId);
        }}
        onCancelEdit={onCancelEdit}
        onClearCell={onClearCell}
        onChangeSheetZOrder={(sheetId, direction) => {
          workspaceController.closeSheetMenu();
          commands.changeSheetZOrder(sheetId, direction);
        }}
        onCommitEdit={onCommitEdit}
        onCommitEditAndNavigate={onCommitEditAndNavigate}
        onContextMenu={workspaceController.handleWorkspaceContextMenu}
        onDeleteSheet={(sheetId) => {
          workspaceController.closeSheetMenu();
          if (editingCell?.target.sheetId === sheetId) onCancelEdit();
          commands.deleteSheet(sheetId);
        }}
        onEditValueChange={onEditValueChange}
        onNavigateCell={onNavigateCell}
        onOpenRenameDialog={handleOpenRenameDialog}
        onOpenSheetMenu={workspaceController.openSheetMenu}
        onPointerCancel={workspaceController.stopWorkspacePan}
        onPointerDown={workspaceController.handleWorkspacePointerDown}
        onPointerMove={workspaceController.handleWorkspacePointerMove}
        onPointerUp={workspaceController.stopWorkspacePan}
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
        onWheel={workspaceController.handleWorkspaceWheel}
        pendingSheetMenu={workspaceController.pendingSheetMenu}
        sheetIdRemaps={sheetIdRemaps}
        sheets={sheets}
        viewport={workspaceController.viewport}
        workspaceSurfaceRef={workspaceSurfaceRef}
      />
    </>
  );
}
