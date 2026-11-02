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

it('rejects unavailable sheets and invalid measurements without freezing the viewport', () => {
  const handoff = { freezeDisplayedViewport: vi.fn(() => displayed), commitFrozenViewport: vi.fn() };
  const { result, rerender } = renderHook(({ dimensions, present }) => useMaximiseRuntime(handoff, dimensions, false, () => present), {
    initialProps: { dimensions: null as typeof size | null, present: true },
  });
  for (const dimensions of [null, { width: 0, height: 600 }, { width: 800, height: -1 }, { width: NaN, height: 600 }, { width: 800, height: Infinity }]) {
    rerender({ dimensions, present: true });
    act(() => result.current.enter('sheet', saved));
  }
  rerender({ dimensions: size, present: false });
  act(() => result.current.enter('sheet', saved));
  expect(handoff.freezeDisplayedViewport).not.toHaveBeenCalled();
  expect(result.current.state.mode).toBe('canvas');
});

it('ignores repeated entry and stale animation callbacks after cancellation', async () => {
  let callback: FrameRequestCallback = () => {};
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { callback = cb; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const handoff = { freezeDisplayedViewport: vi.fn(() => displayed), commitFrozenViewport: vi.fn() };
  const { result } = renderHook(() => useMaximiseRuntime(handoff, size, false, () => true));
  act(() => result.current.enter('sheet', saved));
  const stale = callback;
  const pending = result.current.settled();
  act(() => result.current.enter('sheet', saved));
  expect(handoff.freezeDisplayedViewport).toHaveBeenCalledTimes(1);
  act(() => result.current.cancel());
  expect(await pending).toBe('cancelled');
  act(() => stale(performance.now() + 1000));
  expect(result.current.state.mode).toBe('canvas');
  expect(handoff.commitFrozenViewport).not.toHaveBeenCalled();
  expect(await result.current.settled()).toBe('settled');
});

it('zooms a maximised sheet and settles an in-flight restore when reduced motion is enabled', () => {
  const handoff = { freezeDisplayedViewport: vi.fn(() => displayed), commitFrozenViewport: vi.fn() };
  const { result, rerender } = renderHook(({ reduced }) => useMaximiseRuntime(handoff, size, reduced, () => true), { initialProps: { reduced: true } });
  act(() => result.current.enter('sheet', saved));
  act(() => result.current.zoom(1.5));
  expect(result.current.state.zoom).toBe(1.5);
  rerender({ reduced: false });
  act(() => result.current.toggle());
  expect(result.current.state.mode).toBe('restoring');
  rerender({ reduced: true });
  expect(result.current.state.mode).toBe('canvas');
  expect(handoff.commitFrozenViewport).toHaveBeenCalledWith(restoredViewport(saved, size));
});

it('retargets an in-flight restore to a resized surface when motion is reduced', () => {
  const handoff = { freezeDisplayedViewport: vi.fn(() => displayed), commitFrozenViewport: vi.fn() };
  const { result, rerender } = renderHook(({ dimensions, reduced }) => useMaximiseRuntime(handoff, dimensions, reduced, () => true), {
    initialProps: { dimensions: size, reduced: true },
  });
  act(() => result.current.enter('sheet', saved));
  rerender({ dimensions: size, reduced: false });
  act(() => result.current.toggle());
  const resized = { width: 1000, height: 700 };
  rerender({ dimensions: resized, reduced: true });
  expect(result.current.state.mode).toBe('canvas');
  expect(handoff.commitFrozenViewport).toHaveBeenCalledWith(restoredViewport(saved, resized));
});

it('replaces an active sheet and cancels its pending operation', async () => {
  const handoff = { freezeDisplayedViewport: vi.fn(() => displayed), commitFrozenViewport: vi.fn() };
  const { result } = renderHook(() => useMaximiseRuntime(handoff, size, false, () => true));
  act(() => result.current.enter('first', saved));
  const first = result.current.settled();
  act(() => result.current.enter('second', saved));
  expect(await first).toBe('cancelled');
  expect(result.current.state.sheetId).toBe('second');
  expect(handoff.freezeDisplayedViewport).toHaveBeenCalledTimes(2);
});
