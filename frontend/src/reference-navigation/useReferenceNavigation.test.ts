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
    expect(navigateToTarget).toHaveBeenCalledWith(expect.any(Object), true);
    expect(result.current.navigationHighlight).not.toBeNull();
    expect(result.current.navigationMotion).toBe(true);

    act(() => { vi.advanceTimersByTime(1_200); });
    expect(result.current.navigationHighlight).toBeNull();
    expect(result.current.navigationMotion).toBe(false);
  });

  it('selects a durable cell without motion when reduced motion is requested', () => {
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
    expect(navigateToTarget).toHaveBeenCalledWith(expect.any(Object), false);
    expect(result.current.navigationMotion).toBe(false);
  });
});
