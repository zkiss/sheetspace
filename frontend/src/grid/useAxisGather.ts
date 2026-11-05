import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { SheetTabularProjection } from '@workbook/core/model';
import { cellKey } from '@workbook/core/address';
import { cellTargetAt } from './cellInteraction';
import type { CellSelection, SelectionGesture, CellTarget } from './cellInteractionContracts';
import type { GridAxisProjection } from './gridAxisProjection';
import type { GridAxisMetrics } from './gridAxisMetrics';
import { GRID_COLUMN_HEADER_HEIGHT, GRID_ROW_HEADER_WIDTH } from './gridGeometry';
import { logicalUnitsPerRenderedPixel } from './gridScrollInput';
import { axisDropGap, axisGatherBlock } from './axisDropGeometry';
import { resizeTargetIds } from './useAxisResize';
import { projectSelection } from '@workbook/read/selection';

type Axis = 'row' | 'column';
type Options = {
  sheet: SheetTabularProjection; selection?: CellSelection | null; selectionOwner?: symbol | null;
  activeSheetId?: string | null; enabled: boolean; allowColumns: boolean;
  columns: GridAxisProjection['columns']; rows: GridAxisProjection['rows'];
  columnMetrics: GridAxisMetrics; rowMetrics: GridAxisMetrics;
  gridRef: RefObject<HTMLDivElement>; scrollContainerRef: RefObject<HTMLElement>;
  select?: (mode: 'rows' | 'columns', target: CellTarget, extend: boolean, gesture?: SelectionGesture) => void;
  settle?: (owner: symbol) => void; gather?: (axis: Axis, ids: readonly string[], gap: number) => void;
};
type Session = { axis: Axis; ids: readonly string[]; order: readonly string[]; sheetId: string; owner: symbol | null | undefined;
  gesture?: symbol; awaitingOwner: boolean; selection?: CellSelection | null; activeSheetId: string | null | undefined; pointerId: number; element: HTMLElement;
  x: number; y: number; moved: boolean };
type Preview = { axis: Axis; start: number; size: number; gap: number };

export function useAxisGather(options: Options) {
  const latest = useRef(options); latest.current = options;
  const session = useRef<Session | null>(null);
  const [active, setActive] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const cancel = useCallback(() => {
    const current = session.current; session.current = null;
    setActive(false); setPreview(null);
    if (current?.element.hasPointerCapture?.(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
    if (current?.gesture) latest.current.settle?.(current.gesture);
  }, []);
  const owns = useCallback(() => {
    const current = session.current; const next = latest.current;
    if (!current || !next.enabled || !next.gather || !current.element.isConnected || current.sheetId !== next.sheet.id
      || (next.activeSheetId !== current.activeSheetId && !(current.awaitingOwner && next.activeSheetId === current.sheetId))
      || (next.activeSheetId != null && next.activeSheetId !== current.sheetId && !current.awaitingOwner)
      || (current.axis === 'column' && !next.allowColumns)) return false;
    const order = current.axis === 'row' ? next.sheet.rows : next.sheet.columns;
    if (order.length !== current.order.length || order.some((id, i) => id !== current.order[i])) return false;
    if (current.awaitingOwner && next.selectionOwner === current.gesture) { current.awaitingOwner = false; current.activeSheetId = next.activeSheetId; current.selection = next.selection; }
    if (!current.awaitingOwner && current.selection !== next.selection) return false;
    return next.selectionOwner === undefined || next.selectionOwner === (current.awaitingOwner ? current.owner : current.gesture ?? current.owner);
  }, []);
  useLayoutEffect(() => { if (session.current && !owns()) cancel(); });
  useLayoutEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    const hidden = () => { if (document.visibilityState === 'hidden') cancel(); };
    window.addEventListener('keydown', key, true); window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', hidden); cancel(); };
  }, [cancel]);
  function target(x: number, y: number): Preview | null {
    const current = session.current; const next = latest.current; const container = next.scrollContainerRef.current;
    if (!current || !container) return null;
    const rect = container.getBoundingClientRect(); const scale = logicalUnitsPerRenderedPixel(container, rect);
    const px = (x - rect.left) * scale.x; const py = (y - rect.top) * scale.y;
    if (px < 0 || py < 0 || px > container.clientWidth || py > container.clientHeight) return null;
    if (current.axis === 'row' ? px >= GRID_ROW_HEADER_WIDTH : py >= GRID_COLUMN_HEADER_HEIGHT) return null;
    if (current.axis === 'row' ? py < GRID_COLUMN_HEADER_HEIGHT : px < GRID_ROW_HEADER_WIDTH) return null;
    const entries = current.axis === 'row' ? next.rows : next.columns;
    const metrics = current.axis === 'row' ? next.rowMetrics : next.columnMetrics;
    const offset = current.axis === 'row' ? py + container.scrollTop - GRID_COLUMN_HEADER_HEIGHT : px + container.scrollLeft - GRID_ROW_HEADER_WIDTH;
    const gap = axisDropGap(entries, metrics, offset);
    if (gap === undefined) return null;
    const block = axisGatherBlock(entries, metrics, current.ids, gap);
    return block ? { axis: current.axis, gap, ...block } : null;
  }
  function start(event: PointerEvent<HTMLButtonElement>, axis: Axis, id: string) {
    event.stopPropagation();
    const next = latest.current; const element = next.gridRef.current;
    if (!element || !next.enabled || !next.gather || (axis === 'column' && !next.allowColumns)
      || event.button !== 0 || event.isPrimary === false || session.current) return;
    const ids = resizeTargetIds(next.sheet, axis, id, next.selection);
    if (!ids.length) return;
    event.preventDefault();
    const projection = next.selection && projectSelection({ id: next.sheet.id, content: next.sheet }, next.selection);
    const sourceSelected = next.selection?.mode === (axis === 'row' ? 'rows' : 'columns')
      && (axis === 'row' ? projection?.rows : projection?.columns)?.includes(id);
    let gesture: symbol | undefined;
    if (!sourceSelected) {
      const index = (axis === 'row' ? next.sheet.rows : next.sheet.columns).indexOf(id);
      const targetCell = cellTargetAt(next.sheet, cellKey({ rowIndex: axis === 'row' ? index : 0, columnIndex: axis === 'column' ? index : 0 }));
      if (!targetCell || !next.select) return;
      gesture = Symbol('axis-gather');
      next.select(axis === 'row' ? 'rows' : 'columns', targetCell, false, { owner: gesture, start: true });
    }
    session.current = { axis, ids, order: [...(axis === 'row' ? next.sheet.rows : next.sheet.columns)], sheetId: next.sheet.id,
      owner: next.selectionOwner, gesture, awaitingOwner: Boolean(gesture), selection: next.selection, activeSheetId: next.activeSheetId,
      pointerId: event.pointerId, element, x: event.clientX, y: event.clientY, moved: false };
    setActive(true); element.setPointerCapture?.(event.pointerId);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = session.current; if (!current || current.pointerId !== event.pointerId) return;
    if (!owns()) { cancel(); return; }
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 4) current.moved = true;
    setPreview(current.moved ? target(event.clientX, event.clientY) : null);
  }
  function stop(event: PointerEvent<HTMLDivElement>) {
    const current = session.current; if (!current || current.pointerId !== event.pointerId) return;
    const valid = owns() && (!current.awaitingOwner || latest.current.selectionOwner === undefined);
    const moved = current.moved || Math.hypot(event.clientX - current.x, event.clientY - current.y) > 4;
    const result = valid && moved ? target(event.clientX, event.clientY) : null;
    cancel();
    if (result) latest.current.gather?.(current.axis, current.ids, result.gap);
  }
  function interrupt(event: PointerEvent<HTMLDivElement>) { if (session.current?.pointerId === event.pointerId) cancel(); }
  return { active, preview, start, move, stop, interrupt };
}
