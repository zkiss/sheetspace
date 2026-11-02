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

function applyGridRestore(history: ReturnType<typeof useWorkspaceNavigationHistory>, sheetId: string, element: HTMLElement) {
  const restore = history.historyRestoreForSheet(sheetId);
  if (!restore) return;
  element.scrollLeft = Math.min(restore.left, element.scrollWidth - element.clientWidth);
  element.scrollTop = Math.min(restore.top, element.scrollHeight - element.clientHeight);
  history.acknowledgeGridRestore(sheetId, restore.generation);
}

const destinationTarget = { kind: 'cell', target: { sheetId: 'destination', cell: {} } } as never;

describe('useWorkspaceNavigationHistory', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('restores selection only at destination readiness and ignores cancelled settlement', () => {
    vi.useFakeTimers();
    const selection = { anchor: { sheetId: 'destination' }, extent: { sheetId: 'destination' }, mode: 'cell' } as never;
    const onRestoreSelection = vi.fn(() => true);
    let settle = () => {};
    const { result, rerender } = renderHook(({ x }) => useWorkspaceNavigationHistory({ stageDestination: true,
      onRestoreSelection, onUnavailableTarget: vi.fn(),
      restoreViewport: (_viewport, ready) => { settle = ready; return () => {}; },
      selection, viewport: { x, y: 0, scale: 1 },
    }), { initialProps: { x: 1 } });
    rerender({ x: 2 });
    act(() => { result.current.history.recordUserMovement(); vi.advanceTimersByTime(2_000); result.current.history.traverse('back'); });
    expect(onRestoreSelection).not.toHaveBeenCalled();
    const stale = settle;
    act(() => result.current.cancelNavigationRestore());
    act(() => stale());
    expect(onRestoreSelection).not.toHaveBeenCalled();
    act(() => result.current.history.traverse('forward'));
    act(() => settle());
    expect(onRestoreSelection).toHaveBeenCalledWith(selection);
  });

  it('passes the selected sheet to a destination-aware history restore', () => {
    vi.useFakeTimers();
    const selection = { anchor: { sheetId: 'destination' }, extent: { sheetId: 'destination' }, mode: 'cell' } as never;
    const restoreDestination = vi.fn(() => () => {});
    const restoreViewport = vi.fn(() => () => {});
    const { result, rerender } = renderHook(({ x }) => useWorkspaceNavigationHistory({ stageDestination: true,
      onRestoreSelection: () => true, onUnavailableTarget: vi.fn(), restoreViewport, restoreDestination,
      selection, viewport: { x, y: 0, scale: 1 },
    }), { initialProps: { x: 1 } });
    rerender({ x: 2 });
    act(() => { result.current.history.recordUserMovement(); vi.advanceTimersByTime(2_000); });
    act(() => result.current.history.traverse('back'));
    expect(restoreDestination).toHaveBeenCalledWith('destination', { x: 1, y: 0, scale: 1 }, expect.any(Function), expect.any(Function));
    expect(restoreViewport).not.toHaveBeenCalled();
  });

  it.each(['initially missing', 'removed during restore'])('recovers from a destination %s without exposing its grid', (scenario) => {
    vi.useFakeTimers();
    const selection = { anchor: { sheetId: 'destination' }, extent: { sheetId: 'destination' }, mode: 'cell' } as never;
    const unavailable = vi.fn();
    const restoreSelection = vi.fn(() => true);
    let fail: (reason: 'unavailable' | 'cancelled') => void = () => {};
    let ready = () => {};
    const { result, rerender } = renderHook(({ x }) => useWorkspaceNavigationHistory({ stageDestination: true,
      onRestoreSelection: restoreSelection, onUnavailableTarget: unavailable,
      restoreViewport: () => () => {},
      restoreDestination: (_sheet, _viewport, settled, failed) => {
        ready = settled; fail = failed;
        if (scenario === 'initially missing') failed('unavailable');
        return () => {};
      }, selection, viewport: { x, y: 0, scale: 1 },
    }), { initialProps: { x: 1 } });
    act(() => result.current.registerScrollContainer('destination', scrollContainer(20, 30)));
    rerender({ x: 2 });
    act(() => { result.current.history.recordUserMovement(); vi.advanceTimersByTime(2_000); });
    act(() => result.current.history.traverse('back'));
    if (scenario !== 'initially missing') act(() => fail('unavailable'));
    expect(unavailable).toHaveBeenCalledOnce();
    expect(restoreSelection).toHaveBeenCalledWith(null);
    expect(result.current.historyRestoreForSheet('destination')).toBeUndefined();
    expect(result.current.navigationRestoreForSheet('destination')).toBeUndefined();
    act(() => { ready(); fail('unavailable'); });
    expect(unavailable).toHaveBeenCalledOnce();
    act(() => result.current.history.explicitNavigation((operation) => {
      result.current.startExplicitNavigation(operation, destinationTarget, (settled) => { settled(); return () => {}; });
    }));
    expect(result.current.navigationRestoreForSheet('destination')).toBeDefined();
  });

  it('releases a cancelled staged restore without reporting an unavailable sheet', () => {
    vi.useFakeTimers();
    const selection = { anchor: { sheetId: 'destination' }, extent: { sheetId: 'destination' }, mode: 'cell' } as never;
    const unavailable = vi.fn();
    const restoreSelection = vi.fn(() => true);
    let fail: (reason: 'unavailable' | 'cancelled') => void = () => {};
    const { result, rerender } = renderHook(({ x }) => useWorkspaceNavigationHistory({ stageDestination: true,
      onRestoreSelection: restoreSelection, onUnavailableTarget: unavailable,
      restoreViewport: () => () => {},
      restoreDestination: (_sheet, _viewport, _settled, failed) => { fail = failed; return () => {}; },
      selection, viewport: { x, y: 0, scale: 1 },
    }), { initialProps: { x: 1 } });
    rerender({ x: 2 });
    act(() => { result.current.history.recordUserMovement(); vi.advanceTimersByTime(2_000); result.current.history.traverse('back'); });
    act(() => fail('cancelled'));
    expect(unavailable).not.toHaveBeenCalled();
    expect(restoreSelection).not.toHaveBeenCalled();
    expect(result.current.navigationRestoreForSheet('destination')).toBeUndefined();
    act(() => result.current.history.traverse('forward'));
    expect(result.current.pendingNavigationSheetId).toBe('destination');
  });

  it('does not publish saved scroll for an unavailable selected destination', () => {
    vi.useFakeTimers();
    const selection = { anchor: { sheetId: 'destination' }, extent: { sheetId: 'destination' }, mode: 'cell' } as never;
    const unavailable = vi.fn();
    const { result, rerender } = renderHook(({ x }) => useWorkspaceNavigationHistory({ stageDestination: true,
      onRestoreSelection: () => false, onUnavailableTarget: unavailable,
      restoreViewport: (_viewport, ready) => { ready(); return () => {}; },
      selection, viewport: { x, y: 0, scale: 1 },
    }), { initialProps: { x: 1 } });
    act(() => result.current.registerScrollContainer('destination', scrollContainer(240, 360)));
    act(() => { result.current.history.recordUserMovement(); vi.advanceTimersByTime(2_000); });
    rerender({ x: 2 });
    act(() => { result.current.history.recordUserMovement(); vi.advanceTimersByTime(2_000); result.current.history.traverse('back'); });
    expect(unavailable).toHaveBeenCalledOnce();
    expect(result.current.historyRestoreForSheet('destination')).toBeUndefined();
    expect(result.current.navigationRestoreForSheet('destination')).toBeUndefined();
  });

  it('keeps dialog focus when the destination grid settles', () => {
    const { result } = renderHook(() => useWorkspaceNavigationHistory({ stageDestination: true,
      onRestoreSelection: () => true, onUnavailableTarget: vi.fn(), restoreViewport: () => () => {},
      selection: null, viewport: { x: 0, y: 0, scale: 1 },
    }));
    const grid = scrollContainer(0, 0);
    const cell = document.createElement('button');
    cell.dataset.activeCell = 'true';
    grid.append(cell);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const button = document.createElement('button');
    dialog.append(button);
    document.body.append(grid, dialog);
    button.focus();
    act(() => result.current.registerScrollContainer('destination', grid));
    act(() => result.current.history.explicitNavigation((operation) => {
      result.current.startExplicitNavigation(operation, destinationTarget, (ready) => { ready(); return () => {}; });
    }));
    act(() => result.current.acknowledgeGridRestore('destination', 1));
    expect(document.activeElement).toBe(button);
    grid.remove();
    dialog.remove();
  });

  it('rejects replaced presentation and grid acknowledgements', () => {
    const arrivals: Array<() => void> = [];
    const ready = vi.fn();
    const { result } = renderHook(() => useWorkspaceNavigationHistory({ stageDestination: true,
      onRestoreSelection: () => true, onUnavailableTarget: vi.fn(), restoreViewport: () => () => {},
      selection: null, viewport: { x: 0, y: 0, scale: 1 },
    }));
    const navigate = () => result.current.history.explicitNavigation((operation) => {
      result.current.startExplicitNavigation(operation, destinationTarget, (settled) => {
        arrivals.push(settled);
        return () => {};
      }, ready);
    });
    act(navigate);
    act(navigate);
    act(() => arrivals[0]());
    expect(ready).not.toHaveBeenCalled();
    expect(result.current.navigationRequestForSheet('destination')).toBeUndefined();
    act(() => arrivals[1]());
    const request = result.current.navigationRequestForSheet('destination');
    expect(request).toBeDefined();
    act(() => result.current.acknowledgeGridRestore('destination', request!.generation - 1));
    expect(result.current.navigationRequestForSheet('destination')).toEqual(request);
    act(() => result.current.acknowledgeGridRestore('destination', request!.generation));
    expect(result.current.navigationRequestForSheet('destination')).toBeUndefined();
    expect(ready).toHaveBeenCalledOnce();
  });

  it('does not record an empty-scroll restoration until a later user movement', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ x }) => useWorkspaceNavigationHistory({ stageDestination: true,
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
    expect(result.current.history.canGoForward).toBe(false);
  });

  it('applies a restored offscreen grid scroll offset when its container mounts', () => {
    vi.useFakeTimers();
    const restoreViewport = vi.fn((_viewport, complete) => { complete(); return () => {}; });
    const { result, rerender } = renderHook(({ x }) => useWorkspaceNavigationHistory({ stageDestination: true,
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
    act(() => applyGridRestore(result.current, 'destination', remounted));

    expect(remounted.scrollLeft).toBe(240);
    expect(remounted.scrollTop).toBe(360);
  });

  it('reapplies saved offscreen scroll after selection restoration reveals its range', () => {
    vi.useFakeTimers();
    const selection = { anchor: { sheetId: 'destination', rowIndex: 3, columnIndex: 2 }, extent: { sheetId: 'destination', rowIndex: 3, columnIndex: 2 }, mode: 'cell' } as never;
    const { result, rerender } = renderHook(({ x }) => useWorkspaceNavigationHistory({ stageDestination: true,
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

    // This models the grid owner's active-selection reveal before its final
    // generation-scoped saved-scroll acknowledgement.
    remounted.scrollLeft = 700;
    remounted.scrollTop = 800;
    act(() => applyGridRestore(result.current, 'destination', remounted));

    expect(remounted.scrollLeft).toBe(240);
    expect(remounted.scrollTop).toBe(360);
  });

  it('records only an explicit user grid movement, never a programmatic scroll write', () => {
    vi.useFakeTimers();
    const restoreViewport = vi.fn((_viewport, complete) => { complete(); return () => {}; });
    const { result, rerender } = renderHook(({ x }) => useWorkspaceNavigationHistory({ stageDestination: true,
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
    act(() => applyGridRestore(result.current, 'destination', grid));

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
    expect(result.current.history.canGoForward).toBe(false);
  });

  it('waits for both viewport motion and the selected grid scroll before completing restoration', () => {
    vi.useFakeTimers();
    let settleViewport: (() => void) | undefined;
    const restoreViewport = vi.fn((_viewport, complete) => {
      settleViewport = complete;
      return () => { settleViewport = undefined; };
    });
    const selection = { anchor: { sheetId: 'destination', rowIndex: 3, columnIndex: 2 }, extent: { sheetId: 'destination', rowIndex: 3, columnIndex: 2 }, mode: 'cell' } as never;
    const { result, rerender } = renderHook(({ x }) => useWorkspaceNavigationHistory({ stageDestination: true,
      onRestoreSelection: () => true, onUnavailableTarget: vi.fn(), restoreViewport, selection, viewport: { x, y: 0, scale: 1 },
    }), { initialProps: { x: 1 } });
    const grid = scrollContainer(240, 360);
    act(() => result.current.registerScrollContainer('destination', grid));
    act(() => { result.current.history.recordUserMovement(); vi.advanceTimersByTime(2_000); });
    grid.scrollLeft = 700;
    rerender({ x: 2 });
    act(() => { result.current.history.recordUserMovement(); vi.advanceTimersByTime(2_000); result.current.history.traverse('back'); });


    act(() => applyGridRestore(result.current, 'destination', grid));
    expect(grid.scrollLeft).toBe(700);
    act(() => settleViewport?.());
    act(() => applyGridRestore(result.current, 'destination', grid));
    expect(grid.scrollLeft).toBe(240);
    expect(result.current.history.canGoForward).toBe(true);
  });

  it('focuses the destination only after both grid acknowledgement and presentation settlement', () => {
    let settleViewport = () => {};
    const { result } = renderHook(() => useWorkspaceNavigationHistory({ stageDestination: true,
      onRestoreSelection: () => true,
      onUnavailableTarget: vi.fn(),
      restoreViewport: () => () => {},
      selection: null,
      viewport: { x: 0, y: 0, scale: 1 },
    }));
    const grid = scrollContainer(0, 0);
    const cell = document.createElement('button');
    cell.dataset.activeCell = 'true';
    grid.append(cell);
    document.body.append(grid);
    const focus = vi.spyOn(cell, 'focus');
    act(() => result.current.registerScrollContainer('destination', grid));
    act(() => result.current.history.explicitNavigation((operation) => {
      result.current.startExplicitNavigation(operation, destinationTarget, (settled) => {
        settleViewport = settled;
        return () => {};
      });
    }));

    act(() => result.current.acknowledgeGridRestore('destination', 1));
    expect(focus).not.toHaveBeenCalled();
    act(() => settleViewport());
    expect(focus).not.toHaveBeenCalled();
    act(() => result.current.acknowledgeGridRestore('destination', 1));
    expect(focus).toHaveBeenCalledOnce();
    grid.remove();
  });

  it.each(['none', 'dialog', 'editor'])('defers canvas focus until settlement and respects %s ownership', (owner) => {
    let settleViewport = () => {};
    const { result } = renderHook(() => useWorkspaceNavigationHistory({
      onRestoreSelection: () => true, onUnavailableTarget: vi.fn(), restoreViewport: () => () => {},
      selection: null, viewport: { x: 0, y: 0, scale: 1 },
    }));
    const grid = scrollContainer(0, 0);
    const cell = document.createElement('button');
    cell.dataset.activeCell = 'true';
    grid.append(cell);
    document.body.append(grid);
    const focus = vi.spyOn(cell, 'focus');
    const container = document.createElement('div');
    if (owner === 'dialog') container.setAttribute('role', 'dialog');
    if (owner === 'editor') container.setAttribute('data-workspace-sheet-editor', '');
    const button = document.createElement('button');
    container.append(button);
    document.body.append(container);
    button.focus();
    act(() => result.current.registerScrollContainer('destination', grid));
    act(() => result.current.history.explicitNavigation((operation) => {
      result.current.startExplicitNavigation(operation, destinationTarget, (settled) => { settleViewport = settled; return () => {}; });
    }));
    act(() => result.current.acknowledgeGridRestore('destination', 1));
    expect(focus).not.toHaveBeenCalled();
    act(() => settleViewport());
    expect(focus).toHaveBeenCalledTimes(owner === 'none' ? 1 : 0);
    grid.remove();
    container.remove();
  });

  it('records a reference jump immediately while retaining its reveal request until acknowledgement', () => {
    let settleViewport: (() => void) | undefined;
    const restoreViewport = vi.fn((_viewport, complete) => {
      settleViewport = complete;
      return () => { settleViewport = undefined; };
    });
    const { result, rerender } = renderHook(({ x }) => useWorkspaceNavigationHistory({ stageDestination: true,
      onRestoreSelection: () => true,
      onUnavailableTarget: vi.fn(),
      restoreViewport,
      selection: null,
      viewport: { x, y: 0, scale: 1 },
    }), { initialProps: { x: 1 } });

    act(() => result.current.history.explicitNavigation((operation) => {
      result.current.startExplicitNavigation(operation, destinationTarget, (settled) => restoreViewport({ x: 2, y: 0, scale: 1 }, settled));
    }));
    rerender({ x: 2 });

    act(() => settleViewport?.());
    expect(result.current.history.canGoBack).toBe(true);
    expect(result.current.navigationRestoreForSheet('destination')).toBe(1);

    act(() => result.current.acknowledgeGridRestore('destination', 1));
    expect(result.current.history.canGoBack).toBe(true);
    expect(result.current.navigationRestoreForSheet('destination')).toBeUndefined();
  });

  it('removes a cancelled reference reveal generation before a delayed grid can mount', () => {
    const { result } = renderHook(() => useWorkspaceNavigationHistory({ stageDestination: true,
      onRestoreSelection: () => true,
      onUnavailableTarget: vi.fn(),
      restoreViewport: () => () => {},
      selection: null,
      viewport: { x: 1, y: 0, scale: 1 },
    }));

    act(() => result.current.history.explicitNavigation((operation) => {
      result.current.startExplicitNavigation(operation, destinationTarget, (settled) => { settled(); return () => {}; });
    }));
    expect(result.current.navigationRestoreForSheet('destination')).toBe(1);

    act(() => result.current.recordUserGridMovement());
    expect(result.current.navigationRestoreForSheet('destination')).toBeUndefined();
  });

  it('keeps the explicit grid request after its presentation lifetime and removes it on input', () => {
    const { result } = renderHook(() => useWorkspaceNavigationHistory({ stageDestination: true,
      onRestoreSelection: () => true,
      onUnavailableTarget: vi.fn(),
      restoreViewport: () => () => {},
      selection: null,
      viewport: { x: 1, y: 0, scale: 1 },
    }));

    act(() => result.current.history.explicitNavigation((operation) => {
      result.current.startExplicitNavigation(operation, destinationTarget, (settled) => { settled(); return () => {}; });
    }));
    expect(result.current.navigationRequestForSheet('destination')).toMatchObject({ generation: 1, target: destinationTarget });

    act(() => result.current.recordUserGridMovement());
    expect(result.current.navigationRequestForSheet('destination')).toBeUndefined();
  });

  it('cancels delayed grid restoration before an intervening user gesture can be overwritten', () => {
    vi.useFakeTimers();
    let settleViewport: (() => void) | undefined;
    const selection = { anchor: { sheetId: 'destination', rowIndex: 3, columnIndex: 2 }, extent: { sheetId: 'destination', rowIndex: 3, columnIndex: 2 }, mode: 'cell' } as never;
    const { result, rerender } = renderHook(({ x }) => useWorkspaceNavigationHistory({ stageDestination: true,
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
    act(() => settleViewport?.());

    expect(grid.scrollLeft).toBe(500);
  });
});
