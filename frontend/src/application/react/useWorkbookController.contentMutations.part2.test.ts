import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { findSheetById } from '@workbook/read/queries';
import {
  WorkbookApiError,
  type RowAppendResponse,
} from '@infrastructure/persistence/workbookApi';
import { useWorkbookController } from '@application/react/useWorkbookController';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { positionedSheet, workbookWithSheets } from '@test-support/workbookFactories';

describe('useWorkbookController content mutations', () => {
  it('retires queued axis and saved work when an axis conflict confirms the sheet is missing', async () => {
    const runningCellSave = deferred<{ sheets: Array<{ sheetId: string; revision: number }> }>();
    const runningAppend = deferred<RowAppendResponse>();
    const writeCells = vi.fn().mockReturnValue(runningCellSave.promise);
    const renameSheet = vi.fn();
    const appendColumn = vi.fn();
    const apiClient = autosaveClient({
      appendRow: vi.fn().mockReturnValue(runningAppend.promise),
      appendColumn,
      loadSheet: vi.fn().mockRejectedValue(new WorkbookApiError('missing', 404, 'sheet-not-found')),
      renameSheet,
      writeCells,
    });
    const sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 10, y: 20 });
    const { result } = renderHook(() => useWorkbookController({
      apiClient,
      initialWorkbook: workbookWithSheets([sheet]),
    }));

    act(() => {
      result.current.commands.updateCellContent(sheet.id, 'A1', 'running');
      result.current.commands.renameSheet(sheet.id, 'Never sent');
      result.current.commands.appendRow(sheet.id);
      result.current.commands.appendColumn(sheet.id);
    });

    expect(writeCells).toHaveBeenCalledTimes(1);
    expect(renameSheet).not.toHaveBeenCalled();
    expect(appendColumn).not.toHaveBeenCalled();

    expect(apiClient.appendRow).not.toHaveBeenCalled();
    runningCellSave.resolve({ sheets: [{ sheetId: sheet.id, revision: 2 }] });
    await waitFor(() => expect(apiClient.appendRow).toHaveBeenCalledWith(sheet.id, { revision: 2 }));
    runningAppend.reject(new WorkbookApiError('conflict', 409, 'sheet-revision-conflict'));
    await waitFor(() => expect(result.current.workbook.manifest.sheetIds).toEqual([]));
    expect(apiClient.loadSheet).toHaveBeenCalledWith(sheet.id);
    expect(renameSheet).not.toHaveBeenCalled();
    expect(appendColumn).not.toHaveBeenCalled();
    expect(result.current.saveStatus).toBe('saved');

    await runningCellSave.promise;
    expect(renameSheet).not.toHaveBeenCalled();
    expect(appendColumn).not.toHaveBeenCalled();
    expect(result.current.saveStatus).toBe('saved');
  });

  it('serializes saved mutations after axis responses with the current revision', async () => {
    const axisSave = deferred<RowAppendResponse>();
    const renameSave = deferred<{ sheetId: string; revision: number }>();
    const apiClient = autosaveClient({
      appendRow: vi.fn().mockReturnValue(axisSave.promise),
      renameSheet: vi.fn().mockReturnValue(renameSave.promise),
    });
    const sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 10, y: 20 });
    const { result } = renderHook(() => useWorkbookController({
      apiClient,
      initialWorkbook: workbookWithSheets([sheet]),
    }));

    act(() => {
      result.current.commands.appendRow(sheet.id);
      result.current.commands.renameSheet(sheet.id, 'Renamed');
    });
    expect(apiClient.appendRow).toHaveBeenCalledWith(sheet.id, { revision: 0 });
    expect(apiClient.renameSheet).not.toHaveBeenCalled();

    axisSave.resolve({ sheetId: sheet.id, revision: 1, rowCount: 21, rowId: 'late-row' });
    await waitFor(() => expect(result.current.creatingAxes[sheet.id]).toBeUndefined());
    await waitFor(() => expect(apiClient.renameSheet).toHaveBeenCalledWith(sheet.id, 'Renamed', { revision: 1 }));
    renameSave.resolve({ sheetId: sheet.id, revision: 2 });
    await waitFor(() => expect(findSheetById(result.current.workbook, sheet.id)?.revision).toBe(2));

    act(() => result.current.commands.moveSheetFrame(sheet.id, { x: 20, y: 30 }));
    expect(apiClient.updateSheetPosition).toHaveBeenCalledWith(sheet.id, { x: 20, y: 30 }, { revision: 2 });
    expect(findSheetById(result.current.workbook, sheet.id)?.revision).toBe(2);
  });

});
