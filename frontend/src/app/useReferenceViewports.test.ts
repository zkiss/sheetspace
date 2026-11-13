import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useReferenceViewports } from './useReferenceViewports';

it('buffers the latest reports while paused and flushes them together on settlement', () => {
  const { result, rerender } = renderHook(({ paused }) => useReferenceViewports(paused), { initialProps: { paused: false } });
  const report = (id: string, width: number) => result.current.reportReferenceViewport(id, { scrollLeft: 1, scrollTop: 2, width, height: 80 });
  act(() => { report('a', 100); report('b', 200); });
  const original = result.current.referenceGridViewports;
  rerender({ paused: true });
  act(() => { report('a', 110); report('a', 120); result.current.reportReferenceViewport('b', null); });
  expect(result.current.referenceGridViewports).toBe(original);
  rerender({ paused: false });
  expect(result.current.referenceGridViewports.a?.size.width).toBe(120);
  expect(result.current.referenceGridViewports.b).toBeUndefined();
  const settled = result.current.referenceGridViewports;
  act(() => report('a', 120));
  expect(result.current.referenceGridViewports).toBe(settled);
});

it('retains the final cancelled geometry and the latest rendering mode', () => {
  const { result, rerender } = renderHook(({ paused }) => useReferenceViewports(paused), { initialProps: { paused: true } });
  act(() => {
    result.current.reportReferenceViewport('a', { scrollLeft: 0, scrollTop: 0, width: 150, height: 80 });
    result.current.reportReferenceViewport('a', { scrollLeft: 0, scrollTop: 0, width: 100, height: 80 });
    result.current.reportReferenceRenderingMode('b', 'overview');
  });
  rerender({ paused: false });
  expect(result.current.referenceGridViewports.a?.size.width).toBe(100);
  expect(result.current.referenceGridViewports.b?.renderingMode).toBe('overview');
});
