import type { MouseEvent, PointerEvent } from 'react';
import type { CellRange, FormulaEvaluationSnapshot, SheetFrameProjection, SheetTabularProjection } from './workbook';
import type {
  CellTarget,
  CellNavigationDirection,
  CellEditSession,
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
  isNavigationReveal,
  keyboardFocusCellKey,
  navigationHighlightCellKey,
  navigationHighlightRange,
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
  frame,
  tabular,
  selectedRange,
}: {
  activeCellKey: string | null;
  editingCell: CellEditSession | null;
  formulaResults: FormulaEvaluationSnapshot;
  isActiveSheet: boolean;
  isNavigationReveal: boolean;
  keyboardFocusCellKey: string | null;
  navigationHighlightCellKey: string | null;
  navigationHighlightRange?: CellRange;
  onCancelEdit: () => void;
  onClearCell: (target: CellTarget) => void;
  onCommitEdit: (session?: CellEditSession) => void;
  onCommitEditAndNavigate: (session: CellEditSession, direction: 'tab' | 'enter') => void;
  onEditValueChange: (value: string) => void;
  onNavigateCell: (target: CellTarget, direction: CellNavigationDirection) => void;
  onOpenSheetMenu: (sheetId: string, event: MouseEvent<HTMLElement>) => void;
  onResizeCancel: (event: PointerEvent<HTMLElement>) => void;
  onResizeMove: (event: PointerEvent<HTMLElement>) => void;
  onResizeStart: (sheetId: string, direction: SheetFrameResizeDirection, event: PointerEvent<HTMLElement>) => void;
  onResizeStop: (event: PointerEvent<HTMLElement>) => void;
  onSelectCell: (target: CellTarget) => void;
  onSheetFrameDragCancel: (event: PointerEvent<HTMLElement>) => void;
  onSheetFrameDragMove: (event: PointerEvent<HTMLElement>) => void;
  onSheetFrameDragStart: (sheetId: string, event: PointerEvent<HTMLElement>) => void;
  onSheetFrameDragStop: (event: PointerEvent<HTMLElement>) => void;
  onStartEdit: (target: CellTarget, initialValue?: string) => void;
  frame: SheetFrameProjection;
  tabular: SheetTabularProjection;
  selectedRange?: CellRange;
}) {
  const frameSize = clampSheetFrameSize(frame.size);

  return (
    <article
      aria-label={`Sheet ${frame.name}`}
      className={`sheet-frame${isActiveSheet ? ' sheet-frame-active' : ''}${
        isNavigationReveal ? ' sheet-frame-navigation-reveal' : ''
      }`}
      data-active-sheet={isActiveSheet ? 'true' : undefined}
      data-navigation-reveal={isNavigationReveal ? 'true' : undefined}
      data-column-count={tabular.columns.length}
      data-frame-height={frameSize.height}
      data-frame-width={frameSize.width}
      data-row-count={tabular.rows.length}
      data-position-x={frame.position.x}
      data-position-y={frame.position.y}
      data-sheet-id={frame.id}
      data-testid="sheet-frame"
      data-z-index={frame.zIndex}
      onContextMenu={(event) => onOpenSheetMenu(frame.id, event)}
      style={{
        left: frame.position.x,
        top: frame.position.y,
        zIndex: frame.zIndex,
        width: frameSize.width,
        height: frameSize.height,
      }}
    >
      {SHEET_FRAME_RESIZE_HANDLES.map(([handle, direction]) => (
        <div
          aria-label={`Resize sheet ${frame.name} from ${handle}`}
          className={`sheet-frame-resize-handle sheet-frame-resize-handle-${handle}`}
          data-resize-handle={handle}
          data-testid="sheet-frame-resize-handle"
          key={handle}
          onPointerCancel={onResizeCancel}
          onPointerDown={(event) => onResizeStart(frame.id, direction, event)}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeStop}
          role="separator"
        />
      ))}
      <header
        className="sheet-frame-header"
        data-testid="sheet-frame-header"
        onPointerCancel={onSheetFrameDragCancel}
        onPointerDown={(event) => onSheetFrameDragStart(frame.id, event)}
        onPointerMove={onSheetFrameDragMove}
        onPointerUp={onSheetFrameDragStop}
      >
        <h2>{frame.name}</h2>
      </header>
      <div className="sheet-frame-body" data-testid="sheet-frame-body">
        <SheetGrid
          activeCellKey={activeCellKey}
          editingCell={editingCell}
          keyboardFocusCellKey={keyboardFocusCellKey}
          navigationHighlightCellKey={navigationHighlightCellKey}
          navigationHighlightRange={navigationHighlightRange}
          onCancelEdit={onCancelEdit}
          onClearCell={onClearCell}
          onCommitEdit={onCommitEdit}
          onCommitEditAndNavigate={onCommitEditAndNavigate}
          onEditValueChange={onEditValueChange}
          onNavigateCell={onNavigateCell}
          onSelectCell={onSelectCell}
          onStartEdit={onStartEdit}
          formulaResults={formulaResults}
          sheet={tabular}
          selectedRange={selectedRange}
        />
      </div>
    </article>
  );
}
