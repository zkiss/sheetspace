import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';
import type { CellRange } from '@workbook/core/address';
import { extractionPaintCoverage } from './extractionPaintCoverage';

type Operation = { token: number; sourceId: string; targetId: string; range: CellRange; ready: boolean };

export function useExtractionPaintCoverage(surface: RefObject<HTMLElement>, operation: Operation | null,
  targetReady: (token: number) => void, geometryRevision: unknown) {
  useLayoutEffect(() => {
    const root = surface.current;
    if (!root || !operation || operation.ready) return;
    const check = () => {
      const frames = Array.from(root.querySelectorAll('[data-workspace-sheet-frame]'));
      const source = frames.find((frame) => frame.getAttribute('data-sheet-id') === operation.sourceId);
      const target = frames.find((frame) => frame.getAttribute('data-sheet-id') === operation.targetId);
      if (source && target && extractionPaintCoverage(root, source, target, operation.range)) targetReady(operation.token);
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check);
    resize?.observe(root);
    root.addEventListener('scroll', check, true);
    window.addEventListener('resize', check);
    return () => { observer.disconnect(); resize?.disconnect(); root.removeEventListener('scroll', check, true); window.removeEventListener('resize', check); };
  }, [surface, operation, targetReady, geometryRevision]);
}
