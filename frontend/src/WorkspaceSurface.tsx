import type { MouseEvent, PointerEvent, RefObject, WheelEvent } from 'react';
import {
  addressRangeOf,
  frameProjection,
  tabularProjection,
  type FormulaEvaluationSnapshot,
  type SheetDocument,
  type SheetZOrderDirection,
} from './workbook';
import type {
  CellTarget,
  CellNavigationDirection,
  CellEditSession,
  PendingSheetMenu,
  ReferenceNavigationTarget,
  SheetFrameResizeDirection,
  WorkspaceViewport,
} from './appTypes';
import { cellKeyForTarget } from './cellInteraction';
import { SheetContextMenu } from './SheetContextMenu';
import { SheetFrame } from './SheetFrame';

export function WorkspaceSurface({
  activeCell,
  editingCell,
  formulaResults,
  isPanningWorkspace,
  keyboardFocusTarget,
  navigationHighlight,
  navigationMotion,
  referenceSelection,
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
  workspaceSurfaceRef,
}: {
  activeCell: CellTarget | null;
  editingCell: CellEditSession | null;
  formulaResults: FormulaEvaluationSnapshot;
  isPanningWorkspace: boolean;
  keyboardFocusTarget: CellTarget | null;
  navigationHighlight: ReferenceNavigationTarget | null;
  navigationMotion: boolean;
  referenceSelection: ReferenceNavigationTarget | null;
  onAppendColumn: (sheetId: string) => void;
  onAppendRow: (sheetId: string) => void;
  onCancelEdit: () => void;
  onClearCell: (target: CellTarget) => void;
  onChangeSheetZOrder: (sheetId: string, direction: SheetZOrderDirection) => void;
  onCommitEdit: (session?: CellEditSession) => void;
  onCommitEditAndNavigate: (session: CellEditSession, direction: 'tab' | 'enter') => void;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onDeleteSheet: (sheetId: string) => void;
  onEditValueChange: (value: string) => void;
  onNavigateCell: (target: CellTarget, direction: CellNavigationDirection) => void;
  onOpenRenameDialog: (sheet: SheetDocument) => void;
  onOpenSheetMenu: (sheetId: string, event: MouseEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
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
  onWheel: (event: WheelEvent<HTMLElement>) => void;
  pendingSheetMenu: PendingSheetMenu | null;
  sheetIdRemaps: Readonly<Record<string, string>>;
  sheets: SheetDocument[];
  viewport: WorkspaceViewport;
  workspaceSurfaceRef: RefObject<HTMLElement>;
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
      ref={workspaceSurfaceRef}
    >
      {sheets.length === 0 ? (
        <p className="empty-workspace">Right-click the workspace or use New sheet to create a sheet.</p>
      ) : null}

      <div
        className={`workspace-plane${navigationMotion ? ' workspace-plane-navigating' : ''}`}
        data-navigation-motion={navigationMotion ? 'smooth' : 'instant'}
        data-testid="workspace-plane"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        {sheets.map((sheet) => {
          const activeCellKey = cellKeyForTarget(sheet, activeCell);
          const sheetEditingCell = editingCell?.target.sheetId === sheet.id ? editingCell : null;
          const keyboardFocusCellKey = cellKeyForTarget(sheet, keyboardFocusTarget);
          const selectedRange = referenceSelection?.kind === 'range' && referenceSelection.sheetId === sheet.id
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
              activeCellKey={activeCellKey}
              editingCell={sheetEditingCell}
              frame={frameProjection(sheet)}
              formulaResults={formulaResults}
              isActiveSheet={activeCell?.sheetId === sheet.id}
              isNavigationReveal={navigationHighlight?.kind === 'cell'
                ? navigationHighlight.target.sheetId === sheet.id
                : navigationHighlight?.sheetId === sheet.id}
              navigationHighlightCellKey={cellKeyForTarget(sheet, highlightTarget)}
              navigationHighlightRange={navigationHighlightRange}
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
              tabular={tabularProjection(sheet)}
              selectedRange={selectedRange}
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
