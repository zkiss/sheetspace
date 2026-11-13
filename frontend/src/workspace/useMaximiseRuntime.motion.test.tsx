import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMaximiseRuntime } from './useMaximiseRuntime';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('paints live samples without rendering and cancels only its own restore flyover', () => {
  let now = 0;
  let tick: FrameRequestCallback = () => {};
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { tick = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const cancelOwned = vi.fn();
  const handoff = { freezeDisplayedViewport: () => ({ x: 0, y: 0, scale: 1 }), commitFrozenViewport: vi.fn(), restoreViewport: vi.fn(() => cancelOwned) };
  const paint = vi.fn();
  const saved = { position: { x: 100, y: 200 }, size: { width: 400, height: 300 }, visualScale: 1 };
  let renders = 0;
  const { result } = renderHook(() => { renders++; return useMaximiseRuntime(handoff, { width: 800, height: 600 }, false, () => true, undefined, paint); });
  act(() => result.current.enter('one', saved));
  const boundary = result.current.presentation;
  const boundaryRenders = renders;
  now = 200;
  act(() => tick(now));
  expect(renders).toBe(boundaryRenders);
  expect(result.current.presentation).toEqual(boundary);
  expect(result.current.currentPresentation()).not.toEqual(boundary);
  expect(paint).toHaveBeenLastCalledWith(result.current.currentPresentation(), result.current.state);
  act(() => result.current.toggle());
  expect(handoff.restoreViewport).toHaveBeenCalledWith(expect.anything(), undefined, expect.any(Function), 475);
  act(() => result.current.toggle());
  expect(cancelOwned).toHaveBeenCalledOnce();
});

it('settles cancellation even when the viewport refuses the flyover synchronously', async () => {
  let tick: FrameRequestCallback = () => {};
  vi.spyOn(performance, 'now').mockReturnValue(0);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { tick = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const handoff = {
    freezeDisplayedViewport: () => ({ x: 0, y: 0, scale: 1 }),
    commitFrozenViewport: vi.fn(),
    restoreViewport: (_viewport: unknown, _settled?: () => void, cancelled?: () => void) => { cancelled?.(); return vi.fn(); },
  };
  const saved = { position: { x: 100, y: 200 }, size: { width: 400, height: 300 }, visualScale: 1 };
  const { result } = renderHook(() => useMaximiseRuntime(handoff, { width: 800, height: 600 }, false, () => true));
  act(() => result.current.enter('one', saved));
  act(() => tick(475));
  act(() => result.current.toggle());
  expect(result.current.currentState().mode).toBe('canvas');
  expect(await result.current.settled()).toBe('settled');
  expect(handoff.commitFrozenViewport).not.toHaveBeenCalled();
});
