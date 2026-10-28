import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDisplayedWorkspaceViewport } from './useDisplayedWorkspaceViewport';
import { mountedWorkspaceFrameIds } from './workspaceFrameVirtualization';

afterEach(() => vi.restoreAllMocks());

it('samples running animations on frames and stops sampling after they finish', () => {
  const plane = document.createElement('div');
  plane.dataset.navigationMotion = 'smooth';
  const ref = { current: plane };
  const animation = { playState: 'running' } as Animation;
  vi.spyOn(plane, 'getAnimations').mockReturnValue([animation]);
  let transform = 'matrix(1, 0, 0, 1, 10, 20)';
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ transform }) as CSSStyleDeclaration);
  let frame: FrameRequestCallback | undefined;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frame = callback; return 1; });
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const viewport = { x: 0, y: 0, scale: 1 };
  const { result, unmount } = renderHook(() => useDisplayedWorkspaceViewport(ref, viewport));

  expect(result.current).toEqual({ x: 10, y: 20, scale: 1 });
  transform = 'matrix(2, 0, 0, 2, 30, 40)';
  Object.defineProperty(animation, 'playState', { value: 'finished' });
  act(() => frame?.(16));
  expect(result.current).toEqual({ x: 30, y: 40, scale: 2 });
  expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
  unmount();
  expect(cancel).toHaveBeenCalledWith(1);
});

it('reports no animations for an ordinary jsdom element', () => {
  expect(document.createElement('div').getAnimations()).toEqual([]);
});

it('keeps frames at the displayed camera mounted until the animation leaves them', () => {
  const plane = document.createElement('div');
  plane.dataset.navigationMotion = 'smooth';
  const animation = { playState: 'running' } as Animation;
  vi.spyOn(plane, 'getAnimations').mockReturnValue([animation]);
  let transform = 'matrix(1, 0, 0, 1, 0, 0)';
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ transform }) as CSSStyleDeclaration);
  let frame: FrameRequestCallback | undefined;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frame = callback; return 1; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const destination = { x: -3000, y: 0, scale: 1 };
  const { result } = renderHook(() => useDisplayedWorkspaceViewport({ current: plane }, destination));
  const frames = [
    { id: 'source', name: 'Source', position: { x: 40, y: 40 }, size: { width: 240, height: 160 }, visualScale: 1, zIndex: 1 },
    { id: 'destination', name: 'Destination', position: { x: 3040, y: 40 }, size: { width: 240, height: 160 }, visualScale: 1, zIndex: 2 },
  ];
  const mounted = (pins: { pendingFocusSheetId?: string }) => [...mountedWorkspaceFrameIds({
    frames, surfaceSize: { width: 800, height: 600 }, viewport: result.current, pins,
  })];

  expect(mounted({ pendingFocusSheetId: 'destination' })).toEqual(['source', 'destination']);
  transform = 'matrix(1, 0, 0, 1, -3000, 0)';
  Object.defineProperty(animation, 'playState', { value: 'finished' });
  act(() => frame?.(16));
  expect(mounted({})).toEqual(['destination']);
});
