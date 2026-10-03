import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { smallSheetDocument } from '@test-support/workbookFactories';
import { formattingModes, formattingSelection, observeFormattingProjection } from '@test-support/formattingProjection';
import { useFormattingSelection } from './useFormattingSelection';

afterEach(() => vi.restoreAllMocks());

describe.each(formattingModes)('%s independent palette cache', (mode) => {
  it('rescans on outside-cell colour addition/removal while keeping geometry and the selected summary values unchanged', () => {
    const sheet = smallSheetDocument({ id: 'outside', name: 'Outside', rowCount: 4, columnCount: 4 });
    const selection = formattingSelection(sheet, mode);
    const work = observeFormattingProjection();
    const { result, rerender } = renderHook(({ sheet }) => useFormattingSelection(sheet, selection), { initialProps: { sheet } });
    const original = result.current;
    work.clear();
    const outside = cellIdentityKey({ rowId: sheet.content.rows[3]!, columnId: sheet.content.columns[3]! });
    rerender({ sheet: { ...sheet, presentation: { ...sheet.presentation, formatOverrides: {
      rows: {}, columns: {}, cells: { [outside]: { textColor: '#ABCDEF', fillColor: '#abcdef' } },
    } } } });
    work.expectCalls(0, 1, 1);
    expect(result.current.descriptor).toBe(original.descriptor);
    expect(result.current.summary).not.toBe(original.summary);
    expect(result.current.summary).toEqual(original.summary);
    expect(result.current.customColours).toEqual(['#abcdef']);
    work.clear();
    rerender({ sheet });
    work.expectCalls(0, 1, 1);
    expect(result.current.descriptor).toBe(original.descriptor);
    expect(result.current.summary).toEqual(original.summary);
    expect(result.current.customColours).toEqual([]);
  });

  it('refreshes summary and normalized/filtered/sorted colours for outside-selection override addition and removal', () => {
    const sheet = smallSheetDocument({ id: 'palette', name: 'Palette', rowCount: 4, columnCount: 4 });
    const selection = formattingSelection(sheet, mode);
    const work = observeFormattingProjection();
    const { result, rerender } = renderHook(({ sheet, selection }) => useFormattingSelection(sheet, selection), {
      initialProps: { sheet, selection },
    });
    const summary = result.current.summary;
    work.expectCalls(1, 1, 1);
    work.clear();
    const outside = cellIdentityKey({ rowId: sheet.content.rows[3]!, columnId: sheet.content.columns[3]! });
    const styled = { ...sheet, presentation: { ...sheet.presentation, formatOverrides: {
      rows: { [sheet.content.rows[3]!]: { textColor: '#FF0000' as const, fillColor: 'none' as const } },
      columns: { [sheet.content.columns[3]!]: { fillColor: '#00FF00' as const, textColor: 'automatic' as const } },
      cells: { [outside]: { textColor: '#ff0000' as const, fillColor: '#0000FF' as const },
        dead: { textColor: '#1F2933' as const, fillColor: '#ffffff' as const },
        another: { fillColor: '#000000' as const } },
    } } };
    rerender({ sheet: styled, selection });
    work.expectCalls(0, 1, 1);
    expect(result.current.summary).not.toBe(summary);
    expect(result.current.customColours).toEqual(['#ff0000', '#00ff00', '#0000ff', '#000000', '#ffffff']);
    work.clear();
    // Palette scans are independent of both changed geometry and sheet content.
    const changedSelection = { ...selection, extent: selection.anchor };
    rerender({ sheet: { ...styled, content: { ...styled.content, rows: [...styled.content.rows].reverse(), cells: {} } }, selection: changedSelection });
    work.expectCalls(1, 1, 0);
    work.clear();
    rerender({ sheet, selection: changedSelection });
    work.expectCalls(1, 1, 1);
    expect(result.current.customColours).toEqual([]);
  });
});
