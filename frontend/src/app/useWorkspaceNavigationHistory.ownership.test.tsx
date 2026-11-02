import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkspaceNavigationHistory } from './useWorkspaceNavigationHistory';
import type { CellSelection } from '@grid/cellInteractionContracts';

const selection = { anchor: { sheetId: 'departure' } } as CellSelection;
const target = (sheetId: string) => ({ kind: 'cell', target: { sheetId, cell: {} } }) as never;

describe('navigation ownership and committed arrival', () => {
  it('restores an empty destination through staged presentation before completing forward traversal', () => {
    let ready = () => {};
    const restoreDestination = vi.fn((_sheet: string, _viewport: { x: number; y: number; scale: number }, settled: () => void) => { ready = settled; return () => {}; });
    const { result } = renderHook(() => {
      const [selected, setSelected] = useState<CellSelection | null>(selection);
      const [x, setX] = useState(0);
      const history = useWorkspaceNavigationHistory({ stageDestination: true, selection: selected, viewport: { x, y: 0, scale: 1 },
        onRestoreSelection: (value) => { setSelected(value); return true; }, onUnavailableTarget: vi.fn(),
        restoreViewport: () => { throw new Error('destination required'); }, restoreDestination,
      });
      return { history, selected, setSelected, setX };
    });
    act(() => result.current.history.startExplicitSheetNavigation('empty', () => result.current.setSelected(null), (settled) => {
      result.current.setX(42); settled(); return () => {};
    }));
    act(() => result.current.history.history.traverse('back'));
    expect(restoreDestination).toHaveBeenLastCalledWith('departure', expect.objectContaining({ x: 0 }), expect.any(Function), expect.any(Function));
    act(() => ready());
    const generation = result.current.history.navigationRestoreForSheet('departure')!;
    act(() => result.current.history.acknowledgeGridRestore('departure', generation));
    expect(result.current.selected).toEqual(selection);
    act(() => result.current.history.history.traverse('forward'));
    expect(restoreDestination).toHaveBeenLastCalledWith('empty', expect.objectContaining({ x: 42 }), expect.any(Function), expect.any(Function));
    expect(result.current.selected).toEqual(selection);
    act(() => ready());
    expect(result.current.selected).toBeNull();
    act(() => result.current.history.history.traverse('back'));
    expect(restoreDestination).toHaveBeenLastCalledWith('departure', expect.anything(), expect.any(Function), expect.any(Function));
  });
  it('captures a synchronous empty arrival only after selection and viewport commit', () => {
    const { result } = renderHook(() => {
      const [selected, setSelected] = useState<CellSelection | null>(selection);
      const [x, setX] = useState(0);
      const history = useWorkspaceNavigationHistory({ selection: selected, viewport: { x, y: 0, scale: 1 },
        onRestoreSelection: (value) => { setSelected(value); return true; }, onUnavailableTarget: vi.fn(),
        restoreViewport: (viewport, ready) => { setX(viewport.x); ready(); return () => {}; },
      });
      return { history, selected, x, setSelected, setX };
    });
    act(() => result.current.history.startExplicitSheetNavigation('empty', () => result.current.setSelected(null), (ready) => {
      result.current.setX(42); ready(); return () => {};
    }));
    act(() => result.current.history.history.traverse('back'));
    expect(result.current.selected).toEqual(selection);
    expect(result.current.x).toBe(0);
    const generation = result.current.history.navigationRestoreForSheet('departure')!;
    act(() => result.current.history.acknowledgeGridRestore('departure', generation));
    act(() => result.current.history.history.traverse('forward'));
    expect(result.current.selected).toBeNull();
    expect(result.current.x).toBe(42);
  });

  it.each([false, true])('a successor started by predecessor disposal owns admission (staged: %s)', (stageDestination) => {
    const started = vi.fn();
    const { result } = renderHook(() => useWorkspaceNavigationHistory({ stageDestination, selection: null,
      viewport: { x: 0, y: 0, scale: 1 }, onRestoreSelection: () => true,
      onUnavailableTarget: vi.fn(), restoreViewport: () => () => {},
    }));
    const start = (sheet: string, disposer = () => {}) => result.current.history.explicitNavigation((operation) => {
      result.current.startExplicitNavigation(operation, target(sheet), () => { started(sheet); return disposer; });
    });
    act(() => start('a', () => start('c')));
    act(() => start('b'));
    expect(started.mock.calls.map(([sheet]) => sheet)).toEqual(['a', 'c']);
    expect(result.current.pendingNavigationSheetId).toBe('c');
  });

  it('does not start the old viewport after onReady starts a successor', () => {
    const started = vi.fn();
    const { result } = renderHook(() => useWorkspaceNavigationHistory({ selection: null,
      viewport: { x: 0, y: 0, scale: 1 }, onRestoreSelection: () => true,
      onUnavailableTarget: vi.fn(), restoreViewport: () => () => {},
    }));
    act(() => result.current.history.explicitNavigation((operation) => {
      result.current.startExplicitNavigation(operation, target('b'), () => { started('b'); return () => {}; }, () => {
        result.current.history.explicitNavigation((next) => {
          result.current.startExplicitNavigation(next, target('c'), () => { started('c'); return () => {}; });
        });
      });
    }));
    expect(started.mock.calls.map(([sheet]) => sheet)).toEqual(['c']);
    expect(result.current.pendingNavigationSheetId).toBe('c');
  });

  it('preserves a successor started by outer cancellation', () => {
    const { result } = renderHook(() => useWorkspaceNavigationHistory({ stageDestination: true, selection: null,
      viewport: { x: 0, y: 0, scale: 1 }, onRestoreSelection: () => true,
      onUnavailableTarget: vi.fn(), restoreViewport: () => () => {},
    }));
    let ready = () => {};
    act(() => result.current.history.explicitNavigation((operation) => {
      result.current.startExplicitNavigation(operation, target('a'), () => () => {
        result.current.history.explicitNavigation((next) => {
          result.current.startExplicitNavigation(next, target('c'), (settled) => { ready = settled; return () => {}; });
        });
      });
    }));
    act(() => result.current.cancelNavigationRestore());
    act(() => ready());
    expect(result.current.navigationRestoreForSheet('c')).toBeDefined();
    act(() => result.current.history.traverse('back'));
    expect(result.current.pendingNavigationSheetId).toBeUndefined();
  });

  it('discards a settled arrival replaced before its state commits', () => {
    const { result } = renderHook(() => {
      const [x, setX] = useState(0);
      const history = useWorkspaceNavigationHistory({ stageDestination: true, selection: null,
        viewport: { x, y: 0, scale: 1 }, onRestoreSelection: () => true,
        onUnavailableTarget: vi.fn(), restoreViewport: (viewport, ready) => { setX(viewport.x); ready(); return () => {}; },
      });
      return { history, x, setX };
    });
    act(() => {
      result.current.history.startExplicitSheetNavigation('empty', () => {}, (ready) => { result.current.setX(1); ready(); return () => {}; });
      result.current.history.startExplicitSheetNavigation('empty', () => {}, (ready) => { result.current.setX(2); ready(); return () => {}; });
    });
    act(() => result.current.history.history.traverse('back'));
    expect(result.current.x).toBe(0);
    act(() => result.current.history.history.traverse('forward'));
    expect(result.current.x).toBe(2);
  });
});
