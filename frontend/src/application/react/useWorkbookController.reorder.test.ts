import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';

describe('axis reorder history', () => {
  it('applies consecutive moves immediately and interleaves them with cell edits', () => {
    const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 3, columnCount: 2 });
    const [a, b, c] = sheet.content.rows;
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]) }));
    act(() => {
      result.current.commands.shiftAxis('s', 'row', [a!], 1);
      result.current.commands.shiftAxis('s', 'row', [a!], 1);
      result.current.commands.updateCellContent('s', 'A1', '42');
    });
    expect(result.current.workbook.documents.s!.content.rows).toEqual([b, c, a]);
    act(() => result.current.commands.undo());
    act(() => result.current.commands.undo());
    expect(result.current.workbook.documents.s!.content.rows).toEqual([b, a, c]);
    act(() => result.current.commands.undo());
    expect(result.current.workbook.documents.s!.content.rows).toEqual([a, b, c]);
    act(() => result.current.commands.redo());
    act(() => result.current.commands.redo());
    act(() => result.current.commands.redo());
    expect(result.current.workbook.documents.s!.content.rows).toEqual([b, c, a]);
  });

  it('does not add history for invalid or boundary moves', () => {
    const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 2, columnCount: 2 });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]) }));
    act(() => {
      expect(result.current.commands.shiftAxis('s', 'row', [sheet.content.rows[0]!], -1).status).toBe('unchanged');
      expect(result.current.commands.gatherAxis('s', 'column', ['missing'], 0).status).toBe('rejected');
    });
    expect(result.current.canUndo).toBe(false);
  });
});
