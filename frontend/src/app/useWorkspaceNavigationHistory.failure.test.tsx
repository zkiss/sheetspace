import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceNavigationHistory } from './useWorkspaceNavigationHistory';

const destinationTarget = { kind: 'cell', target: { sheetId: 'destination', cell: {} } } as never;

describe('navigation failure and traversal ownership', () => {
  afterEach(() => vi.useRealTimers());
  it('does not report an unavailable failure when retirement starts a successor', () => {
    const unavailable = vi.fn();
    let fail: (reason: 'unavailable' | 'cancelled') => void = () => {};
    let successorReady = () => {};
    const { result } = renderHook(() => useWorkspaceNavigationHistory({ stageDestination: true,
      onRestoreSelection: () => true, onUnavailableTarget: unavailable, restoreViewport: () => () => {},
      selection: null, viewport: { x: 0, y: 0, scale: 1 },
    }));
    act(() => result.current.history.explicitNavigation((operation) => {
      result.current.startExplicitNavigation(operation, destinationTarget, (_ready, failed) => {
        fail = failed; return () => {};
      }, undefined, () => result.current.startExplicitSheetNavigation('successor', () => {}, (ready) => {
        successorReady = ready; return () => {};
      }));
    }));
    act(() => fail('unavailable'));
    expect(unavailable).not.toHaveBeenCalled();
    act(() => successorReady());
    expect(result.current.history.canGoBack).toBe(true);
  });

  it('does not report a saved restore failure after selection feedback starts a successor', () => {
    vi.useFakeTimers();
    const unavailable = vi.fn();
    let fail: (reason: 'unavailable' | 'cancelled') => void = () => {};
    let successorReady = () => {};
    const restoreSelection = vi.fn(() => {
      result.current.startExplicitSheetNavigation('successor', () => {}, (ready) => {
        successorReady = ready; return () => {};
      });
      return true;
    });
    const { result, rerender } = renderHook(({ x }) => useWorkspaceNavigationHistory({ stageDestination: true,
      onRestoreSelection: restoreSelection, onUnavailableTarget: unavailable, restoreViewport: () => () => {},
      restoreDestination: (_sheet, _viewport, _ready, failed) => { fail = failed; return () => {}; },
      selection: null, viewport: { x, y: 0, scale: 1 },
    }), { initialProps: { x: 0 } });
    act(() => result.current.startExplicitSheetNavigation('saved', () => {}, (ready) => { ready(); return () => {}; }));
    rerender({ x: 1 });
    act(() => { result.current.history.recordUserMovement(); vi.advanceTimersByTime(2_000); });
    act(() => result.current.history.traverse('back'));
    act(() => fail('unavailable'));
    expect(restoreSelection).toHaveBeenCalledWith(null);
    expect(unavailable).not.toHaveBeenCalled();
    act(() => successorReady());
    expect(result.current.history.canGoBack).toBe(true);
  });
  it.each(['cancelled', 'unavailable'] as const)('retires a failed explicit destination without capturing arrival: %s', (reason) => {
    const unavailable = vi.fn();
    let fail: (reason: 'cancelled' | 'unavailable') => void = () => {};
    let ready = () => {};
    const arrived = vi.fn();
    const { result, rerender } = renderHook(({ x }) => useWorkspaceNavigationHistory({ stageDestination: true,
      onRestoreSelection: () => true, onUnavailableTarget: unavailable, restoreViewport: () => () => {},
      selection: null, viewport: { x, y: 0, scale: 1 },
    }), { initialProps: { x: 0 } });
    act(() => result.current.history.explicitNavigation((operation) => {
      result.current.startExplicitNavigation(operation, destinationTarget, (settled, failed) => {
        ready = settled; fail = failed; return () => {};
      }, arrived);
    }));
    rerender({ x: 5 });
    act(() => fail(reason));
    act(() => { ready(); fail(reason); });
    expect(arrived).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledTimes(reason === 'unavailable' ? 1 : 0);
    expect(result.current.navigationRequestForSheet('destination')).toBeUndefined();
    expect(result.current.history.canGoBack).toBe(false);
    act(() => result.current.history.explicitNavigation((operation) => {
      result.current.startExplicitNavigation(operation, destinationTarget, (settled) => { settled(); return () => {}; });
    }));
    expect(result.current.navigationRequestForSheet('destination')).toBeDefined();
  });

  it('retires a failed empty sheet navigation without capturing its intermediate viewport', () => {
    const unavailable = vi.fn();
    let fail: (reason: 'unavailable' | 'cancelled') => void = () => {};
    const clearSelection = vi.fn();
    const { result, rerender } = renderHook(({ x }) => useWorkspaceNavigationHistory({ stageDestination: true,
      onRestoreSelection: () => true, onUnavailableTarget: unavailable, restoreViewport: () => () => {},
      selection: null, viewport: { x, y: 0, scale: 1 },
    }), { initialProps: { x: 0 } });
    act(() => result.current.startExplicitSheetNavigation('empty', clearSelection, (_ready, failed) => { fail = failed; return () => {}; }));
    rerender({ x: 5 });
    act(() => fail('unavailable'));
    expect(clearSelection).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledOnce();
    expect(result.current.history.canGoBack).toBe(false);
  });

  it('keeps a pending explicit navigation when forward cannot traverse', () => {
    let ready = () => {};
    const cancel = vi.fn();
    const arrived = vi.fn();
    const { result } = renderHook(() => useWorkspaceNavigationHistory({ stageDestination: true,
      onRestoreSelection: () => true, onUnavailableTarget: vi.fn(), restoreViewport: () => () => {},
      selection: null, viewport: { x: 0, y: 0, scale: 1 },
    }));
    act(() => result.current.history.explicitNavigation((operation) => {
      result.current.startExplicitNavigation(operation, destinationTarget, (settled) => { ready = settled; return cancel; }, arrived);
    }));
    act(() => expect(result.current.history.traverse('forward')).toBe(false));
    expect(cancel).not.toHaveBeenCalled();
    act(() => ready());
    expect(arrived).toHaveBeenCalledOnce();
    expect(result.current.navigationRequestForSheet('destination')).toBeDefined();
  });

  it('keeps a pending history restore when back is already at the boundary', () => {
    vi.useFakeTimers();
    let ready = () => {};
    const cancel = vi.fn();
    const restore = vi.fn((_viewport, settled) => { ready = settled; return cancel; });
    const { result, rerender } = renderHook(({ x }) => useWorkspaceNavigationHistory({ stageDestination: true,
      onRestoreSelection: () => true, onUnavailableTarget: vi.fn(), restoreViewport: restore,
      selection: null, viewport: { x, y: 0, scale: 1 },
    }), { initialProps: { x: 0 } });
    rerender({ x: 1 });
    act(() => { result.current.history.recordUserMovement(); vi.advanceTimersByTime(2_000); });
    act(() => result.current.history.traverse('back'));
    act(() => expect(result.current.history.traverse('back')).toBe(false));
    expect(cancel).not.toHaveBeenCalled();
    act(() => ready());
    expect(result.current.history.canGoForward).toBe(true);
  });

});
