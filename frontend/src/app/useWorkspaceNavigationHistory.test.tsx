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
      restoreViewport: (_viewport, complete) => { complete(); return () => {}; },
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
    const restoreViewport = vi.fn((_viewport, complete) => { complete(); return () => {}; });
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
      restoreViewport: (_viewport, complete) => { complete(); return () => {}; },
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

  it('records only an explicit user grid movement, never a programmatic scroll write', () => {
    vi.useFakeTimers();
    const runAnimationFrames = controlAnimationFrames();
    const restoreViewport = vi.fn((_viewport, complete) => { complete(); return () => {}; });
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

    // The restore writes offsets directly. A native scroll notification from that
    // write has no user provenance and is intentionally not an API ingress.
    grid.dispatchEvent(new Event('scroll'));
    act(() => vi.advanceTimersByTime(2_000));
    expect(result.current.history.canGoForward).toBe(true);
    expect(grid.scrollLeft).toBe(240);
    expect(grid.scrollTop).toBe(360);
    act(() => result.current.history.traverse('back'));
    expect(restoreViewport).toHaveBeenLastCalledWith({ x: 1, y: 0, scale: 1 }, expect.any(Function));

    grid.scrollTop = 500;
    act(() => { result.current.recordUserGridMovement(); vi.advanceTimersByTime(2_000); });
    expect(result.current.history.canGoForward).toBe(true);
  });

  it('waits for both viewport motion and the selected grid scroll before completing restoration', () => {
    vi.useFakeTimers();
    const runAnimationFrames = controlAnimationFrames();
    let settleViewport: (() => void) | undefined;
    const restoreViewport = vi.fn((_viewport, complete) => {
      settleViewport = complete;
      return () => { settleViewport = undefined; };
    });
    const selection = { anchor: { sheetId: 'destination', rowIndex: 3, columnIndex: 2 }, extent: { sheetId: 'destination', rowIndex: 3, columnIndex: 2 }, mode: 'cell' } as never;
    const { result, rerender } = renderHook(({ x }) => useWorkspaceNavigationHistory({
      onRestoreSelection: () => true, onUnavailableTarget: vi.fn(), restoreViewport, selection, viewport: { x, y: 0, scale: 1 },
    }), { initialProps: { x: 1 } });
    const grid = scrollContainer(240, 360);
    act(() => result.current.registerScrollContainer('destination', grid));
    act(() => { result.current.history.recordUserMovement(); vi.advanceTimersByTime(2_000); });
    grid.scrollLeft = 700;
    rerender({ x: 2 });
    act(() => { result.current.history.recordUserMovement(); vi.advanceTimersByTime(2_000); result.current.history.traverse('back'); });

    // Grid reveal runs independently of outer motion. Neither acknowledgement
    // is a substitute for the other.
    act(runAnimationFrames);
    expect(grid.scrollLeft).toBe(240);
    act(() => settleViewport?.());
    expect(result.current.history.canGoForward).toBe(true);
  });

  it('cancels delayed grid restoration before an intervening user gesture can be overwritten', () => {
    vi.useFakeTimers();
    const runAnimationFrames = controlAnimationFrames();
    let settleViewport: (() => void) | undefined;
    const selection = { anchor: { sheetId: 'destination', rowIndex: 3, columnIndex: 2 }, extent: { sheetId: 'destination', rowIndex: 3, columnIndex: 2 }, mode: 'cell' } as never;
    const { result, rerender } = renderHook(({ x }) => useWorkspaceNavigationHistory({
      onRestoreSelection: () => true,
      onUnavailableTarget: vi.fn(),
      restoreViewport: (_viewport, complete) => { settleViewport = complete; return () => { settleViewport = undefined; }; },
      selection,
      viewport: { x, y: 0, scale: 1 },
    }), { initialProps: { x: 1 } });
    const grid = scrollContainer(240, 360);
    act(() => result.current.registerScrollContainer('destination', grid));
    act(() => { result.current.history.recordUserMovement(); vi.advanceTimersByTime(2_000); });
    grid.scrollLeft = 700;
    rerender({ x: 2 });
    act(() => { result.current.history.recordUserMovement(); vi.advanceTimersByTime(2_000); result.current.history.traverse('back'); });

    grid.scrollLeft = 500;
    act(() => result.current.recordUserGridMovement());
    act(runAnimationFrames);
    act(() => settleViewport?.());

    expect(grid.scrollLeft).toBe(500);
  });
});
