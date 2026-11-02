import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMaximiseRuntime } from './useMaximiseRuntime';
import { canvasPresentation, restoredViewport } from './maximiseGeometry';
import { useSheetCreationRoute } from '../app/useSheetCreationRoute';

const saved = { position: { x: 100, y: 200 }, size: { width: 400, height: 300 }, visualScale: 2 };
const size = { width: 800, height: 600 };
const displayed = { x: -40, y: 60, scale: 0.7 };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('does not publish an entry superseded during its viewport handoff', async () => {
  const handoff = { freezeDisplayedViewport: vi.fn(() => displayed), commitFrozenViewport: vi.fn() };
  const { result } = renderHook(() => useMaximiseRuntime(handoff, size, true, () => true));
  handoff.freezeDisplayedViewport.mockImplementationOnce(() => {
    result.current.cancel();
    result.current.enter('successor', saved);
    return displayed;
  });
  act(() => result.current.enter('stale', saved));
  expect(result.current.currentState().sheetId).toBe('successor');
  expect(await result.current.ensureMaximised('successor')).toBe('settled');
  expect(await result.current.ensureMaximised('stale')).toBe('cancelled');
});

it.each(['immediate', 'animated', 'resize'] as const)('does not publish a %s restore superseded during its viewport handoff', async (kind) => {
  let callback: FrameRequestCallback = () => {};
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { callback = cb; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const handoff = { freezeDisplayedViewport: vi.fn(() => displayed), commitFrozenViewport: vi.fn() };
  const { result, rerender } = renderHook(({ dimensions, reduced }) => useMaximiseRuntime(handoff, dimensions, reduced, () => true), {
    initialProps: { dimensions: size, reduced: true },
  });
  act(() => result.current.enter('source', saved));
  if (kind !== 'immediate') rerender({ dimensions: size, reduced: false });
  handoff.commitFrozenViewport.mockImplementationOnce(() => result.current.enter('successor', saved));
  act(() => result.current.toggle());
  if (kind === 'animated') act(() => callback(performance.now() + 1000));
  if (kind === 'resize') rerender({ dimensions: { width: 1000, height: 700 }, reduced: true });
  if (kind === 'animated') act(() => callback(performance.now() + 1000));
  expect(result.current.currentState().sheetId).toBe('successor');
  expect(await result.current.ensureMaximised('successor')).toBe('settled');
  expect(result.current.currentState().mode).toBe('maximised');
});

it('marks coordinator-owned entry as a programmatic viewport handoff', () => {
  const handoff = { freezeDisplayedViewport: vi.fn(() => displayed), commitFrozenViewport: vi.fn() };
  const { result } = renderHook(() => useMaximiseRuntime(handoff, size, true, () => true));
  act(() => result.current.enter('sheet', saved, saved, true));
  expect(handoff.freezeDisplayedViewport).toHaveBeenCalledWith(true);
});

it('settles target ownership across entering resize but not reversal or removal', async () => {
  let callback: FrameRequestCallback = () => {};
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { callback = cb; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const handoff = { freezeDisplayedViewport: vi.fn(() => displayed), commitFrozenViewport: vi.fn() };
  const { result, rerender } = renderHook(({ dimensions, present }) => useMaximiseRuntime(handoff, dimensions, false, () => present), { initialProps: { dimensions: size, present: true } });
  act(() => result.current.enter('sheet', saved));
  const pending = result.current.ensureMaximised('sheet');
  rerender({ dimensions: { width: 1000, height: 700 }, present: true });
  act(() => callback(performance.now() + 1000));
  expect(await pending).toBe('settled');
  expect(result.current.currentState().sheetId).toBe('sheet');
  act(() => result.current.toggle());
  expect(await result.current.ensureMaximised('sheet')).toBe('cancelled');
  act(() => result.current.toggle());
  const removed = result.current.ensureMaximised('sheet');
  rerender({ dimensions: size, present: false });
  expect(await removed).toBe('cancelled');
});

it('preserves semantic target readiness when resize enables reduced motion', async () => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const handoff = { freezeDisplayedViewport: vi.fn(() => displayed), commitFrozenViewport: vi.fn() };
  const { result, rerender } = renderHook(({ dimensions, reduced }) => useMaximiseRuntime(handoff, dimensions, reduced, () => true), {
    initialProps: { dimensions: size, reduced: false },
  });
  act(() => result.current.enter('sheet', saved));
  const pending = result.current.ensureMaximised('sheet');
  rerender({ dimensions: { width: 1000, height: 700 }, reduced: true });
  expect(await pending).toBe('settled');
  expect(result.current.currentState().mode).toBe('maximised');
});

it('opens one creation dialog after a resized restore settles', async () => {
  let callback: FrameRequestCallback = () => {};
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { callback = cb; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const handoff = { freezeDisplayedViewport: vi.fn(() => displayed), commitFrozenViewport: vi.fn() };
  const open = vi.fn();
  const { result, rerender } = renderHook(({ dimensions }) => {
    const runtime = useMaximiseRuntime(handoff, dimensions, false, () => true);
    const create = useSheetCreationRoute({ ensureCanvas: runtime.ensureCanvas, openCreationDialog: open, presentationActive: runtime.state.mode !== 'canvas' });
    return { runtime, create };
  }, { initialProps: { dimensions: size } });
  act(() => result.current.runtime.enter('sheet', saved));
  act(() => { result.current.create(); result.current.create(); });
  const stale = callback;
  const resized = { width: 1000, height: 700 };
  rerender({ dimensions: resized });
  act(() => stale(performance.now() + 1000));
  expect(open).not.toHaveBeenCalled();
  await act(async () => { callback(performance.now() + 1000); });
  expect(open).toHaveBeenCalledOnce();
  expect(handoff.commitFrozenViewport).toHaveBeenCalledWith(restoredViewport(saved, resized));
});

it('cancels a creation restore after resize if the user reverses it', async () => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const handoff = { freezeDisplayedViewport: vi.fn(() => displayed), commitFrozenViewport: vi.fn() };
  const open = vi.fn();
  const { result, rerender } = renderHook(({ dimensions }) => {
    const runtime = useMaximiseRuntime(handoff, dimensions, false, () => true);
    const create = useSheetCreationRoute({ ensureCanvas: runtime.ensureCanvas, openCreationDialog: open, presentationActive: runtime.state.mode !== 'canvas' });
    return { runtime, create };
  }, { initialProps: { dimensions: size } });
  act(() => result.current.runtime.enter('sheet', saved));
  act(() => result.current.create());
  rerender({ dimensions: { width: 1000, height: 700 } });
  await act(async () => { result.current.runtime.toggle(); });
  expect(open).not.toHaveBeenCalled();
});

it('joins a restore and cancels all canvas requests if it is reversed', async () => {
  let callback: FrameRequestCallback = () => {};
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { callback = cb; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const handoff = { freezeDisplayedViewport: vi.fn(() => displayed), commitFrozenViewport: vi.fn() };
  const { result } = renderHook(() => useMaximiseRuntime(handoff, size, false, () => true));
  act(() => result.current.enter('sheet', saved));
  let first!: Promise<string>;
  let second!: Promise<string>;
  act(() => { first = result.current.ensureCanvas(); second = result.current.ensureCanvas(); });
  expect(result.current.state.mode).toBe('restoring');
  act(() => result.current.toggle());
  expect(await first).toBe('cancelled');
  expect(await second).toBe('cancelled');
  let last!: Promise<string>;
  act(() => { last = result.current.ensureCanvas(); });
  act(() => callback(performance.now() + 1000));
  expect(await last).toBe('settled');
  expect(handoff.commitFrozenViewport).toHaveBeenCalledTimes(1);
});

it('invalidates a settled canvas request when presentation ownership changes or unmounts', async () => {
  const handoff = { freezeDisplayedViewport: vi.fn(() => displayed), commitFrozenViewport: vi.fn() };
  const { result, unmount } = renderHook(() => useMaximiseRuntime(handoff, size, true, () => true));
  const pending = result.current.ensureCanvas();
  act(() => result.current.enter('sheet', saved));
  expect(await pending).toBe('cancelled');
  let restored!: Promise<string>;
  act(() => { restored = result.current.ensureCanvas(); });
  unmount();
  expect(await restored).toBe('cancelled');
});

it('cancels a canvas request when the owned sheet disappears during restoration', async () => {
  const handoff = { freezeDisplayedViewport: vi.fn(() => displayed), commitFrozenViewport: vi.fn() };
  const { result, rerender } = renderHook(({ present }) => useMaximiseRuntime(handoff, size, false, () => present), { initialProps: { present: true } });
  act(() => result.current.enter('sheet', saved));
  let pending!: Promise<string>;
  act(() => { pending = result.current.ensureCanvas(); });
  rerender({ present: false });
  expect(await pending).toBe('cancelled');
  expect(handoff.commitFrozenViewport).not.toHaveBeenCalled();
});

it('samples the handoff and reverses continuously, then commits the native-scale restore', async () => {
  let now = 0;
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { callbacks.set(++nextId, cb); return nextId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  const handoff = { freezeDisplayedViewport: vi.fn(() => displayed), commitFrozenViewport: vi.fn() };
  const { result } = renderHook(() => useMaximiseRuntime(handoff, size, false, () => true));
  const preview = { position: { x: 35, y: 70 }, size: { width: 510, height: 350 }, visualScale: 1.3 };
  act(() => result.current.enter('sheet', saved, preview));
  expect(result.current.presentation).toEqual(canvasPresentation(preview, displayed));
  expect(result.current.state.frame).toEqual(saved);
  const first = result.current.settled();
  now = 150;
  act(() => callbacks.get(nextId)!(now));
  const middle = result.current.presentation;
  act(() => result.current.toggle());
  expect(await first).toBe('cancelled');
  expect(result.current.presentation).toEqual(middle);
  expect(result.current.state.motion?.to).toEqual(canvasPresentation(saved, restoredViewport(saved, size)));
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

it.each(['entering', 'restoring'] as const)('retargets an in-flight %s resize from its sampled presentation and ignores stale completion', async (mode) => {
  let now = 0;
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++nextId, callback); return nextId; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const handoff = { freezeDisplayedViewport: vi.fn(() => displayed), commitFrozenViewport: vi.fn() };
  const { result, rerender } = renderHook(({ dimensions }) => useMaximiseRuntime(handoff, dimensions, false, () => true), { initialProps: { dimensions: size } });
  act(() => result.current.enter('sheet', saved));
  if (mode === 'restoring') {
    now = 300;
    act(() => callbacks.get(nextId)!(now));
    act(() => result.current.toggle());
  }
  const pending = result.current.settled();
  now += 100;
  act(() => callbacks.get(nextId)!(now));
  const middle = result.current.presentation;
  const stale = callbacks.get(nextId)!;
  const resized = { width: 1000, height: 700 };
  rerender({ dimensions: resized });
  expect(await pending).toBe('cancelled');
  expect(result.current.presentation).toEqual(middle);
  const retargeted = result.current.settled();
  act(() => stale(now + 1000));
  expect(result.current.state.mode).toBe(mode);
  expect(result.current.presentation).toEqual(middle);
  expect(handoff.commitFrozenViewport).not.toHaveBeenCalled();
  now += 300;
  act(() => callbacks.get(nextId)!(now));
  expect(await retargeted).toBe('settled');
  if (mode === 'entering') {
    expect(result.current.state.mode).toBe('maximised');
    expect(result.current.presentation?.body).toEqual({ left: 0, top: 0, width: 1000, height: 700 });
  } else {
    expect(result.current.state.mode).toBe('canvas');
    expect(handoff.commitFrozenViewport).toHaveBeenCalledOnce();
    expect(handoff.commitFrozenViewport).toHaveBeenCalledWith(restoredViewport(saved, resized));
  }
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
