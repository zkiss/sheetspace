import { useCallback, useEffect, useState, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { GRID_COLUMN_HEADER_HEIGHT, GRID_ROW_HEADER_WIDTH } from './gridGeometry';
import { isNativeEditorTarget } from './gridScrollInput';
import type { GridAxisMetrics } from './gridAxisMetrics';
import type { SheetGridProps } from './SheetGridProps';

export function useGridViewport({ scrollContainerRef, onScrollContainerAvailable, onReferenceViewport, onUserViewportMovement, sheetId, rowMetrics, columnMetrics }: {
  scrollContainerRef: RefObject<HTMLElement>; onScrollContainerAvailable: SheetGridProps['onScrollContainerAvailable'];
  onReferenceViewport: SheetGridProps['onReferenceViewport']; onUserViewportMovement: SheetGridProps['onUserViewportMovement'];
  sheetId: string; rowMetrics: GridAxisMetrics; columnMetrics: GridAxisMetrics;
}) {
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(scrollContainerRef.current);
  const rowItemKey = useCallback((index: number) => rowMetrics.itemKey(index) ?? index, [rowMetrics]);
  const columnItemKey = useCallback((index: number) => columnMetrics.itemKey(index) ?? index, [columnMetrics]);
  const rowItemSize = useCallback((index: number) => rowMetrics.itemSize(index) ?? 0, [rowMetrics]);
  const columnItemSize = useCallback((index: number) => columnMetrics.itemSize(index) ?? 0, [columnMetrics]);
  useEffect(() => { setScrollElement(scrollContainerRef.current); }, [scrollContainerRef]);
  useEffect(() => {
    const element = scrollContainerRef.current;
    onScrollContainerAvailable?.(element);
    return () => onScrollContainerAvailable?.(null);
  }, [onScrollContainerAvailable, scrollContainerRef]);
  useEffect(() => {
    const element = scrollContainerRef.current;
    if (!element || !onReferenceViewport) return;
    const measure = () => ({ scrollLeft: element.scrollLeft, scrollTop: element.scrollTop, width: element.clientWidth, height: element.clientHeight });
    const report = () => onReferenceViewport(sheetId, measure(), measure);
    report();
    element.addEventListener('scroll', report, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(report);
    observer?.observe(element);
    return () => { element.removeEventListener('scroll', report); observer?.disconnect(); onReferenceViewport(sheetId, null); };
  }, [onReferenceViewport, scrollContainerRef, sheetId]);
  useEffect(() => {
    const element = scrollContainerRef.current;
    if (!element || !onUserViewportMovement) return;
    const reportWheel = () => onUserViewportMovement(); const reportTouchMove = () => onUserViewportMovement();
    const reportScrollKey = (event: KeyboardEvent) => {
      if (isNativeEditorTarget(event.target)) return;
      if ([' ', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) onUserViewportMovement();
    };
    const reportScrollbarPointer = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      const inVerticalScrollbar = event.clientX >= rect.left + element.clientWidth; const inHorizontalScrollbar = event.clientY >= rect.top + element.clientHeight;
      if (inVerticalScrollbar || inHorizontalScrollbar) onUserViewportMovement();
    };
    // A native scroll event carries no reliable provenance: script writes,
    // virtualizer reveals, and user gestures all dispatch the same event. Only
    // input that can originate a user scroll is allowed to arm history.
    element.addEventListener('wheel', reportWheel, { passive: true });
    element.addEventListener('touchmove', reportTouchMove, { passive: true });
    element.addEventListener('keydown', reportScrollKey);
    element.addEventListener('pointerdown', reportScrollbarPointer, { passive: true });
    return () => {
      element.removeEventListener('wheel', reportWheel); element.removeEventListener('touchmove', reportTouchMove);
      element.removeEventListener('keydown', reportScrollKey); element.removeEventListener('pointerdown', reportScrollbarPointer);
    };
  }, [onUserViewportMovement, scrollContainerRef]);
  const rowVirtualizer = useVirtualizer({
    count: rowMetrics.count,
    estimateSize: rowItemSize,
    getItemKey: rowItemKey,
    getScrollElement: () => scrollElement,
    initialRect: { height: 600, width: 800 },
    overscan: 3,
    paddingStart: GRID_COLUMN_HEADER_HEIGHT,
  });
  const columnVirtualizer = useVirtualizer({
    count: columnMetrics.count,
    estimateSize: columnItemSize,
    getItemKey: columnItemKey,
    horizontal: true,
    getScrollElement: () => scrollElement,
    initialRect: { height: 600, width: 800 },
    overscan: 2,
    paddingStart: GRID_ROW_HEADER_WIDTH,
  });
  useEffect(() => { rowVirtualizer.measure(); }, [rowMetrics, rowVirtualizer]);
  useEffect(() => { columnVirtualizer.measure(); }, [columnMetrics, columnVirtualizer]);
  return { rowVirtualizer, columnVirtualizer };
}
