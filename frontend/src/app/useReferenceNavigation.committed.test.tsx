import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CellSelection } from '@grid/cellInteractionContracts';
import { useReferenceNavigation } from '@reference-navigation/useReferenceNavigation';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkspaceNavigationHistory } from './useWorkspaceNavigationHistory';

afterEach(() => vi.useRealTimers());

it('captures committed reference selection, viewport and scroll despite late transport outcomes', () => {
  vi.useFakeTimers();
  const sheet = sheetDocument({ id: 'sheet', name: 'Sheet' });
  const cell = { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! };
  const departure = { anchor: { sheetId: 'departure' } } as CellSelection;
  const arrival = { anchor: { sheetId: sheet.id, cell } } as CellSelection;
  const containers = ['departure', sheet.id].map(() => {
    const element = document.createElement('div');
    const active = document.createElement('button');
    active.dataset.activeCell = 'true';
    element.append(active);
    document.body.append(element);
    return element;
  });
  const focus = vi.spyOn(containers[1]!.firstElementChild as HTMLElement, 'focus');
  containers[0]!.scrollLeft = 12;
  containers[1]!.scrollTop = 34;
  let ready = () => {};
  let fail: (reason: 'unavailable' | 'cancelled') => void = () => {};
  let restoreReady = () => {};
  const unavailable = vi.fn();
  const publish = vi.fn();
  const { result, unmount } = renderHook(() => {
    const [selection, setSelection] = useState<CellSelection | null>(departure);
    const [x, setX] = useState(0);
    const history = useWorkspaceNavigationHistory({ stageDestination: true, selection, viewport: { x, y: 0, scale: 1 },
      onRestoreSelection: (value) => { setSelection(value); return true; }, onUnavailableTarget: unavailable,
      restoreViewport: (viewport, settled) => { setX(viewport.x); restoreReady = settled; return () => {}; },
    });
    const reference = useReferenceNavigation({ workbook: workbookWithSheets([sheet]),
      onSelectReferenceTarget: () => { publish(); setSelection(arrival); },
      onExplicitNavigation: history.history.explicitNavigation, startNavigation: history.startExplicitNavigation,
      navigateToTarget: (_target, options) => { ready = options!.onSettled!; fail = options!.onFailure!; return () => {}; },
    });
    return { history, reference, selection, x, setX };
  });
  act(() => { result.current.history.registerScrollContainer('departure', containers[0]!); result.current.history.registerScrollContainer(sheet.id, containers[1]!); });
  act(() => result.current.reference.navigateTarget({ kind: 'cell', target: { sheetId: sheet.id, cell } }, sheet));
  act(() => { result.current.setX(42); ready(); ready(); fail('unavailable'); });
  const generation = result.current.history.navigationRestoreForSheet(sheet.id)!;
  act(() => result.current.history.acknowledgeGridRestore(sheet.id, generation));
  expect(result.current.selection).toEqual(arrival);
  expect(focus).toHaveBeenCalledOnce();
  act(() => { vi.advanceTimersByTime(1199); ready(); fail('cancelled'); });
  expect(result.current.reference.navigationHighlight).not.toBeNull();
  act(() => { vi.advanceTimersByTime(1); ready(); fail('unavailable'); });
  expect(result.current.reference.navigationHighlight).toBeNull();
  expect(publish).toHaveBeenCalledOnce();
  expect(unavailable).not.toHaveBeenCalled();
  act(() => result.current.history.history.traverse('back'));
  act(() => restoreReady());
  expect(result.current.selection).toEqual(departure);
  expect(result.current.x).toBe(0);
  const back = result.current.history.historyRestoreForSheet('departure')!;
  expect(back).toMatchObject({ left: 12, top: 0 });
  act(() => result.current.history.acknowledgeGridRestore('departure', back.generation));
  act(() => result.current.history.history.traverse('forward'));
  act(() => restoreReady());
  expect(result.current.selection).toEqual(arrival);
  expect(result.current.x).toBe(42);
  const forward = result.current.history.historyRestoreForSheet(sheet.id)!;
  expect(forward).toMatchObject({ left: 0, top: 34 });
  act(() => result.current.history.acknowledgeGridRestore(sheet.id, forward.generation));
  unmount();
  containers.forEach((element) => element.remove());
});
