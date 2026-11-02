import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useReferenceNavigation } from '@reference-navigation/useReferenceNavigation';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkspaceNavigationHistory } from './useWorkspaceNavigationHistory';

afterEach(() => vi.useRealTimers());

describe('reference navigation retirement', () => {
  it.each(['cancel', 'empty replacement'] as const)('retires an arrived but unsettled highlight on %s', (action) => {
    vi.useFakeTimers();
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet' });
    const cell = { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! };
    let ready = () => {};
    const { result } = renderHook(() => {
      const history = useWorkspaceNavigationHistory({ stageDestination: true, selection: null,
        viewport: { x: 0, y: 0, scale: 1 }, onRestoreSelection: () => true,
        onUnavailableTarget: vi.fn(), restoreViewport: () => () => {} });
      const reference = useReferenceNavigation({ workbook: workbookWithSheets([sheet]),
        onSelectReferenceTarget: vi.fn(), onExplicitNavigation: history.history.explicitNavigation,
        startNavigation: history.startExplicitNavigation,
        navigateToTarget: (_target, options) => { ready = options?.onSettled ?? (() => {}); return () => {}; } });
      return { history, reference };
    });
    act(() => { result.current.reference.navigateTarget({ kind: 'cell', target: { sheetId: sheet.id, cell } }, sheet); });
    act(() => ready());
    const generation = result.current.history.navigationRestoreForSheet(sheet.id)!;
    expect(result.current.reference.navigationHighlight).not.toBeNull();
    expect(result.current.reference.navigationMotion).toBe(true);
    act(() => {
      if (action === 'cancel') result.current.history.cancelNavigationRestore();
      else result.current.history.startExplicitSheetNavigation('empty', () => {}, () => () => {});
    });
    expect(result.current.reference.navigationHighlight).toBeNull();
    expect(result.current.reference.navigationMotion).toBe(false);
    act(() => { result.current.history.acknowledgeGridRestore(sheet.id, generation); ready(); vi.advanceTimersByTime(1200); });
    expect(result.current.reference.navigationHighlight).toBeNull();
  });

  it('does not let an old retirement clear a successor highlight', () => {
    vi.useFakeTimers();
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet' });
    const cell = { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! };
    const retirements: Array<() => void> = [];
    const { result } = renderHook(() => useReferenceNavigation({ workbook: workbookWithSheets([sheet]),
      onSelectReferenceTarget: vi.fn(), navigateToTarget: () => () => {},
      startNavigation: (_operation, _target, _viewport, ready, retire) => { retirements.push(retire!); ready(); } }));
    const navigate = () => result.current.navigateTarget({ kind: 'cell', target: { sheetId: sheet.id, cell } }, sheet);
    act(() => { navigate(); navigate(); });
    const identity = result.current.navigationHighlightIdentity;
    act(() => { retirements[0]!(); vi.advanceTimersByTime(1199); });
    expect(result.current.navigationHighlightIdentity).toBe(identity);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.navigationHighlight).toBeNull();
  });
});
