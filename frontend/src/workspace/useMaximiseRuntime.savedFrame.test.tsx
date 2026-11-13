import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMaximiseRuntime } from './useMaximiseRuntime';
import { canvasPresentation, restoredViewport } from './maximiseGeometry';

const saved = { position: { x: 100, y: 200 }, size: { width: 400, height: 300 }, visualScale: 0.8 };
const size = { width: 800, height: 600 };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([
  { ...saved, visualScale: 2 },
  { ...saved, size: { width: 500, height: 400 } },
  { ...saved, size: { ...saved.size, height: 400 } },
  { ...saved, position: { x: -100, y: 500 } },
  { ...saved, position: { ...saved.position, y: 500 } },
])('restores current persisted geometry after a maximised edit and its undo: %j', (edited) => {
  const handoff = { freezeDisplayedViewport: () => ({ x: 0, y: 0, scale: 1 }), commitFrozenViewport: vi.fn() };
  const { result, rerender } = renderHook(({ frame }) => useMaximiseRuntime(handoff, size, true, () => true, () => frame), { initialProps: { frame: saved } });
  act(() => result.current.enter('sheet', saved));
  act(() => result.current.zoom(1.5));
  const workingView = result.current.presentation;
  rerender({ frame: edited });
  expect(result.current.presentation).toEqual(workingView);
  expect(result.current.state.frame).toEqual(edited);
  act(() => result.current.toggle());
  expect(handoff.commitFrozenViewport).toHaveBeenLastCalledWith(restoredViewport(edited, size));
  act(() => result.current.enter('sheet', edited));
  rerender({ frame: saved });
  act(() => result.current.toggle());
  expect(handoff.commitFrozenViewport).toHaveBeenLastCalledWith(restoredViewport(saved, size));
});

it('retains entry continuity and target ownership while refreshing its saved restore frame', async () => {
  let callback: FrameRequestCallback = () => {};
  vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => { callback = next; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const handoff = { freezeDisplayedViewport: () => ({ x: 0, y: 0, scale: 1 }), commitFrozenViewport: vi.fn() };
  const { result, rerender } = renderHook(({ frame }) => useMaximiseRuntime(handoff, size, false, () => true, () => frame), { initialProps: { frame: saved } });
  act(() => result.current.enter('sheet', saved));
  const pending = result.current.ensureMaximised('sheet');
  const motion = result.current.state.motion;
  const edited = { ...saved, visualScale: 2 };
  rerender({ frame: edited });
  expect(result.current.state.motion).toBe(motion);
  expect(result.current.state.frame).toEqual(edited);
  act(() => callback(performance.now() + 1000));
  expect(await pending).toBe('settled');
  act(() => result.current.toggle());
  act(() => callback(performance.now() + 1000));
  expect(handoff.commitFrozenViewport).toHaveBeenCalledWith(restoredViewport(edited, size));
});

it.each([false, true])('retargets an owned restore continuously when committed geometry changes (reduced=%s)', async (reduced) => {
  let callback: FrameRequestCallback = () => {};
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => { callback = next; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const handoff = { freezeDisplayedViewport: () => ({ x: 0, y: 0, scale: 1 }), commitFrozenViewport: vi.fn() };
  const { result, rerender } = renderHook(({ frame, reducedMotion }) => useMaximiseRuntime(handoff, size, reducedMotion, () => true, () => frame), {
    initialProps: { frame: saved, reducedMotion: true },
  });
  act(() => result.current.enter('sheet', saved));
  rerender({ frame: saved, reducedMotion: false });
  let pending!: Promise<string>;
  act(() => { pending = result.current.ensureCanvas(); });
  now = 100;
  act(() => callback(now));
  const displayed = result.current.currentPresentation();
  const stale = callback;
  const edited = { position: { x: -200, y: 300 }, size: { width: 500, height: 350 }, visualScale: 2 };
  rerender({ frame: edited, reducedMotion: reduced });
  if (!reduced) {
    expect(result.current.presentation).toEqual(displayed);
    expect(result.current.state.motion?.to).toEqual(canvasPresentation(edited, restoredViewport(edited, size)));
    act(() => stale(1000));
    expect(result.current.state.mode).toBe('restoring');
    now = 600;
    act(() => callback(now));
  }
  expect(await pending).toBe('settled');
  expect(handoff.commitFrozenViewport).toHaveBeenCalledTimes(1);
  expect(handoff.commitFrozenViewport).toHaveBeenCalledWith(restoredViewport(edited, size));
  expect(result.current.state.mode).toBe('canvas');
});
