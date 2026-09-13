import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import type { AxisSizeWrite, SheetTabularProjection } from '@workbook/core/model';
import { AXIS_SIZE_LIMITS } from '@workbook/core/axisSizePolicy';
import type { CellSelection } from './cellInteractionContracts';

import type { AxisResizePreview } from './gridAxisMetrics';
type Session = AxisResizePreview & {
  pointerId: number; element: HTMLElement; origin: number; initialSize: number; scale: number;
  sheetId: string; selection: CellSelection | null | undefined; owner: symbol | null | undefined;
  activeSheetId: string | null | undefined;
};

export function resizeTargetIds(sheet: SheetTabularProjection, axis: AxisSizeWrite['axis'], id: string, selection?: CellSelection | null) {
  const ids = axis === 'row' ? sheet.rows : sheet.columns;
  if (!ids.includes(id)) return [];
  if (selection?.mode !== (axis === 'row' ? 'rows' : 'columns')
    || selection.anchor.sheetId !== sheet.id || selection.extent.sheetId !== sheet.id) return [id];
  const start = ids.indexOf(axis === 'row' ? selection.anchor.cell.rowId : selection.anchor.cell.columnId);
  const end = ids.indexOf(axis === 'row' ? selection.extent.cell.rowId : selection.extent.cell.columnId);
  const index = ids.indexOf(id);
  return start >= 0 && end >= 0 && index >= Math.min(start, end) && index <= Math.max(start, end)
    ? ids.slice(Math.min(start, end), Math.max(start, end) + 1) : [id];
}

export function useAxisResize(options: {
  sheet: SheetTabularProjection; selection?: CellSelection | null; selectionOwner?: symbol | null;
  activeSheetId?: string | null; commit?: (writes: readonly AxisSizeWrite[]) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const session = useRef<Session | null>(null);
  const [preview, setPreview] = useState<(AxisResizePreview & { originId: string }) | null>(null);
  const cancel = useCallback(() => {
    const current = session.current;
    session.current = null;
    setPreview(null);
    if (current?.element.hasPointerCapture?.(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
  }, []);
  const detachHandle = useCallback((element: HTMLElement) => {
    if (session.current?.element === element) cancel();
  }, [cancel]);
  const ownsSession = () => {
    const current = session.current;
    const next = latest.current;
    return current && current.element.isConnected && next.commit && current.sheetId === next.sheet.id && current.selection === next.selection
      && current.owner === next.selectionOwner && current.activeSheetId === next.activeSheetId
      && current.ids.every((id) => (current.axis === 'row' ? next.sheet.rows : next.sheet.columns).includes(id));
  };
  useEffect(() => { if (session.current && !ownsSession()) cancel(); });
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    const hidden = () => { if (document.visibilityState === 'hidden') cancel(); };
    // A focused cell editor stops Escape from bubbling; cancel the resize first.
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', hidden);
      cancel();
    };
  }, [cancel]);
  function start(event: PointerEvent<HTMLElement>, axis: AxisSizeWrite['axis'], id: string, initialSize: number) {
    event.stopPropagation();
    if (event.button !== 0 || session.current || !options.commit) return;
    event.preventDefault();
    const header = event.currentTarget.parentElement!;
    const rect = header.getBoundingClientRect();
    const renderedSize = axis === 'row' ? rect.height : rect.width;
    const scale = renderedSize > 0 ? renderedSize / initialSize : 1;
    const ids = resizeTargetIds(options.sheet, axis, id, options.selection);
    if (!ids.length) return;
    session.current = { axis, ids, size: initialSize, initialSize, scale, element: event.currentTarget,
      pointerId: event.pointerId, origin: axis === 'row' ? event.clientY : event.clientX,
      sheetId: options.sheet.id, selection: options.selection, owner: options.selectionOwner, activeSheetId: options.activeSheetId };
    setPreview({ axis, ids, size: initialSize, originId: id });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function move(event: PointerEvent<HTMLElement>) {
    event.stopPropagation();
    const current = session.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!ownsSession()) { cancel(); return; }
    const delta = ((current.axis === 'row' ? event.clientY : event.clientX) - current.origin) / current.scale;
    if (!Number.isFinite(delta)) return;
    const { min, max } = AXIS_SIZE_LIMITS[current.axis];
    current.size = Math.min(max, Math.max(min, current.initialSize + delta));
    setPreview((previous) => previous && { ...previous, size: current.size });
  }
  function stop(event: PointerEvent<HTMLElement>) {
    event.stopPropagation();
    if (session.current?.pointerId !== event.pointerId) return;
    move(event);
    const current = session.current;
    const valid = ownsSession();
    cancel();
    if (current && valid) latest.current.commit?.(current.ids.map((axisId) => ({ axis: current.axis, axisId, size: current.size })));
  }
  function interrupt(event: PointerEvent<HTMLElement>) {
    event.stopPropagation();
    if (session.current?.pointerId === event.pointerId) cancel();
  }
  return { preview, start, move, stop, interrupt, detachHandle };
}
