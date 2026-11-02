import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMaximiseRuntime } from './useMaximiseRuntime';
import { useWorkspaceController } from './useWorkspaceController';

const saved = { position: { x: 100, y: 200 }, size: { width: 400, height: 300 }, visualScale: 1 };
const size = { width: 800, height: 600 };
const destination = { x: 600, y: 400, scale: 1 };

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it.each(['entry', 'restore'] as const)('preserves successor viewport navigation during a reentrant %s handoff', async (stage) => {
  vi.useFakeTimers();
  const { result } = renderHook(() => {
    const controller = useWorkspaceController({ onCreateSheet: vi.fn(), onClearSelection: vi.fn() });
    const runtime = useMaximiseRuntime(controller, size, true, () => true);
    return { controller, runtime };
  });
  if (stage === 'restore') act(() => result.current.runtime.enter('source', saved));
  const settled = vi.fn();
  const cancelled = vi.fn();
  act(() => {
    result.current.controller.restoreViewport({ x: 200, y: 100, scale: 2 }, undefined, () => {
      result.current.controller.restoreViewport(destination, settled, cancelled);
    });
  });
  let restore: Promise<'settled' | 'cancelled'> | undefined;
  act(() => {
    if (stage === 'entry') result.current.runtime.enter('stale', saved);
    else restore = result.current.runtime.ensureCanvas();
  });
  if (restore) expect(await restore).toBe('cancelled');
  expect(result.current.runtime.currentState().mode).toBe('canvas');
  act(() => vi.runAllTimers());
  expect(settled).toHaveBeenCalledOnce();
  expect(cancelled).not.toHaveBeenCalled();
  expect(result.current.controller.viewport).toEqual(destination);
  act(() => result.current.runtime.enter('successor', saved));
  expect(await result.current.runtime.ensureMaximised('successor')).toBe('settled');
});
