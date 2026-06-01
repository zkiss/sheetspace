import type { MouseEvent, PointerEvent, WheelEvent } from 'react';
import type { FormulaEvaluationSnapshot, Sheet, SheetZOrderDirection } from './workbook';
import type {
  ActiveCellSelection,
  CellNavigationDirection,
  EditingCell,
  PendingSheetMenu,
  SheetFrameResizeDirection,
  WorkspaceViewport,
} from './appTypes';
import { SheetContextMenu } from './SheetContextMenu';
import { SheetFrame } from './SheetFrame';

export function WorkspaceSurface({
  activeCell,
  editingCell,
  formulaResults,
  isPanningWorkspace,
  keyboardFocusTarget,
  onAppendColumn,
  onAppendRow,
  onCancelEdit,
  onClearCell,
  onChangeSheetZOrder,
  onCommitEdit,
  onCommitEditAndNavigate,
  onContextMenu,
  onDeleteSheet,
  onEditValueChange,
  onNavigateCell,
  onOpenRenameDialog,
  onOpenSheetMenu,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onResizeCancel,
  onResizeMove,
  onResizeStart,
  onResizeStop,
  onSelectCell,
  onSheetFrameDragCancel,
  onSheetFrameDragMove,
  onSheetFrameDragStart,
  onSheetFrameDragStop,
  onStartEdit,
  onWheel,
  pendingSheetMenu,
  sheetIdRemaps,
  sheets,
  viewport,
}: {
  activeCell: ActiveCellSelection | null;
  editingCell: EditingCell | null;
  formulaResults: FormulaEvaluationSnapshot;
  isPanningWorkspace: boolean;
  keyboardFocusTarget: ActiveCellSelection | null;
  onAppendColumn: (sheetId: string) => void;
  onAppendRow: (sheetId: string) => void;
  onCancelEdit: () => void;
  onClearCell: (selection: ActiveCellSelection) => void;
  onChangeSheetZOrder: (sheetId: string, direction: SheetZOrderDirection) => void;
  onCommitEdit: (editToCommit?: EditingCell) => void;
  onCommitEditAndNavigate: (editToCommit: EditingCell, direction: 'tab' | 'enter') => void;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onDeleteSheet: (sheetId: string) => void;
  onEditValueChange: (value: string) => void;
  onNavigateCell: (sheet: Sheet, cellKey: string, direction: CellNavigationDirection) => void;
  onOpenRenameDialog: (sheet: Sheet) => void;
  onOpenSheetMenu: (sheetId: string, event: MouseEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onResizeCancel: (event: PointerEvent<HTMLElement>) => void;
  onResizeMove: (event: PointerEvent<HTMLElement>) => void;
  onResizeStart: (sheetId: string, direction: SheetFrameResizeDirection, event: PointerEvent<HTMLElement>) => void;
  onResizeStop: (event: PointerEvent<HTMLElement>) => void;
  onSelectCell: (selection: ActiveCellSelection) => void;
  onSheetFrameDragCancel: (event: PointerEvent<HTMLElement>) => void;
  onSheetFrameDragMove: (event: PointerEvent<HTMLElement>) => void;
  onSheetFrameDragStart: (sheetId: string, event: PointerEvent<HTMLElement>) => void;
  onSheetFrameDragStop: (event: PointerEvent<HTMLElement>) => void;
  onStartEdit: (selection: ActiveCellSelection, initialValue?: string) => void;
  onWheel: (event: WheelEvent<HTMLElement>) => void;
  pendingSheetMenu: PendingSheetMenu | null;
  sheetIdRemaps: Readonly<Record<string, string>>;
  sheets: Sheet[];
  viewport: WorkspaceViewport;
}) {
  const menuSheet = pendingSheetMenu
    ? sheets.find((candidate) => candidate.id === (sheetIdRemaps[pendingSheetMenu.sheetId] ?? pendingSheetMenu.sheetId))
    : undefined;
  const resolvedPendingSheetMenu = pendingSheetMenu
    ? { ...pendingSheetMenu, sheetId: sheetIdRemaps[pendingSheetMenu.sheetId] ?? pendingSheetMenu.sheetId }
    : null;

  return (
    <section
      aria-label="Spatial workspace"
      className={`workspace-surface${isPanningWorkspace ? ' workspace-surface-panning' : ''}`}
      data-viewport-scale={viewport.scale}
      data-viewport-x={viewport.x}
      data-viewport-y={viewport.y}
      data-testid="workspace-surface"
      onContextMenu={onContextMenu}
      onPointerCancel={onPointerCancel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
    >
      {sheets.length === 0 ? (
        <p className="empty-workspace">Right-click the workspace or use New sheet to create a sheet.</p>
      ) : null}

      <div
        className="workspace-plane"
        data-testid="workspace-plane"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        {sheets.map((sheet) => {
          const activeCellKey = activeCell?.sheetId === sheet.id ? activeCell.cellKey : null;
          const sheetEditingCell = editingCell?.sheetId === sheet.id ? editingCell : null;
          const keyboardFocusCellKey = keyboardFocusTarget?.sheetId === sheet.id ? keyboardFocusTarget.cellKey : null;

          return (
            <SheetFrame
              activeCellKey={activeCellKey}
              editingCell={sheetEditingCell}
              formulaResults={formulaResults}
              isActiveSheet={activeCell?.sheetId === sheet.id}
              key={sheet.id}
              keyboardFocusCellKey={keyboardFocusCellKey}
              onCancelEdit={onCancelEdit}
              onClearCell={onClearCell}
              onCommitEdit={onCommitEdit}
              onCommitEditAndNavigate={onCommitEditAndNavigate}
              onEditValueChange={onEditValueChange}
              onNavigateCell={onNavigateCell}
              onOpenSheetMenu={onOpenSheetMenu}
              onResizeCancel={onResizeCancel}
              onResizeMove={onResizeMove}
              onResizeStart={onResizeStart}
              onResizeStop={onResizeStop}
              onSelectCell={onSelectCell}
              onSheetFrameDragCancel={onSheetFrameDragCancel}
              onSheetFrameDragMove={onSheetFrameDragMove}
              onSheetFrameDragStart={onSheetFrameDragStart}
              onSheetFrameDragStop={onSheetFrameDragStop}
              onStartEdit={onStartEdit}
              sheet={sheet}
            />
          );
        })}
      </div>

      {resolvedPendingSheetMenu && menuSheet ? (
        <SheetContextMenu
          menu={resolvedPendingSheetMenu}
          onAppendColumn={onAppendColumn}
          onAppendRow={onAppendRow}
          onChangeZOrder={onChangeSheetZOrder}
          onDelete={onDeleteSheet}
          onRename={onOpenRenameDialog}
          sheet={menuSheet}
        />
      ) : null}
    </section>
  );
}
