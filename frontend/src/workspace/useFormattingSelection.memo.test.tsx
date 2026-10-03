import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SheetDocument } from '@workbook/core/model';
import type { FormattingSelection } from '@workbook/read/formattingSelection';
import { smallSheetDocument } from '@test-support/workbookFactories';
import { formattingModes, formattingSelection, observeFormattingProjection } from '@test-support/formattingProjection';
import { useFormattingSelection, type FormattingSelectionProjection } from './useFormattingSelection';

afterEach(() => vi.restoreAllMocks());

describe.each(formattingModes)('%s projection memo dependencies', (mode) => {
  function setup() {
    const sheet = smallSheetDocument({ id: 'memo', name: 'Memo', rowCount: 4, columnCount: 4 });
    const selection = formattingSelection(sheet, mode);
    const work = observeFormattingProjection();
    const hook = renderHook<FormattingSelectionProjection, {
      sheet: SheetDocument | undefined; selection: FormattingSelection | null;
    }>(({ sheet, selection }) => useFormattingSelection(sheet, selection), { initialProps: { sheet, selection } });
    work.expectCalls(1, 1, 1);
    work.clear();
    return { sheet, selection, work, ...hook };
  }

  it('retains geometry, summary and palette for scalar-equivalent selection and non-format sheet changes', () => {
    const { sheet, selection, work, result, rerender } = setup();
    const original = result.current;
    const equivalent = { ...selection,
      anchor: { ...selection.anchor, cell: { ...selection.anchor.cell } },
      extent: { ...selection.extent, cell: { ...selection.extent.cell } },
    };
    const variants = [
      { ...sheet, content: { ...sheet.content, cells: { changed: 'content-only' } } },
      { ...sheet, frame: { ...sheet.frame, position: { x: 50, y: 20 }, size: { width: 500, height: 300 }, visualScale: 2 } },
      { ...sheet, revision: 7, name: 'Renamed' },
      { ...sheet, presentation: { ...sheet.presentation, rowHeights: { [sheet.content.rows[0]!]: 50 }, columnWidths: {} } },
    ];
    for (const next of variants) {
      rerender({ sheet: next, selection: equivalent });
      expect(result.current.descriptor).toBe(original.descriptor);
      expect(result.current.summary).toBe(original.summary);
      expect(result.current.customColours).toBe(original.customColours);
    }
    work.expectCalls(0, 0, 0);
  });

  it.each(['rows', 'columns'] as const)('revalidates immutable %s replacement and reorder with changed interior', (axis) => {
    const { sheet, selection, work, result, rerender } = setup();
    const axes = sheet.content[axis];
    rerender({ sheet: { ...sheet, content: { ...sheet.content, [axis]: [...axes] } }, selection });
    work.expectCalls(1, 1, 0);
    work.clear();
    // Stable endpoints 0 and 2 now enclose former outside ID 3 rather than ID 1.
    const reordered = [axes[0]!, axes[3]!, axes[2]!, axes[1]!];
    rerender({ sheet: { ...sheet, content: { ...sheet.content, [axis]: reordered } }, selection });
    work.expectCalls(1, 1, 0);
    expect(result.current.descriptor).toMatchObject({ valid: true, [axis]: reordered });
  });

  it.each(['anchor', 'extent'] as const)('revalidates every %s scalar, including opposite-axis IDs and endpoint sheet ID', (endpoint) => {
    const { sheet, selection, work, result, rerender } = setup();
    for (const axis of ['rowId', 'columnId'] as const) {
      const ids = axis === 'rowId' ? sheet.content.rows : sheet.content.columns;
      rerender({ sheet, selection: { ...selection, [endpoint]: {
        ...selection[endpoint], cell: { ...selection[endpoint].cell, [axis]: ids[1]! },
      } } });
      work.expectCalls(1, 1, 0);
      expect(result.current.descriptor.valid).toBe(true);
      rerender({ sheet, selection });
      work.clear();
      rerender({ sheet, selection: { ...selection, [endpoint]: {
        ...selection[endpoint], cell: { ...selection[endpoint].cell, [axis]: 'missing' },
      } } });
      work.expectCalls(1, 0, 0);
      expect(result.current.descriptor.valid).toBe(false);
      expect(result.current.summary).toBeUndefined();
      rerender({ sheet, selection });
      work.clear();
    }
    rerender({ sheet, selection: { ...selection, [endpoint]: { ...selection[endpoint], sheetId: 'other' } } });
    work.expectCalls(1, 0, 0);
    expect(result.current.summary).toBeUndefined();
  });

  it('revalidates mode changes without repaletting', () => {
    const { sheet, selection, work, result, rerender } = setup();
    for (const nextMode of formattingModes.filter((candidate) => candidate !== mode)) {
      work.clear();
      rerender({ sheet, selection: { ...selection, mode: nextMode } });
      work.expectCalls(1, 1, 0);
      expect(result.current.descriptor).toMatchObject({ valid: true, mode: nextMode });
    }
  });

  it.each(['rows', 'columns'] as const)('clears summaries on endpoint removal from %s, including the opposite axis', (axis) => {
    const { sheet, selection, work, result, rerender } = setup();
    rerender({ sheet: { ...sheet, content: { ...sheet.content, [axis]: sheet.content[axis].slice(1) } }, selection });
    work.expectCalls(1, 0, 0);
    expect(result.current.descriptor.valid).toBe(false);
    expect(result.current.summary).toBeUndefined();
  });

  it('clears selection and missing-sheet summaries and refreshes all caches on sheet identity change', () => {
    const { sheet, selection, work, result, rerender } = setup();
    rerender({ sheet, selection: null });
    work.expectCalls(1, 0, 0);
    expect(result.current.summary).toBeUndefined();
    rerender({ sheet, selection });
    work.clear();
    rerender({ sheet: { ...sheet, id: 'other' }, selection });
    work.expectCalls(1, 0, 1);
    expect(result.current.summary).toBeUndefined();
    work.clear();
    const moved = { ...selection, anchor: { ...selection.anchor, sheetId: 'other' }, extent: { ...selection.extent, sheetId: 'other' } };
    rerender({ sheet: { ...sheet, id: 'other' }, selection: moved });
    work.expectCalls(1, 1, 0);
    expect(result.current.descriptor).toMatchObject({ valid: true, sheetId: 'other' });
    work.clear();
    rerender({ sheet: undefined, selection });
    work.expectCalls(1, 0, 1);
    expect(result.current.summary).toBeUndefined();
  });
});
