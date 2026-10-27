import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDisplayedWorkspaceViewport } from './useDisplayedWorkspaceViewport';

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
