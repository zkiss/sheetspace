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

  it('keeps order conflict feedback on frame changes and clears it on a new cell edit', () => {
    const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 2, columnCount: 1 });
    const other = sheetDocument({ id: 'other', name: 'Other', rowCount: 1, columnCount: 1 });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet, other]) }));
    act(() => result.current.commands.shiftAxis('s', 'row', [sheet.content.rows[0]!], 1));
    act(() => result.current.commands.deleteSheet('s'));
    act(() => result.current.commands.undo());
    expect(result.current.orderReplayFailure).toBe('order-conflict');
    act(() => result.current.commands.moveSheetFrame('other', { x: 50, y: 60 }));
    expect(result.current.orderReplayFailure).toBe('order-conflict');
    act(() => result.current.commands.updateCellContent('other', 'A1', '42'));
    expect(result.current.orderReplayFailure).toBeUndefined();
  });

  it('clears order conflict feedback and history when a lifecycle transition resets history', () => {
    const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 2, columnCount: 1 });
    const other = sheetDocument({ id: 'other', name: 'Other', rowCount: 1, columnCount: 1 });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet, other]) }));
    act(() => result.current.commands.shiftAxis('s', 'row', [sheet.content.rows[0]!], 1));
    act(() => result.current.commands.deleteSheet('s'));
    act(() => result.current.commands.undo());
    expect(result.current.orderReplayFailure).toBe('order-conflict');
    expect(result.current.canUndo).toBe(true);

    act(() => expect(result.current.commands.renameColumn('other', other.content.columns[0]!, 'Revenue').result.ok).toBe(true));
    expect(result.current.orderReplayFailure).toBeUndefined();
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.workbook.documents.other!.columnNames).toEqual({ [other.content.columns[0]!]: 'Revenue' });
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

  it('gathers noncontiguous columns as one undoable action', () => {
    const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 2, columnCount: 5 });
    const [a, b, c, d, e] = sheet.content.columns;
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]) }));
    act(() => {
      expect(result.current.commands.gatherAxis('s', 'column', [b!, d!], 5).status).toBe('changed');
    });
    expect(result.current.workbook.documents.s!.content.columns).toEqual([a, c, e, b, d]);
    act(() => result.current.commands.undo());
    expect(result.current.workbook.documents.s!.content.columns).toEqual([a, b, c, d, e]);
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.commands.redo());
    expect(result.current.workbook.documents.s!.content.columns).toEqual([a, c, e, b, d]);
  });
});
