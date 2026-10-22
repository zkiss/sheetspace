import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceNavigationHistory } from './useWorkspaceNavigationHistory';

function scrollContainer(left: number, top: number) {
  const element = document.createElement('div');
  Object.defineProperties(element, {
    clientHeight: { value: 100 }, clientWidth: { value: 100 },
    scrollHeight: { value: 1_000 }, scrollWidth: { value: 1_000 },
  });
  element.scrollLeft = left;
  element.scrollTop = top;
  return element;
}

describe('useWorkspaceNavigationHistory', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function controlAnimationFrames() {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
    return () => {
      const scheduled = [...frames.values()];
      frames.clear();
      scheduled.forEach((frame) => frame(0));
    };
  }

  it('does not record an empty-scroll restoration until a later user movement', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ x }) => useWorkspaceNavigationHistory({
      onRestoreSelection: () => true,
      onUnavailableTarget: vi.fn(),
      restoreViewport: vi.fn(),
      selection: null,
      viewport: { x, y: 0, scale: 1 },
    }), { initialProps: { x: 1 } });

    rerender({ x: 2 });
    act(() => { result.current.history.recordUserMovement(); vi.advanceTimersByTime(2_000); });
    act(() => result.current.history.traverse('back'));

    // No grid is registered, so this restoration completes through the
    // empty-scroll path. Time alone must not create a new destination.
    act(() => vi.advanceTimersByTime(2_001));
    expect(result.current.history.canGoForward).toBe(true);

    rerender({ x: 3 });
    act(() => { result.current.history.recordUserMovement(); vi.advanceTimersByTime(2_000); });
    expect(result.current.history.canGoForward).toBe(true);
  });

  it('applies a restored offscreen grid scroll offset when its container mounts', () => {
    vi.useFakeTimers();
    const runAnimationFrames = controlAnimationFrames();
    const restoreViewport = vi.fn();
    const { result, rerender } = renderHook(({ x }) => useWorkspaceNavigationHistory({
      onRestoreSelection: () => true,
      onUnavailableTarget: vi.fn(),
      restoreViewport,
      selection: null,
      viewport: { x, y: 0, scale: 1 },
    }), { initialProps: { x: 1 } });
    const destination = scrollContainer(240, 360);
    act(() => result.current.registerScrollContainer('destination', destination));

    rerender({ x: 2 });
    act(() => result.current.history.recordUserMovement());
    act(() => vi.advanceTimersByTime(2_000));
    act(() => result.current.history.traverse('back'));
    act(() => result.current.registerScrollContainer('destination', null));
    act(() => result.current.history.traverse('forward'));
    const remounted = scrollContainer(0, 0);
    act(() => result.current.registerScrollContainer('destination', remounted));
    act(runAnimationFrames);

    expect(remounted.scrollLeft).toBe(240);
    expect(remounted.scrollTop).toBe(360);
  });

  it('reapplies saved offscreen scroll after selection restoration reveals its range', () => {
    vi.useFakeTimers();
    const runAnimationFrames = controlAnimationFrames();
    const selection = { anchor: { sheetId: 'destination', rowIndex: 3, columnIndex: 2 }, extent: { sheetId: 'destination', rowIndex: 3, columnIndex: 2 }, mode: 'cell' } as never;
    const { result, rerender } = renderHook(({ x }) => useWorkspaceNavigationHistory({
      onRestoreSelection: () => true,
      onUnavailableTarget: vi.fn(),
      restoreViewport: vi.fn(),
      selection,
      viewport: { x, y: 0, scale: 1 },
    }), { initialProps: { x: 1 } });
    const destination = scrollContainer(240, 360);
    act(() => result.current.registerScrollContainer('destination', destination));

    rerender({ x: 2 });
    act(() => result.current.history.recordUserMovement());
    act(() => vi.advanceTimersByTime(2_000));
    act(() => result.current.history.traverse('back'));
    act(() => result.current.registerScrollContainer('destination', null));
    act(() => result.current.history.traverse('forward'));
    const remounted = scrollContainer(0, 0);
    act(() => result.current.registerScrollContainer('destination', remounted));

    // This models SheetGrid's active-selection effect, which runs before rAF.
    remounted.scrollLeft = 700;
    remounted.scrollTop = 800;
    act(runAnimationFrames);

    expect(remounted.scrollLeft).toBe(240);
    expect(remounted.scrollTop).toBe(360);
  });

  it('does not turn a native notification from a restored clamped scroll into history', () => {
    vi.useFakeTimers();
    const runAnimationFrames = controlAnimationFrames();
    const restoreViewport = vi.fn();
    const { result, rerender } = renderHook(({ x }) => useWorkspaceNavigationHistory({
      onRestoreSelection: () => true,
      onUnavailableTarget: vi.fn(),
      restoreViewport,
      selection: null,
      viewport: { x, y: 0, scale: 1 },
    }), { initialProps: { x: 1 } });
    const grid = scrollContainer(240, 360);
    act(() => result.current.registerScrollContainer('destination', grid));

    // Refresh the initial context now that its grid is mounted.
    act(() => { result.current.history.recordUserMovement(); vi.advanceTimersByTime(2_000); });
    grid.scrollLeft = 700;
    grid.scrollTop = 800;
    rerender({ x: 2 });
    act(() => { result.current.history.recordUserMovement(); vi.advanceTimersByTime(2_000); });
    act(() => result.current.history.traverse('back'));
    act(runAnimationFrames);

    // Browsers may dispatch this after the rAF that assigned scrollTop.
    act(() => { result.current.recordGridScroll('destination'); vi.advanceTimersByTime(2_000); });
    expect(result.current.history.canGoForward).toBe(true);
    expect(grid.scrollLeft).toBe(240);
    expect(grid.scrollTop).toBe(360);
    act(() => result.current.history.traverse('back'));
    expect(restoreViewport).toHaveBeenLastCalledWith({ x: 1, y: 0, scale: 1 });
  });
});
