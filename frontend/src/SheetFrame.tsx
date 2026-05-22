import type { MouseEvent, PointerEvent } from 'react';
import type { FormulaEvaluationSnapshot, Sheet } from './workbook';
import type {
  ActiveCellSelection,
  CellNavigationDirection,
  EditingCell,
  SheetFrameResizeDirection,
} from './appTypes';
import { SheetGrid } from './SheetGrid';
import { clampSheetFrameSize } from './workspaceGeometry';

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

export function SheetFrame({
  activeCellKey,
  editingCell,
  formulaResults,
  isActiveSheet,
  keyboardFocusCellKey,
  onCancelEdit,
  onClearCell,
  onCommitEdit,
  onCommitEditAndNavigate,
  onEditValueChange,
  onNavigateCell,
  onOpenSheetMenu,
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
  sheet,
}: {
  activeCellKey: string | null;
  editingCell: EditingCell | null;
  formulaResults: FormulaEvaluationSnapshot;
  isActiveSheet: boolean;
  keyboardFocusCellKey: string | null;
  onCancelEdit: () => void;
  onClearCell: (selection: ActiveCellSelection) => void;
  onCommitEdit: (editToCommit?: EditingCell) => void;
  onCommitEditAndNavigate: (editToCommit: EditingCell, direction: 'tab' | 'enter') => void;
  onEditValueChange: (value: string) => void;
  onNavigateCell: (sheet: Sheet, cellKey: string, direction: CellNavigationDirection) => void;
  onOpenSheetMenu: (sheetId: string, event: MouseEvent<HTMLElement>) => void;
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
  sheet: Sheet;
}) {
  const frameSize = clampSheetFrameSize(sheet.frameSize);

  return (
    <article
      aria-label={`Sheet ${sheet.name}`}
      className={`sheet-frame${isActiveSheet ? ' sheet-frame-active' : ''}`}
      data-active-sheet={isActiveSheet ? 'true' : undefined}
      data-column-count={sheet.columnCount}
      data-frame-height={frameSize.height}
      data-frame-width={frameSize.width}
      data-row-count={sheet.rowCount}
      data-position-x={sheet.position.x}
      data-position-y={sheet.position.y}
      data-sheet-id={sheet.id}
      data-testid="sheet-frame"
      data-z-index={sheet.zIndex}
      onContextMenu={(event) => onOpenSheetMenu(sheet.id, event)}
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
          onPointerCancel={onResizeCancel}
          onPointerDown={(event) => onResizeStart(sheet.id, direction, event)}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeStop}
          role="separator"
        />
      ))}
      <header
        className="sheet-frame-header"
        data-testid="sheet-frame-header"
        onPointerCancel={onSheetFrameDragCancel}
        onPointerDown={(event) => onSheetFrameDragStart(sheet.id, event)}
        onPointerMove={onSheetFrameDragMove}
        onPointerUp={onSheetFrameDragStop}
      >
        <h2>{sheet.name}</h2>
      </header>
      <div className="sheet-frame-body" data-testid="sheet-frame-body">
        <SheetGrid
          activeCellKey={activeCellKey}
          editingCell={editingCell}
          keyboardFocusCellKey={keyboardFocusCellKey}
          onCancelEdit={onCancelEdit}
          onClearCell={onClearCell}
          onCommitEdit={onCommitEdit}
          onCommitEditAndNavigate={onCommitEditAndNavigate}
          onEditValueChange={onEditValueChange}
          onNavigateCell={onNavigateCell}
          onSelectCell={onSelectCell}
          onStartEdit={onStartEdit}
          formulaResults={formulaResults}
          sheet={sheet}
        />
      </div>
    </article>
  );
}
