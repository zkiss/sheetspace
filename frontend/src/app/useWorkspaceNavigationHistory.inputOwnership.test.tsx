import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useWorkspaceNavigationHistory } from './useWorkspaceNavigationHistory';

it('revokes publication and focus in the transport-to-grid acknowledgement gap without poisoning a successor', () => {
  let settle = () => {};
  const publish = vi.fn();
  const retire = vi.fn();
  const target = { kind: 'cell' as const, target: { sheetId: 'destination', cell: { rowId: 'row', columnId: 'column' } } };
  const { result } = renderHook(() => useWorkspaceNavigationHistory({ stageDestination: true,
    onRestoreSelection: () => true, onUnavailableTarget: vi.fn(), restoreViewport: () => () => {},
    selection: null, viewport: { x: 0, y: 0, scale: 1 },
  }));
  const grid = document.createElement('div');
  const cell = document.createElement('button');
  cell.dataset.activeCell = 'true';
  grid.append(cell);
  const focus = vi.spyOn(cell, 'focus');
  act(() => result.current.registerScrollContainer('destination', grid));
  const start = () => result.current.history.explicitNavigation((operation) => {
    result.current.startExplicitNavigation(operation, target,
      (ready) => { settle = ready; return () => {}; }, publish, retire);
  });
  act(start);
  act(() => settle());
  const staleGeneration = result.current.navigationRequestForSheet('destination')!.generation;
  expect(publish).toHaveBeenCalledOnce();

  act(() => result.current.cancelNavigationRestore());
  act(() => { settle(); result.current.acknowledgeGridRestore('destination', staleGeneration); });
  expect(retire).toHaveBeenCalledOnce();
  expect(publish).toHaveBeenCalledOnce();
  expect(focus).not.toHaveBeenCalled();
  expect(result.current.ownsGridRestore('destination', staleGeneration)).toBe(false);
  expect(result.current.navigationRequestForSheet('destination')).toBeUndefined();

  act(start);
  act(() => settle());
  const successorGeneration = result.current.navigationRequestForSheet('destination')!.generation;
  act(() => result.current.acknowledgeGridRestore('destination', staleGeneration));
  expect(focus).not.toHaveBeenCalled();
  act(() => result.current.acknowledgeGridRestore('destination', successorGeneration));
  expect(focus).toHaveBeenCalledOnce();
  expect(publish).toHaveBeenCalledTimes(2);
});
