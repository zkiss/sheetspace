import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useReferenceNavigation } from './useReferenceNavigation';
import type { FormulaInspectionReference } from './formulaInspection';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

const span = { start: 1, end: 3 };

function reference(
  target: FormulaInspectionReference['target'],
  navigable = true,
): FormulaInspectionReference {
  return {
    kind: 'reference',
    text: 'A1',
    sourceSpan: span,
    displaySpan: span,
    target,
    broken: !navigable,
    navigable,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useReferenceNavigation', () => {
  it('ignores broken, missing-sheet, and unresolved durable targets', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet' });
    const navigateToTarget = vi.fn();
    const onSelectReferenceTarget = vi.fn();
    const { result } = renderHook(() => useReferenceNavigation({
      navigateToTarget,
      onSelectReferenceTarget,
      workbook: workbookWithSheets([sheet]),
    }));

    act(() => {
      result.current.navigateReference(reference({
        kind: 'cell', sheetId: sheet.id,
        identity: { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! },
      }, false));
      result.current.navigateReference(reference({
        kind: 'cell', sheetId: 'missing',
        identity: { rowId: 'row', columnId: 'column' },
      }));
      result.current.navigateReference(reference({ kind: 'range', sheetId: sheet.id }));
      result.current.navigateReference(reference({
        kind: 'range', sheetId: sheet.id,
        range: {
          start: { rowId: 'missing', columnId: sheet.content.columns[0]! },
          end: { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! },
        },
      }));
      result.current.navigateReference(reference({ kind: 'cell', sheetId: sheet.id }));
    });

    expect(onSelectReferenceTarget).not.toHaveBeenCalled();
    expect(navigateToTarget).not.toHaveBeenCalled();
  });

  it('normalizes reversed ranges, requests oversized navigation, and expires transient state', () => {
    vi.useFakeTimers();
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet' });
    const navigateToTarget = vi.fn();
    const onSelectReferenceTarget = vi.fn();
    const { result } = renderHook(() => useReferenceNavigation({
      navigateToTarget,
      onSelectReferenceTarget,
      workbook: workbookWithSheets([sheet]),
    }));
    const target = reference({
      kind: 'range',
      sheetId: sheet.id,
      range: {
        start: { rowId: sheet.content.rows[19]!, columnId: sheet.content.columns[9]! },
        end: { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! },
      },
    });

    act(() => { result.current.navigateReference(target); });

    expect(onSelectReferenceTarget).toHaveBeenCalledWith({
      kind: 'range',
      sheetId: sheet.id,
      range: {
        start: { rowId: sheet.content.rows[0], columnId: sheet.content.columns[0] },
        end: { rowId: sheet.content.rows[19], columnId: sheet.content.columns[9] },
      },
    });
    expect(navigateToTarget).toHaveBeenCalledWith(expect.objectContaining({
      left: 0,
      top: 0,
    }), expect.objectContaining({ forceOversized: true, minimumScale: 0.5 }));
    expect(result.current.navigationHighlight).not.toBeNull();
    expect(result.current.navigationMotion).toBe(true);

    act(() => { vi.advanceTimersByTime(1_200); });
    expect(result.current.navigationHighlight).toBeNull();
    expect(result.current.navigationMotion).toBe(false);
  });

  it('selects a durable cell without motion when reduced motion is requested', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet' });
    const navigateToTarget = vi.fn();
    const onSelectReferenceTarget = vi.fn();
    const { result } = renderHook(() => useReferenceNavigation({
      navigateToTarget,
      onSelectReferenceTarget,
      workbook: workbookWithSheets([sheet]),
    }));

    act(() => {
      result.current.navigateReference(reference({
        kind: 'cell', sheetId: sheet.id,
        identity: { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! },
      }));
    });

    expect(onSelectReferenceTarget).toHaveBeenCalledWith({
      kind: 'cell',
      target: {
        sheetId: sheet.id,
        cell: { rowId: sheet.content.rows[0], columnId: sheet.content.columns[0] },
      },
    });
    expect(navigateToTarget).toHaveBeenCalledWith(expect.objectContaining({
      left: 0,
      top: 0,
    }), expect.objectContaining({ forceOversized: false, minimumScale: 0.5 }));
    expect(result.current.navigationMotion).toBe(false);
    expect(result.current.navigationHighlight).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1_200); });
    expect(result.current.navigationHighlight).toBeNull();
  });

  it('settles explicit navigation only after both controller motion and grid reveal acknowledge it', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet' });
    const navigateToTarget = vi.fn();
    let settled = 0;
    const { result } = renderHook(() => useReferenceNavigation({
      navigateToTarget,
      onExplicitNavigation: (navigate) => navigate(() => { settled += 1; }),
      onSelectReferenceTarget: vi.fn(),
      workbook: workbookWithSheets([sheet]),
    }));

    act(() => result.current.navigateReference(reference({
      kind: 'cell', sheetId: sheet.id,
      identity: { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! },
    })));

    const controllerSettled = navigateToTarget.mock.calls[0]![1].onSettled as () => void;
    act(controllerSettled);
    expect(settled).toBe(0);
    act(() => result.current.acknowledgeNavigationReveal(result.current.navigationHighlightIdentity!));
    expect(settled).toBe(1);
  });

  it('restarts highlight lifetime and identity on repeated navigation, then replaces the target', () => {
    vi.useFakeTimers();
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet' });
    const select = vi.fn();
    const { result } = renderHook(() => useReferenceNavigation({
      navigateToTarget: vi.fn(), onSelectReferenceTarget: select, workbook: workbookWithSheets([sheet]),
    }));
    const identity = { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! };
    const target = reference({ kind: 'cell', sheetId: sheet.id, identity });
    act(() => { result.current.navigateReference(target); });
    const firstIdentity = result.current.navigationHighlightIdentity;
    act(() => { vi.advanceTimersByTime(800); result.current.navigateReference(target); });
    expect(result.current.navigationHighlightIdentity).not.toBe(firstIdentity);
    act(() => { vi.advanceTimersByTime(400); });
    expect(result.current.navigationHighlight).not.toBeNull();
    const range = { start: identity,
      end: { rowId: sheet.content.rows[2]!, columnId: sheet.content.columns[2]! } };
    act(() => { result.current.navigateReference(reference({ kind: 'range', sheetId: sheet.id, range })); });
    expect(result.current.navigationHighlight).toEqual({ kind: 'range', sheetId: sheet.id, range });
    act(() => { vi.advanceTimersByTime(1_199); });
    expect(result.current.navigationHighlight).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.navigationHighlight).toBeNull();
    expect(select).toHaveBeenCalledTimes(3);
  });
});
