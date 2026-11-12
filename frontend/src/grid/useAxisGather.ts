import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject, type MutableRefObject } from 'react';
import type { SheetTabularProjection } from '@workbook/core/model';
import { cellKey, columnIndexToLabel } from '@workbook/core/address';
import { cellTargetAt } from './cellInteraction';
import type { CellSelection, SelectionGesture, CellTarget } from './cellInteractionContracts';
import type { GridAxisProjection } from './gridAxisProjection';
import type { GridAxisMetrics } from './gridAxisMetrics';
import { GRID_COLUMN_HEADER_HEIGHT, GRID_ROW_HEADER_WIDTH } from './gridGeometry';
import { axisDropGap, axisGatherBlock } from './axisDropGeometry';
import { resizeTargetIds } from './useAxisResize';
import { projectSelection } from '@workbook/read/selection';

type Axis = 'row' | 'column';
type Options = {
  sheet: SheetTabularProjection; selection?: CellSelection | null; selectionOwner?: symbol | null;
  activeSheetId?: string | null; modelId?: string; enabled: boolean; allowColumns: boolean;
  columns: GridAxisProjection['columns']; rows: GridAxisProjection['rows'];
  columnMetrics: GridAxisMetrics; rowMetrics: GridAxisMetrics;
  columnLabels?: ReadonlyMap<string, string>;
  gridRef: RefObject<HTMLDivElement>; scrollContainerRef: RefObject<HTMLElement>;
  completedGatherOwner?: MutableRefObject<symbol | null>;
  select?: (mode: 'rows' | 'columns', target: CellTarget, extend: boolean, gesture?: SelectionGesture) => void;
  settle?: (owner: symbol) => void; focus?: (target: CellTarget) => void; gather?: (axis: Axis, ids: readonly string[], gap: number) => void;
};
type CardBase = { id: string; label: string; width: number; height: number; order: number; homeX: number; homeY: number };
export type AxisGatherCard = CardBase & { x: number; y: number };
export type AxisGatherDeck = { axis: Axis; cards: readonly AxisGatherCard[]; primaryId: string };
export type AxisGatherFlight = { axis: Axis; cards: readonly (AxisGatherCard & { toX: number; toY: number; toWidth: number; toHeight: number })[] };
type Session = { axis: Axis; ids: readonly string[]; order: readonly string[]; projection: string; sheetId: string; modelId?: string; owner: symbol | null | undefined;
  gesture?: symbol; awaitingOwner: boolean; selection?: CellSelection | null; activeSheetId: string | null | undefined; pointerId: number; element: HTMLElement;
  primaryId: string; cards: readonly CardBase[]; grabClientX: number; grabClientY: number;
  x: number; y: number; clientX: number; clientY: number; moved: boolean; focusTarget?: CellTarget };
type Preview = { axis: Axis; start: number; line: number; gap: number };
const DECK_VISIBLE_CARDS = 3;
const DECK_STACK_OFFSET = 4;
const FLIGHT_MS = 220;
const projectionKey = (entries: GridAxisProjection['rows'] | GridAxisProjection['columns']) => JSON.stringify(entries.map((entry) =>
  entry.kind === 'saved' ? [entry.kind, entry.id, entry.durableIndex] : [entry.kind, entry.operationId, entry.boundary]));

export function useAxisGather(options: Options) {
  const latest = useRef(options); latest.current = options;
  const session = useRef<Session | null>(null);
  const frame = useRef<number | null>(null);
  const flightTimer = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [deck, setDeck] = useState<AxisGatherDeck | null>(null);
  const [flight, setFlight] = useState<AxisGatherFlight | null>(null);
  const dismissFlight = useCallback(() => {
    if (flightTimer.current !== null) window.clearTimeout(flightTimer.current);
    flightTimer.current = null;
    setFlight(null);
  }, []);
  useEffect(() => () => { if (flightTimer.current !== null) window.clearTimeout(flightTimer.current); }, []);
  const cancel = useCallback(() => {
    const current = session.current; session.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setActive(false); setPreview(null); setDeck(null);
    if (current?.element.hasPointerCapture?.(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
    if (current?.gesture) latest.current.settle?.(current.gesture);
  }, []);
  const owns = useCallback(() => {
    const current = session.current; const next = latest.current;
    if (!current || !next.enabled || !next.gather || !current.element.isConnected || current.sheetId !== next.sheet.id || current.modelId !== next.modelId
      || (next.activeSheetId !== current.activeSheetId && !(current.awaitingOwner && next.activeSheetId === current.sheetId))
      || (next.activeSheetId != null && next.activeSheetId !== current.sheetId && !current.awaitingOwner)
      || (current.axis === 'column' && !next.allowColumns)) return false;
    const order = current.axis === 'row' ? next.sheet.rows : next.sheet.columns;
    if (order.length !== current.order.length || order.some((id, i) => id !== current.order[i])) return false;
    if (projectionKey(current.axis === 'row' ? next.rows : next.columns) !== current.projection) return false;
    if (current.awaitingOwner && next.selectionOwner === current.gesture) { current.awaitingOwner = false; current.activeSheetId = next.activeSheetId; current.selection = next.selection; }
    if (!current.awaitingOwner && current.selection !== next.selection) return false;
    return next.selectionOwner === undefined || next.selectionOwner === (current.awaitingOwner ? current.owner : current.gesture ?? current.owner);
  }, []);
  const interruptRef = useRef<() => void>(() => cancel());
  useLayoutEffect(() => { if (session.current && !owns()) interruptRef.current(); });
  useLayoutEffect(() => {
    const interrupt = () => interruptRef.current();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') interrupt(); };
    const hidden = () => { if (document.visibilityState === 'hidden') interrupt(); };
    window.addEventListener('keydown', key, true); window.addEventListener('blur', interrupt);
    document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('blur', interrupt); document.removeEventListener('visibilitychange', hidden); cancel(); };
  }, [cancel]);
  function target(x: number, y: number): Preview | null {
    const current = session.current; const next = latest.current; const container = next.scrollContainerRef.current;
    if (!current || !container) return null;
    if (document.elementFromPoint && !container.contains(document.elementFromPoint(x, y))) return null;
    const rect = container.getBoundingClientRect();
    const px = (x - rect.left) * (rect.width ? container.offsetWidth / rect.width : 1) - container.clientLeft;
    const py = (y - rect.top) * (rect.height ? container.offsetHeight / rect.height : 1) - container.clientTop;
    if (px < 0 || py < 0 || px > container.clientWidth || py > container.clientHeight) return null;
    const entries = current.axis === 'row' ? next.rows : next.columns;
    const metrics = current.axis === 'row' ? next.rowMetrics : next.columnMetrics;
    // Drop anywhere over the sheet, not only over the header strip: the line
    // shows where the block will land. Clamp to the axis range when the pointer
    // is over a sticky header on the cross axis.
    const offset = current.axis === 'row' ? py + container.scrollTop - GRID_COLUMN_HEADER_HEIGHT : px + container.scrollLeft - GRID_ROW_HEADER_WIDTH;
    const gap = axisDropGap(entries, metrics, Math.max(0, Math.min(metrics.totalSize, offset)));
    if (gap === undefined) return null;
    const block = axisGatherBlock(entries, metrics, current.ids, gap);
    if (!block) return null;
    // The block start already accounts for lifting the moved rows out. The
    // insertion line must sit on the boundary that exists right now, so add
    // back the moved rows that sit above it.
    const selected = new Set(current.ids);
    let line = block.start;
    for (const [index, entry] of entries.entries()) {
      if (entry.kind !== 'saved' || !selected.has(entry.id) || entry.durableIndex >= gap) continue;
      line += metrics.itemSize(index) ?? 0;
    }
    return { axis: current.axis, gap, start: block.start, line };
  }
  function deckAt(current: Session, clientX: number, clientY: number): AxisGatherDeck | null {
    const grid = latest.current.gridRef.current;
    if (!grid) return null;
    const rect = grid.getBoundingClientRect();
    const scaleX = rect.width ? grid.offsetWidth / rect.width : 1;
    const scaleY = rect.height ? grid.offsetHeight / rect.height : 1;
    const anchorX = (clientX - current.grabClientX - rect.left) * scaleX;
    const anchorY = (clientY - current.grabClientY - rect.top) * scaleY;
    // The dragged header stays on top; every other card tucks in behind it.
    // Only the first three depths are visible, so a long selection still reads
    // as a small deck.
    const primary = current.cards.find((card) => card.id === current.primaryId);
    const ordered = primary ? [primary, ...current.cards.filter((card) => card.id !== current.primaryId)] : current.cards;
    const cards = ordered.map((card, index) => {
      const depth = Math.min(index, DECK_VISIBLE_CARDS - 1);
      return {
        ...card,
        width: primary?.width ?? card.width,
        height: primary?.height ?? card.height,
        x: anchorX + depth * DECK_STACK_OFFSET,
        y: anchorY + depth * DECK_STACK_OFFSET,
      };
    });
    return { axis: current.axis, cards, primaryId: current.primaryId };
  }
  function flightFor(current: Session, clientX: number, clientY: number, result: Preview | null): AxisGatherFlight | null {
    const currentDeck = deckAt(current, clientX, clientY);
    if (!currentDeck) return null;
    const next = latest.current; const container = next.scrollContainerRef.current;
    const entries = current.axis === 'row' ? next.rows : next.columns;
    const metrics = current.axis === 'row' ? next.rowMetrics : next.columnMetrics;
    let running = 0;
    const targets = new Map<string, number>();
    if (result) {
      running = result.start;
      for (const card of current.cards) {
        targets.set(card.id, running);
        running += current.axis === 'row' ? card.height : card.width;
      }
    } else {
      for (const card of currentDeck.cards) {
        const index = entries.findIndex((entry) => entry.kind === 'saved' && entry.id === card.id);
        targets.set(card.id, index < 0 ? 0 : metrics.itemOffset(index) ?? 0);
      }
    }
    const scrollLeft = container?.scrollLeft ?? 0;
    const scrollTop = container?.scrollTop ?? 0;
    const originalCards = new Map(current.cards.map((card) => [card.id, card]));
    return {
      axis: current.axis,
      cards: currentDeck.cards.map((card) => ({
        ...card,
        toX: current.axis === 'row' ? scrollLeft : targets.get(card.id) ?? 0,
        toY: current.axis === 'row' ? targets.get(card.id) ?? 0 : scrollTop,
        toWidth: originalCards.get(card.id)?.width ?? card.width,
        toHeight: originalCards.get(card.id)?.height ?? card.height,
      })),
    };
  }
  function showFlight(next: AxisGatherFlight) {
    dismissFlight();
    setFlight(next);
    flightTimer.current = window.setTimeout(dismissFlight, FLIGHT_MS + 120);
  }
  function cardsFor(axis: Axis, ids: readonly string[]): readonly CardBase[] | null {
    const next = latest.current;
    const container = next.scrollContainerRef.current;
    const entries = axis === 'row' ? next.rows : next.columns;
    const metrics = axis === 'row' ? next.rowMetrics : next.columnMetrics;
    const scrollLeft = container?.scrollLeft ?? 0;
    const scrollTop = container?.scrollTop ?? 0;
    const cards: CardBase[] = [];
    for (const [order, id] of ids.entries()) {
      const index = entries.findIndex((entry) => entry.kind === 'saved' && entry.id === id);
      const entry = entries[index];
      const size = metrics.itemSize(index);
      if (index < 0 || !entry || entry.kind !== 'saved' || size === undefined) return null;
      const offset = metrics.itemOffset(index) ?? 0;
      cards.push(axis === 'row'
        ? { id, label: String(entry.durableIndex + 1), width: GRID_ROW_HEADER_WIDTH, height: size, order, homeX: scrollLeft, homeY: offset }
        : { id, label: next.columnLabels?.get(id) ?? columnIndexToLabel(entry.durableIndex), width: size, height: GRID_COLUMN_HEADER_HEIGHT, order, homeX: offset, homeY: scrollTop });
    }
    return cards;
  }
  function update() {
    const current = session.current; const container = latest.current.scrollContainerRef.current;
    if (!current || !container || !owns()) { if (current) cancelWithFlight(); return; }
    setDeck(current.moved ? deckAt(current, current.clientX, current.clientY) : null);
    const result = current.moved ? target(current.clientX, current.clientY) : null;
    setPreview(result);
    if (!result) {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      return;
    }
    if (frame.current !== null) return;
    const rect = container.getBoundingClientRect();
    const row = current.axis === 'row';
    const scale = row ? rect.height / container.offsetHeight : rect.width / container.offsetWidth;
    if (!Number.isFinite(scale) || scale <= 0) return;
    const position = row ? current.clientY - rect.top : current.clientX - rect.left;
    const start = ((row ? container.clientTop + GRID_COLUMN_HEADER_HEIGHT : container.clientLeft + GRID_ROW_HEADER_WIDTH) * scale);
    const end = ((row ? container.clientTop + container.clientHeight : container.clientLeft + container.clientWidth) * scale);
    const edge = 32;
    const velocity = position < start + edge ? -Math.min(1, (start + edge - position) / edge)
      : position > end - edge ? Math.min(1, (position - end + edge) / edge) : 0;
    const scroll = row ? container.scrollTop : container.scrollLeft;
    const max = row ? container.scrollHeight - container.clientHeight : container.scrollWidth - container.clientWidth;
    if (!velocity || (velocity < 0 ? scroll <= 0 : scroll >= max)) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (session.current !== current || !owns()) { if (session.current === current) cancelWithFlight(); return; }
      if (!target(current.clientX, current.clientY)) { setPreview(null); return; }
      const before = row ? container.scrollTop : container.scrollLeft;
      const value = Math.max(0, Math.min(max, before + velocity * 12 / scale));
      if (row) container.scrollTop = value; else container.scrollLeft = value;
      if ((row ? container.scrollTop : container.scrollLeft) !== before) update();
    });
  }
  const updateRef = useRef(update); updateRef.current = update;
  useEffect(() => {
    const container = options.scrollContainerRef.current;
    const onScroll = () => updateRef.current();
    container?.addEventListener('scroll', onScroll);
    return () => container?.removeEventListener('scroll', onScroll);
  }, [options.scrollContainerRef]);
  function begin(event: PointerEvent<HTMLElement>, axis: Axis, id: string): boolean {
    const next = latest.current; const element = next.gridRef.current;
    if (!element || !next.enabled || !next.gather || (axis === 'column' && !next.allowColumns)) return false;
    const ids = resizeTargetIds(next.sheet, axis, id, next.selection);
    if (!ids.length) return false;
    event.preventDefault();
    event.stopPropagation();
    const projection = next.selection && projectSelection({ id: next.sheet.id, content: next.sheet }, next.selection);
    const sourceSelected = next.selection?.mode === (axis === 'row' ? 'rows' : 'columns')
      && (axis === 'row' ? projection?.rows : projection?.columns)?.includes(id);
    const cards = cardsFor(axis, ids);
    if (!cards) return false;
    let gesture: symbol | undefined; let focusTarget: CellTarget | undefined;
    if (!sourceSelected) {
      const index = (axis === 'row' ? next.sheet.rows : next.sheet.columns).indexOf(id);
      const targetCell = cellTargetAt(next.sheet, cellKey({ rowIndex: axis === 'row' ? index : 0, columnIndex: axis === 'column' ? index : 0 }));
      if (!targetCell || !next.select) return false;
      focusTarget = targetCell;
      gesture = Symbol('axis-gather');
      next.select(axis === 'row' ? 'rows' : 'columns', targetCell, false, { owner: gesture, start: true });
    }
    const source = event.target instanceof Element
      ? event.target.closest<HTMLElement>('.sheet-grid-row-header, .sheet-grid-column-header') ?? element
      : element;
    const sourceRect = source.getBoundingClientRect();
    const grabClientX = event.clientX - sourceRect.left;
    const grabClientY = event.clientY - sourceRect.top;
    dismissFlight();
    session.current = { axis, ids, order: [...(axis === 'row' ? next.sheet.rows : next.sheet.columns)], projection: projectionKey(axis === 'row' ? next.rows : next.columns), sheetId: next.sheet.id, modelId: next.modelId,
      owner: next.selectionOwner, gesture, awaitingOwner: Boolean(gesture), selection: next.selection, activeSheetId: next.activeSheetId,
      primaryId: id, cards, grabClientX, grabClientY,
      pointerId: event.pointerId, element, x: event.clientX, y: event.clientY, clientX: event.clientX, clientY: event.clientY, moved: false, focusTarget };
    setActive(true); setDeck(null); element.setPointerCapture?.(event.pointerId);
    return true;
  }
  function press(event: PointerEvent<HTMLElement>, axis: Axis, id: string): boolean {
    const next = latest.current;
    if (!next.enabled || !next.gather || (axis === 'column' && !next.allowColumns)
      || event.button !== 0 || event.isPrimary === false || session.current
      || event.shiftKey || event.ctrlKey || event.metaKey) return false;
    // Selecting headers by dragging comes first. Once a full row or column
    // selection exists, dragging any header reorders: there is no second press
    // or timing gate. Shift, Ctrl and Cmd still drag a selection.
    if (next.selection?.mode !== (axis === 'row' ? 'rows' : 'columns')) return false;
    return begin(event, axis, id);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = session.current; if (!current || current.pointerId !== event.pointerId) return;
    if (!owns()) { cancelWithFlight(); return; }
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 4) current.moved = true;
    current.clientX = event.clientX; current.clientY = event.clientY;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    update();
  }
  function stop(event: PointerEvent<HTMLDivElement>) {
    const current = session.current; if (!current || current.pointerId !== event.pointerId) return;
    const valid = owns() && (!current.awaitingOwner || latest.current.selectionOwner === undefined);
    const moved = current.moved || Math.hypot(event.clientX - current.x, event.clientY - current.y) > 4;
    const result = valid && moved ? target(event.clientX, event.clientY) : null;
    if (result && latest.current.completedGatherOwner) latest.current.completedGatherOwner.current = current.gesture ?? null;
    if (valid && current.focusTarget) latest.current.focus?.(current.focusTarget);
    if (moved) {
      const nextFlight = flightFor(current, event.clientX, event.clientY, valid ? result : null);
      if (nextFlight) showFlight(nextFlight);
    }
    cancel();
    if (result) latest.current.gather?.(current.axis, current.ids, result.gap);
  }
  function cancelWithFlight() {
    const current = session.current;
    if (current?.moved) {
      const nextFlight = flightFor(current, current.clientX, current.clientY, null);
      if (nextFlight) showFlight(nextFlight);
    }
    cancel();
  }
  interruptRef.current = cancelWithFlight;
  function interrupt(event: PointerEvent<HTMLDivElement>) { if (session.current?.pointerId === event.pointerId) cancelWithFlight(); }
  return { active, preview, deck, flight, dismissFlight, press, move, stop, interrupt };
}
