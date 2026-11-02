import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMaximiseRuntime } from './useMaximiseRuntime';
import { canvasPresentation, restoredViewport } from './maximiseGeometry';

const saved = { position: { x: 100, y: 200 }, size: { width: 400, height: 300 }, visualScale: 2 };
const size = { width: 800, height: 600 };
const displayed = { x: -40, y: 60, scale: 0.7 };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('samples the handoff and reverses continuously, then commits the native-scale restore', async () => {
  let now = 0;
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { callbacks.set(++nextId, cb); return nextId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  const handoff = { freezeDisplayedViewport: vi.fn(() => displayed), commitFrozenViewport: vi.fn() };
  const { result } = renderHook(() => useMaximiseRuntime(handoff, size, false, () => true));
  act(() => result.current.enter('sheet', saved));
  expect(result.current.presentation).toEqual(canvasPresentation(saved, displayed));
  const first = result.current.settled();
  now = 150;
  act(() => callbacks.get(nextId)!(now));
  const middle = result.current.presentation;
  act(() => result.current.toggle());
  expect(await first).toBe('cancelled');
  expect(result.current.presentation).toEqual(middle);
  const restored = result.current.settled();
  now = 450;
  act(() => callbacks.get(nextId)!(now));
  expect(await restored).toBe('settled');
  expect(handoff.commitFrozenViewport).toHaveBeenCalledWith(restoredViewport(saved, size));
  expect(result.current.state.mode).toBe('canvas');
});

it('settles reduced motion, handles resize, removal and unmount cancellation', async () => {
  const handoff = { freezeDisplayedViewport: vi.fn(() => displayed), commitFrozenViewport: vi.fn() };
  const { result, rerender, unmount } = renderHook(({ reduced, present, dimensions }) => useMaximiseRuntime(handoff, dimensions, reduced, () => present), { initialProps: { reduced: false, present: true, dimensions: size } });
  act(() => result.current.enter('sheet', saved));
  const pending = result.current.settled();
  rerender({ reduced: true, present: true, dimensions: { width: 900, height: 700 } });
  expect(await pending).toBe('cancelled');
  expect(result.current.state.mode).toBe('maximised');
  expect(result.current.presentation?.body.width).toBe(900);
  act(() => result.current.toggle());
  expect(handoff.commitFrozenViewport).toHaveBeenCalledWith(restoredViewport(saved, { width: 900, height: 700 }));
  act(() => result.current.enter('sheet', saved));
  rerender({ reduced: false, present: false, dimensions: size });
  expect(result.current.state.mode).toBe('canvas');
  rerender({ reduced: false, present: true, dimensions: size });
  act(() => result.current.enter('sheet', saved));
  const cancelled = result.current.settled();
  unmount();
  expect(await cancelled).toBe('cancelled');
});
