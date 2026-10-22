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
  afterEach(() => vi.useRealTimers());

  it('applies a restored offscreen grid scroll offset when its container mounts', () => {
    vi.useFakeTimers();
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
    act(() => result.current.history.recordMovement());
    act(() => vi.advanceTimersByTime(2_000));
    act(() => result.current.history.traverse('back'));
    act(() => result.current.registerScrollContainer('destination', null));
    act(() => result.current.history.traverse('forward'));
    const remounted = scrollContainer(0, 0);
    act(() => result.current.registerScrollContainer('destination', remounted));

    expect(remounted.scrollLeft).toBe(240);
    expect(remounted.scrollTop).toBe(360);
  });
});
