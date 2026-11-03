import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';
import type { CellRange } from '@workbook/core/address';
import type { SheetDocument } from '@workbook/core/model';
import { visibleExtractionCoverage } from './extractionPaintCoverage';
import type { ExtractionCoverage } from './useExtractionHandoff';

type Operation = { token: number; source: SheetDocument; targetId: string; range: CellRange; ready: boolean };

export function useExtractionPaintCoverage(surface: RefObject<HTMLElement>, operation: Operation | null,
  targetReady: (token: number) => void, targetNotReady: (token: number) => void, empty: (token: number) => void, geometryRevision: unknown,
  registerCoverage?: (token: number, measure: () => ExtractionCoverage) => () => void) {
  useLayoutEffect(() => {
    const root = surface.current;
    if (!root || !operation) return;
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => check());
    const observed = new WeakSet<Element>();
    const observe = (element: Element) => {
      if (!observed.has(element)) { observed.add(element); resize?.observe(element); }
    };
    const measure = (): ExtractionCoverage => {
      if (!root.isConnected) return 'unknown';
      const frames = Array.from(root.querySelectorAll('[data-workspace-sheet-frame]'));
      const source = frames.find((frame) => frame.getAttribute('data-sheet-id') === operation.source.id);
      const target = frames.find((frame) => frame.getAttribute('data-sheet-id') === operation.targetId);
      return source ? visibleExtractionCoverage(root, source, target, operation.range, operation.source) : 'unknown';
    };
    const unregister = registerCoverage?.(operation.token, measure);
    const check = () => {
      observe(root);
      root.querySelectorAll('[data-workspace-sheet-frame]').forEach((frame) => {
        observe(frame);
        frame.querySelectorAll('.sheet-frame-body, .sheet-grid').forEach(observe);
      });
      const coverage = measure();
      if (coverage === 'empty') empty(operation.token);
      else if (coverage === 'covered') targetReady(operation.token);
      else targetNotReady(operation.token);
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'class'] });
    root.addEventListener('scroll', check, true);
    window.addEventListener('resize', check);
    return () => { unregister?.(); observer.disconnect(); resize?.disconnect(); root.removeEventListener('scroll', check, true); window.removeEventListener('resize', check); };
  }, [surface, operation, targetReady, targetNotReady, empty, geometryRevision, registerCoverage]);
}
