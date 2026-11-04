import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CONTENT_HISTORY_MAX_BYTES } from '@application/core/contentHistory';
import { autosaveClient } from '@test-support/apiClients';
import { cellRawContent } from '@workbook/read/queries';
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

  it('preserves both history stacks and emits no order writes for rejected and unchanged requests on either axis', () => {
    const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 3, columnCount: 3 });
    const api = autosaveClient();
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
    act(() => {
      result.current.commands.updateCellContent('s', 'A1', 'first');
      result.current.commands.updateCellContent('s', 'A1', 'second');
      result.current.commands.undo();
    });
    const before = result.current.workbook;
    act(() => {
      for (const axis of ['row', 'column'] as const) {
        const ids = axis === 'row' ? sheet.content.rows : sheet.content.columns;
        expect(result.current.commands.shiftAxis('s', axis, [ids[0]!], -1).status).toBe('unchanged');
        expect(result.current.commands.shiftAxis('s', axis, [ids[2]!], 1).status).toBe('unchanged');
        expect(result.current.commands.gatherAxis('s', axis, [ids[0]!], 0).status).toBe('unchanged');
        expect(result.current.commands.gatherAxis('s', axis, ['missing'], 0).status).toBe('rejected');
        expect(result.current.commands.shiftAxis('s', axis, [ids[0]!, ids[0]!], 1).status).toBe('rejected');
      }
    });
    expect(result.current.workbook).toBe(before);
    expect(api.writeAxisOrder).not.toHaveBeenCalled();
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.commands.redo());
    expect(cellRawContent(result.current.workbook.documents.s!, 'A1')).toBe('"second"');
    act(() => result.current.commands.undo());
    act(() => result.current.commands.undo());
    expect(cellRawContent(result.current.workbook.documents.s!, 'A1')).toBeUndefined();
    expect(result.current.canUndo).toBe(false);
  });

  it('rejects model-owned columns while allowing saved rows to move', () => {
    const sheet = { ...sheetDocument({ id: 's', name: 'Source', rowCount: 2, columnCount: 2 }), modelId: 'model' };
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]) }));
    act(() => expect(result.current.commands.shiftAxis('s', 'column', [sheet.content.columns[0]!], 1).status).toBe('rejected'));
    expect(result.current.canUndo).toBe(false);
    act(() => expect(result.current.commands.shiftAxis('s', 'row', [sheet.content.rows[0]!], 1).status).toBe('changed'));
    expect(result.current.workbook.documents.s!.content.rows).toEqual([...sheet.content.rows].reverse());
    expect(result.current.workbook.documents.s!.content.columns).toEqual(sheet.content.columns);
  });

  it('rejects an oversized order without publishing it or disturbing either history stack', () => {
    const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 3, columnCount: 1 });
    const large = sheetDocument({ id: 'large', name: 'Large', rowCount: 2, columnCount: 1 });
    large.content.rows = [`a${'x'.repeat(CONTENT_HISTORY_MAX_BYTES / 2)}`, 'b'];
    const [a, b, c] = sheet.content.rows;
    const api = autosaveClient();
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet, large]), apiClient: api }));
    act(() => {
      result.current.commands.updateCellContent('s', 'A1', 'first');
      result.current.commands.updateCellContent('s', 'A1', 'second');
      result.current.commands.undo();
    });
    const before = result.current.workbook;
    act(() => {
      expect(result.current.commands.shiftAxis('large', 'row', [large.content.rows[0]!], 1)).toMatchObject({ status: 'rejected', reason: 'order-history-too-large' });
      expect(result.current.commands.shiftAxis('s', 'row', [a!], -1).status).toBe('unchanged');
      expect(result.current.commands.gatherAxis('s', 'row', ['missing'], 0).status).toBe('rejected');
    });
    expect(result.current.workbook).toBe(before);
    expect(api.writeAxisOrder).not.toHaveBeenCalled();
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.commands.redo());
    expect(cellRawContent(result.current.workbook.documents.s!, 'A1')).toBe('"second"');
    expect(result.current.canRedo).toBe(false);
    act(() => result.current.commands.undo());
    expect(cellRawContent(result.current.workbook.documents.s!, 'A1')).toBe('"first"');
    act(() => result.current.commands.undo());
    expect(cellRawContent(result.current.workbook.documents.s!, 'A1')).toBeUndefined();
    expect(result.current.canUndo).toBe(false);
    expect(result.current.workbook.documents.s!.content.rows).toEqual([a, b, c]);
    act(() => result.current.commands.redo());
    act(() => result.current.commands.redo());
    expect(cellRawContent(result.current.workbook.documents.s!, 'A1')).toBe('"second"');
    expect(result.current.canRedo).toBe(false);
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

  it('recalculates cross-sheet references through reorder and replay', () => {
    const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 2, columnCount: 1 });
    const target = sheetDocument({ id: 'target', name: 'Target', rowCount: 1, columnCount: 1 });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet, target]) }));
    act(() => {
      result.current.commands.updateCellContent('s', 'A1', '7');
      result.current.commands.updateCellContent('s', 'A2', '9');
      result.current.commands.updateCellContent('target', 'A1', '=@Source!A[1]');
    });
    expect(result.current.formulaResults.target.A1).toMatchObject({ value: 7 });
    act(() => result.current.commands.shiftAxis('s', 'row', [sheet.content.rows[0]!], 1));
    expect(result.current.formulaResults.target.A1).toMatchObject({ value: 7 });
    expect(cellRawContent(result.current.workbook.documents.s!, 'A2')).toBe('7');
    act(() => result.current.commands.undo());
    expect(cellRawContent(result.current.workbook.documents.s!, 'A1')).toBe('7');
    expect(result.current.formulaResults.target.A1).toMatchObject({ value: 7 });
    act(() => result.current.commands.redo());
    expect(cellRawContent(result.current.workbook.documents.s!, 'A2')).toBe('7');
    expect(result.current.formulaResults.target.A1).toMatchObject({ value: 7 });
  });
});
