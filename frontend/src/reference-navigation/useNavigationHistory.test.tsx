import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
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
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ viewport: { x: 1, y: 0, scale: 1 } }), expect.any(Function));
  });

  it('seeds the initial context so one settled pan can return to it', () => {
    vi.useFakeTimers();
    const restore = vi.fn();
    const { result, rerender } = renderHook(({ x }) => useNavigationHistory({
      capture: () => ({ viewport: { x, y: 0, scale: 1 }, selection: null, scroll: {} }), restore,
    }), { initialProps: { x: 1 } });

    rerender({ x: 2 });
    act(() => { result.current.recordMovement(); vi.advanceTimersByTime(2_000); });

    expect(result.current.canGoBack).toBe(true);
    act(() => { result.current.traverse('back'); });
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ viewport: { x: 1, y: 0, scale: 1 } }), expect.any(Function));
  });

  it('captures the React-committed arrival around an explicit jump', () => {
    vi.useFakeTimers();
    const restore = vi.fn();
    const { result } = renderHook(() => {
      const [x, setX] = useState(1);
      const history = useNavigationHistory({
        capture: () => ({ viewport: { x, y: 0, scale: 1 }, selection: null, scroll: {} }), restore,
      });
      return { history, jump: () => setX(2) };
    });
    act(() => result.current.history.explicitNavigation(result.current.jump));
    act(() => vi.runOnlyPendingTimers());
    expect(result.current.history.canGoBack).toBe(true);
    act(() => { result.current.history.traverse('back'); });
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ viewport: { x: 1, y: 0, scale: 1 } }), expect.any(Function));
  });

  it('records settled movement after an explicit jump arrival completes', () => {
    vi.useFakeTimers();
    const restore = vi.fn();
    const { result } = renderHook(() => {
      const [x, setX] = useState(1);
      const history = useNavigationHistory({
        capture: () => ({ viewport: { x, y: 0, scale: 1 }, selection: null, scroll: {} }), restore,
      });
      return { history, moveTo: setX };
    });

    act(() => result.current.history.explicitNavigation(() => result.current.moveTo(2)));
    act(() => vi.runOnlyPendingTimers());
    act(() => result.current.moveTo(3));
    act(() => { result.current.history.recordMovement(); vi.advanceTimersByTime(2_000); });

    act(() => result.current.history.traverse('back'));
    expect(restore).toHaveBeenLastCalledWith(expect.objectContaining({ viewport: { x: 2, y: 0, scale: 1 } }), expect.any(Function));
  });

  it('discards an explicit arrival superseded by a newer jump', () => {
    vi.useFakeTimers();
    const restore = vi.fn();
    const { result } = renderHook(() => {
      const [x, setX] = useState(1);
      const history = useNavigationHistory({
        capture: () => ({ viewport: { x, y: 0, scale: 1 }, selection: null, scroll: {} }), restore,
      });
      return { history, moveTo: setX };
    });

    act(() => result.current.history.explicitNavigation(() => result.current.moveTo(2)));
    act(() => result.current.history.explicitNavigation(() => result.current.moveTo(3)));
    act(() => vi.runOnlyPendingTimers());

    act(() => result.current.history.traverse('back'));
    expect(restore).toHaveBeenLastCalledWith(expect.objectContaining({ viewport: { x: 2, y: 0, scale: 1 } }), expect.any(Function));
  });

  it('discards an explicit arrival superseded by traversal', () => {
    vi.useFakeTimers();
    const restore = vi.fn((_context, complete: () => void) => complete());
    const { result } = renderHook(() => {
      const [x, setX] = useState(1);
      const history = useNavigationHistory({
        capture: () => ({ viewport: { x, y: 0, scale: 1 }, selection: null, scroll: {} }), restore,
      });
      return { history, moveTo: setX };
    });

    act(() => result.current.history.explicitNavigation(() => result.current.moveTo(2)));
    act(() => vi.runOnlyPendingTimers());
    act(() => result.current.history.explicitNavigation(() => result.current.moveTo(3)));
    act(() => result.current.history.traverse('back'));
    act(() => vi.runOnlyPendingTimers());

    let firstForward = false;
    let secondForward = true;
    act(() => {
      firstForward = result.current.history.traverse('forward');
      secondForward = result.current.history.traverse('forward');
    });
    expect(firstForward).toBe(true);
    expect(secondForward).toBe(false);
  });

  it('refreshes a selection-only departure before traversing history', () => {
    vi.useFakeTimers();
    const restore = vi.fn();
    const selectionAt = (rowId: string) => ({
      mode: 'cells' as const,
      anchor: { sheetId: 'sheet', cell: { rowId, columnId: 'column' } },
      extent: { sheetId: 'sheet', cell: { rowId, columnId: 'column' } },
    });
    const a1 = selectionAt('row-a');
    const b1 = selectionAt('row-b');
    const b2 = selectionAt('row-c');
    const { result, rerender } = renderHook(({ x, selection }) => useNavigationHistory({
      capture: () => ({ viewport: { x, y: 0, scale: 1 }, selection, scroll: {} }), restore,
    }), { initialProps: { x: 1, selection: a1 } });

    rerender({ x: 2, selection: b1 });
    act(() => { result.current.recordMovement(); vi.advanceTimersByTime(2_000); });
    rerender({ x: 2, selection: b2 });

    act(() => { result.current.traverse('back'); });
    expect(restore).toHaveBeenLastCalledWith(expect.objectContaining({ selection: a1 }), expect.any(Function));
    act(() => { result.current.traverse('forward'); });
    expect(restore).toHaveBeenLastCalledWith(expect.objectContaining({
      viewport: { x: 2, y: 0, scale: 1 }, selection: b2,
    }), expect.any(Function));
  });

  it('does not record programmatic movement until the restore operation acknowledges completion', () => {
    vi.useFakeTimers();
    let x = 1;
    let completeRestore: (() => void) | undefined;
    const { result } = renderHook(() => useNavigationHistory({
      capture: () => ({ viewport: { x, y: 0, scale: 1 }, selection: null, scroll: {} }),
      restore: (_context, complete) => { completeRestore = complete; },
    }));

    x = 2;
    act(() => { result.current.recordMovement(); vi.advanceTimersByTime(2_000); result.current.traverse('back'); });
    x = 1;
    act(() => { result.current.recordMovement(); vi.advanceTimersByTime(2_000); });
    expect(result.current.canGoBack).toBe(false);

    act(() => completeRestore?.());
    x = 3;
    act(() => { result.current.recordUserMovement(); vi.advanceTimersByTime(2_000); });
    expect(result.current.canGoBack).toBe(true);

    x = 4;
    act(() => { result.current.recordMovement(); vi.advanceTimersByTime(2_000); result.current.traverse('back'); });
    expect(result.current.canGoForward).toBe(true);
  });
});
