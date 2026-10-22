import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNavigationHistory } from './useNavigationHistory';

describe('useNavigationHistory', () => {
  afterEach(() => vi.useRealTimers());

  it('records one settled movement and flushes it before traversal', () => {
    vi.useFakeTimers();
    let x = 1;
    const restore = vi.fn();
    const { result } = renderHook(() => useNavigationHistory({
      capture: () => ({ viewport: { x, y: 0, scale: 1 }, selection: null, scroll: {} }), restore,
    }));
    act(() => { result.current.recordMovement(); vi.advanceTimersByTime(1_999); });
    expect(result.current.canGoBack).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.canGoBack).toBe(false);
    x = 2;
    act(() => { result.current.recordMovement(); vi.advanceTimersByTime(2_000); });
    expect(result.current.canGoBack).toBe(true);
    act(() => { result.current.traverse('back'); });
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ viewport: { x: 1, y: 0, scale: 1 } }));
  });

  it('captures departure and arrival around an explicit jump', () => {
    vi.useFakeTimers();
    let x = 1;
    const { result } = renderHook(() => useNavigationHistory({
      capture: () => ({ viewport: { x, y: 0, scale: 1 }, selection: null, scroll: {} }), restore: vi.fn(),
    }));
    act(() => result.current.explicitNavigation(() => { x = 2; }));
    act(() => vi.runOnlyPendingTimers());
    expect(result.current.canGoBack).toBe(true);
  });
});
