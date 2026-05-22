import { MouseEvent } from 'react';
import type {
  FormulaEvaluationSnapshot,
  Sheet,
  Workbook,
  WorkspacePosition,
} from './workbook';
import type {
  ActiveCellSelection,
  CellNavigationDirection,
  EditingCell,
  SaveStatus,
} from './appTypes';
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
  onStartEdit,
  saveStatus,
  workbook,
}: {
  activeCell: ActiveCellSelection | null;
  commands: WorkbookCommands;
  editingCell: EditingCell | null;
  formulaResults: FormulaEvaluationSnapshot;
  keyboardFocusTarget: ActiveCellSelection | null;
  onCancelEdit: () => void;
  onClearCell: (selection: ActiveCellSelection) => void;
  onCommitEdit: (editToCommit?: EditingCell) => void;
  onCommitEditAndNavigate: (editToCommit: EditingCell, direction: 'tab' | 'enter') => void;
  onCreateSheet: (position: WorkspacePosition, label: string) => void;
  onEditValueChange: (value: string) => void;
  onNavigateCell: (sheet: Sheet, cellKey: string, direction: CellNavigationDirection) => void;
  onOpenRenameDialog: (sheet: Sheet) => void;
  onSelectCell: (selection: ActiveCellSelection) => void;
  onStartEdit: (selection: ActiveCellSelection, initialValue?: string) => void;
  saveStatus: SaveStatus;
  workbook: Workbook;
}) {
  const workspaceController = useWorkspaceController({ onCreateSheet });
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

  function handleOpenRenameDialog(sheet: Sheet) {
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
        sheetCount={workbook.sheets.length}
        viewport={workspaceController.viewport}
      />

      <WorkspaceSurface
        activeCell={activeCell}
        editingCell={editingCell}
        formulaResults={formulaResults}
        isPanningWorkspace={workspaceController.isPanningWorkspace}
        keyboardFocusTarget={keyboardFocusTarget}
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
        sheets={workbook.sheets}
        viewport={workspaceController.viewport}
      />
    </>
  );
}
