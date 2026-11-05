import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { axisMotionSnapshot, planAxisMotion, type AxisMotionSnapshot } from './gridAxisMotion';
import { animateGridAxes, type GridAxisMotionPlan } from './gridAxisMotionEffects';
import type { GridAxisProjection } from './gridAxisProjection';
import type { GridAxisMetrics } from './gridAxisMetrics';
import { GRID_COLUMN_HEADER_HEIGHT, GRID_ROW_HEADER_WIDTH } from './gridGeometry';

type Snapshot = { rows: AxisMotionSnapshot; columns: AxisMotionSnapshot; context: string; owner: symbol | null | undefined };

function topology(items: AxisMotionSnapshot) {
  return [items.filter((item) => item.saved).map((item) => [item.key, item.size]).sort(),
    items.flatMap((item, index) => item.saved ? [] : [[index, item.key, item.size]])];
}

export function useGridAxisMotion({ gridRef, scrollContainerRef, projection, rowMetrics, columnMetrics, sheetId, activeSheetId, owner, enabled }: {
  gridRef: RefObject<HTMLDivElement>;
  scrollContainerRef: RefObject<HTMLElement>;
  projection: GridAxisProjection;
  rowMetrics: GridAxisMetrics;
  columnMetrics: GridAxisMetrics;
  sheetId: string;
  activeSheetId?: string | null;
  owner?: symbol | null;
  enabled: boolean;
}) {
  const previous = useRef<Snapshot>();
  const cancelEffects = useRef<() => void>();
  const activePlan = useRef<GridAxisMotionPlan | null>(null);
  const [plan, setPlan] = useState<GridAxisMotionPlan | null>(null);
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const clear = useCallback(() => {
    cancelEffects.current?.();
    cancelEffects.current = undefined;
    if (activePlan.current) { activePlan.current = null; setPlan(null); }
  }, []);
  useEffect(() => {
    const element = scrollContainerRef.current;
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const invalidate = () => clear();
    const changePreference = () => { setReduced(preference!.matches); clear(); };
    element?.addEventListener('scroll', invalidate, { passive: true });
    preference?.addEventListener?.('change', changePreference);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(invalidate);
    if (element) observer?.observe(element);
    return () => {
      element?.removeEventListener('scroll', invalidate);
      preference?.removeEventListener?.('change', changePreference);
      observer?.disconnect();
      cancelEffects.current?.();
    };
  }, [clear, scrollContainerRef]);
  useLayoutEffect(() => {
    const element = scrollContainerRef.current;
    const left = element?.scrollLeft ?? 0; const top = element?.scrollTop ?? 0;
    const width = Math.max(0, (element?.clientWidth || 800) - GRID_ROW_HEADER_WIDTH);
    const height = Math.max(0, (element?.clientHeight || 600) - GRID_COLUMN_HEADER_HEIGHT);
    const rows = axisMotionSnapshot(projection.rows, rowMetrics);
    const columns = axisMotionSnapshot(projection.columns, columnMetrics);
    const allowed = enabled && !reduced && (activeSheetId === undefined || activeSheetId === sheetId);
    const context = JSON.stringify([sheetId, activeSheetId, allowed, topology(rows), topology(columns)]);
    const before = previous.current;
    previous.current = { rows, columns, context, owner };
    if (!before) return;
    if (before.context !== context || before.owner !== owner || !allowed) { clear(); return; }
    if (JSON.stringify([before.rows, before.columns]) === JSON.stringify([rows, columns])) return;
    const next = { rows: planAxisMotion(before.rows, rows, top, height), columns: planAxisMotion(before.columns, columns, left, width) };
    clear();
    if (next.rows.some((item) => item.delta) || next.columns.some((item) => item.delta)) {
      activePlan.current = next;
      setPlan(next);
    }
  }, [scrollContainerRef, projection.rows, projection.columns, rowMetrics, columnMetrics, enabled, activeSheetId, sheetId, owner, clear, reduced]);
  useLayoutEffect(() => {
    if (!plan || !gridRef.current) return;
    const cancel = animateGridAxes(gridRef.current, plan, () => {
      if (activePlan.current === plan) { activePlan.current = null; setPlan(null); }
    });
    cancelEffects.current = cancel;
    return cancel;
  }, [gridRef, plan]);
  return plan;
}
