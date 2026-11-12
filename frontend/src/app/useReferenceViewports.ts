import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { GridReferenceViewport } from '@reference-navigation/contextualReferenceProjection';

type ViewportReport = { scrollLeft: number; scrollTop: number; width: number; height: number };

export function useReferenceViewports(paused: boolean) {
  const [referenceGridViewports, setViewports] = useState<Readonly<Record<string, GridReferenceViewport | undefined>>>({});
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const buffered = useRef(new Map<string, GridReferenceViewport | null>());
  const measurements = useRef(new Map<string, () => ViewportReport>());
  const apply = useCallback((updates: Map<string, GridReferenceViewport | null>) => {
    if (!updates.size) return;
    setViewports((current) => {
      let next: Record<string, GridReferenceViewport | undefined> = current;
      const copy = () => { if (next === current) next = { ...current }; return next; };
      for (const [sheetId, viewport] of updates) {
        const previous = next[sheetId];
        if (!viewport) {
          if (previous) delete copy()[sheetId];
        } else if (!previous || previous.scrollLeft !== viewport.scrollLeft || previous.scrollTop !== viewport.scrollTop
          || previous.size.width !== viewport.size.width || previous.size.height !== viewport.size.height
          || previous.renderingMode !== viewport.renderingMode) copy()[sheetId] = viewport;
      }
      return next;
    });
  }, []);
  const reportReferenceViewport = useCallback((sheetId: string, report: ViewportReport | null, measure?: () => ViewportReport) => {
    if (!report) measurements.current.delete(sheetId);
    else if (measure) measurements.current.set(sheetId, measure);
    const viewport: GridReferenceViewport | null = report && {
      scrollLeft: report.scrollLeft, scrollTop: report.scrollTop,
      size: { width: report.width, height: report.height }, mounted: true, renderingMode: 'detailed',
    };
    if (pausedRef.current) buffered.current.set(sheetId, viewport);
    else {
      buffered.current.delete(sheetId);
      apply(new Map([[sheetId, viewport]]));
    }
  }, [apply]);
  useLayoutEffect(() => {
    if (paused) return;
    const updates = buffered.current;
    buffered.current = new Map();
    for (const [sheetId, measure] of measurements.current) {
      const pending = updates.get(sheetId);
      if (updates.has(sheetId) && (!pending || pending.renderingMode !== 'detailed')) continue;
      const report = measure();
      updates.set(sheetId, { scrollLeft: report.scrollLeft, scrollTop: report.scrollTop,
        size: { width: report.width, height: report.height }, mounted: true, renderingMode: 'detailed' });
    }
    apply(updates);
  }, [apply, paused]);
  const reportReferenceRenderingMode = useCallback((sheetId: string, renderingMode: 'detailed' | 'overview') => {
    if (renderingMode === 'detailed') return;
    if (pausedRef.current) {
      buffered.current.set(sheetId, { scrollLeft: 0, scrollTop: 0, size: { width: 0, height: 0 }, mounted: true, renderingMode });
    } else {
      buffered.current.delete(sheetId);
      apply(new Map([[sheetId, { scrollLeft: 0, scrollTop: 0, size: { width: 0, height: 0 }, mounted: true, renderingMode }]]));
    }
  }, [apply]);
  return { referenceGridViewports, reportReferenceViewport, reportReferenceRenderingMode };
}
