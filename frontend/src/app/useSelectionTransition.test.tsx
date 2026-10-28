import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSelectionTransition } from './useSelectionTransition';

const cell = (sheetId: string, rowId = 'row') => ({ sheetId, cell: { rowId, columnId: 'column' } });

describe('selection transition', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('only transitions between sheets and retains the source until expiry', () => {
    const source = cell('source');
    const sameSheet = cell('source', 'other');
    const destination = cell('destination');
    const { result, rerender } = renderHook(({ active }) => useSelectionTransition(active), {
      initialProps: { active: source },
    });

    rerender({ active: sameSheet });
    expect(result.current).toBeNull();
    rerender({ active: destination });
    expect(result.current).toEqual({ from: sameSheet, to: destination, id: 1 });
    act(() => vi.advanceTimersByTime(399));
    expect(result.current?.from).toEqual(sameSheet);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBeNull();
  });

  it('replaces a rapid transition and cancels its old expiry and unmount timer', () => {
    const source = cell('source');
    const middle = cell('middle');
    const destination = cell('destination');
    const { result, rerender, unmount } = renderHook(({ active }) => useSelectionTransition(active), {
      initialProps: { active: source },
    });

    rerender({ active: middle });
    act(() => vi.advanceTimersByTime(300));
    rerender({ active: destination });
    expect(result.current).toEqual({ from: middle, to: destination, id: 2 });
    act(() => vi.advanceTimersByTime(100));
    expect(result.current?.to).toEqual(destination);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
