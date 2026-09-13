import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkbookController } from './useWorkbookController';
import { autosaveClient, deferred, persistedWorkbookClient } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import type { RowAppendResponse, SheetRevisionResponse } from '@infrastructure/persistence/workbookApi';

const sheet = sheetDocument({ id: 'sizes', name: 'Sizes', cells: { A1: '3', B1: '=A1+2' }, revision: 2 });
const row = sheet.content.rows[0], column = sheet.content.columns[0];

describe('workbook axis size commands', () => {
  it('saves presentation and removal while preserving calculation and frame state', async () => {
    const apiClient = persistedWorkbookClient(workbookWithSheets([sheet]));
    const calculationObserver = vi.fn();
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient, calculationObserver }));
    const results = result.current.formulaResults;
    calculationObserver.mockClear();
    act(() => result.current.commands.writeAxisSizes(sheet.id, [{ axis: 'row', axisId: row, size: 44 }, { axis: 'column', axisId: column, size: 160 }]));
    expect(result.current.workbook.documents[sheet.id].presentation).toEqual({ rowHeights: { [row]: 44 }, columnWidths: { [column]: 160 } });
    expect(result.current.workbook.documents[sheet.id].content).toBe(sheet.content);
    expect(result.current.workbook.documents[sheet.id].frame).toBe(sheet.frame);
    expect(result.current.formulaResults).toBe(results);
    expect(calculationObserver).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect((await apiClient.loadWorkbook()).documents[sheet.id].presentation).toEqual(result.current.workbook.documents[sheet.id].presentation);
    act(() => result.current.commands.writeAxisSizes(sheet.id, [{ axis: 'row', axisId: row, size: null }]));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect((await apiClient.loadWorkbook()).documents[sheet.id].presentation).toEqual({ rowHeights: {}, columnWidths: { [column]: 160 } });
    expect(result.current.formulaResults).toBe(results);
  });

  it('preserves multiple sizing commits and uses structural revision before later saves', async () => {
    const first = deferred<SheetRevisionResponse>();
    const append = deferred<RowAppendResponse>();
    const apiClient = autosaveClient({
      writeAxisSizes: vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce({ sheetId: sheet.id, revision: 5 }).mockResolvedValueOnce({ sheetId: sheet.id, revision: 6 }),
      appendRow: vi.fn().mockReturnValue(append.promise),
      writeCells: vi.fn().mockResolvedValue({ sheets: [{ sheetId: sheet.id, revision: 7 }] }),
    });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient }));
    act(() => {
      result.current.commands.writeAxisSizes(sheet.id, [{ axis: 'row', axisId: row, size: 40 }]);
      result.current.commands.appendRow(sheet.id);
      result.current.commands.writeAxisSizes(sheet.id, [{ axis: 'column', axisId: column, size: 120 }]);
      result.current.commands.writeAxisSizes(sheet.id, [{ axis: 'row', axisId: row, size: null }]);
      result.current.commands.updateCellContent(sheet.id, 'A1', '8');
    });
    expect(apiClient.writeAxisSizes).toHaveBeenCalledTimes(1);
    expect(apiClient.appendRow).not.toHaveBeenCalled();
    expect(result.current.creatingAxes[sheet.id].rows).toHaveLength(1);
    expect(result.current.workbook.documents[sheet.id].presentation).toEqual({ rowHeights: {}, columnWidths: { [column]: 120 } });
    first.resolve({ sheetId: sheet.id, revision: 3 });
    await waitFor(() => expect(apiClient.appendRow).toHaveBeenCalledWith(sheet.id, { revision: 3 }));
    expect(apiClient.writeAxisSizes).toHaveBeenCalledTimes(1);
    append.resolve({ sheetId: sheet.id, revision: 4, rowCount: 21, rowId: 'durable-new-row' });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(apiClient.writeAxisSizes).toHaveBeenNthCalledWith(2, sheet.id, [{ axis: 'column', axisId: column, size: 120 }], { revision: 4 });
    expect(apiClient.writeAxisSizes).toHaveBeenNthCalledWith(3, sheet.id, [{ axis: 'row', axisId: row, size: null }], { revision: 5 });
    expect(apiClient.writeCells).toHaveBeenCalledTimes(1);
    expect(result.current.workbook.documents[sheet.id].presentation.rowHeights['durable-new-row']).toBeUndefined();
    expect(result.current.workbook.documents[sheet.id].revision).toBe(7);
  });

  it('rejects invalid or pending identities atomically and ignores equal dimensions', async () => {
    const apiClient = autosaveClient();
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient }));
    act(() => {
      result.current.commands.writeAxisSizes(sheet.id, [{ axis: 'row', axisId: row, size: 40 }, { axis: 'column', axisId: 'pending-axis', size: 100 }]);
      result.current.commands.writeAxisSizes('missing', [{ axis: 'row', axisId: row, size: 40 }]);
      result.current.commands.writeAxisSizes(sheet.id, [{ axis: 'row', axisId: row, size: null }]);
    });
    expect(result.current.workbook.documents[sheet.id]).toBe(sheet);
    expect(apiClient.writeAxisSizes).not.toHaveBeenCalled();
    expect(result.current.saveStatus).toBe('saved');
  });
});
