import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cellRawContent, findSheetById, sheetBounds } from '@workbook/read/queries';
import { type SheetDocument } from '@workbook/core/model';
import {
  WorkbookApiError,
  type ColumnAppendResponse,
  type RowAppendResponse,
} from '@infrastructure/persistence/workbookApi';
import { useWorkbookController } from '@application/react/useWorkbookController';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { positionedSheet, sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

function documentWithCells(
  document: SheetDocument,
  cells: Record<string, string>,
  revision = document.revision,
): SheetDocument {
  const bounds = sheetBounds(document);
  return sheetDocument({
    id: document.id,
    name: document.name,
    position: document.frame.position,
    frameSize: document.frame.size,
    zIndex: document.frame.zIndex,
    revision,
    rowCount: bounds.rowCount,
    columnCount: bounds.columnCount,
    cells,
  });
}

async function expectQueuedAxisReconciliation(axis: 'row' | 'column') {
  const firstAppend = deferred<RowAppendResponse | ColumnAppendResponse>();
  const secondAppend = deferred<RowAppendResponse | ColumnAppendResponse>();
  const append = vi.fn()
    .mockReturnValueOnce(firstAppend.promise)
    .mockReturnValueOnce(secondAppend.promise);
  const apiClient = autosaveClient(axis === 'row' ? { appendRow: append } : { appendColumn: append });
  const sheet = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 10, y: 20 }), revision: 5 };
  const { result } = renderHook(() => useWorkbookController({
    apiClient,
    initialWorkbook: workbookWithSheets([sheet]),
  }));
  const slotKey = axis === 'row' ? 'rows' : 'columns';
  const firstId = `server-${axis}-first`;
  const secondId = `server-${axis}-second`;

  act(() => {
    result.current.commands[axis === 'row' ? 'appendRow' : 'appendColumn'](sheet.id);
    result.current.commands[axis === 'row' ? 'appendRow' : 'appendColumn'](sheet.id);
  });

  const queuedSlots = result.current.creatingAxes[sheet.id][slotKey];
  expect(queuedSlots).toHaveLength(2);
  expect(new Set(queuedSlots.map((slot) => slot.operationId)).size).toBe(2);
  expect(append).toHaveBeenCalledTimes(1);
  expect(append).toHaveBeenCalledWith(sheet.id, { revision: 5 });

  await act(async () => {
    firstAppend.resolve(axis === 'row'
      ? { sheetId: sheet.id, revision: 6, rowCount: 21, rowId: firstId }
      : { sheetId: sheet.id, revision: 6, columnCount: 11, columnId: firstId });
    await firstAppend.promise;
  });

  await waitFor(() => expect(append).toHaveBeenCalledTimes(2));
  expect(append).toHaveBeenNthCalledWith(2, sheet.id, { revision: 6 });
  expect(result.current.creatingAxes[sheet.id][slotKey].map((slot) => slot.operationId)).toEqual([
    queuedSlots[1].operationId,
  ]);
  const afterFirst = findSheetById(result.current.workbook, sheet.id)!.content[slotKey];
  expect(afterFirst.slice(-1)).toEqual([firstId]);
  expect(afterFirst.filter((id) => id === firstId)).toHaveLength(1);

  await act(async () => {
    secondAppend.resolve(axis === 'row'
      ? { sheetId: sheet.id, revision: 7, rowCount: 22, rowId: secondId }
      : { sheetId: sheet.id, revision: 7, columnCount: 12, columnId: secondId });
    await secondAppend.promise;
  });

  await waitFor(() => expect(result.current.creatingAxes[sheet.id]).toBeUndefined());
  const reconciledIds = findSheetById(result.current.workbook, sheet.id)!.content[slotKey];
  expect(reconciledIds.slice(-2)).toEqual([firstId, secondId]);
  expect(reconciledIds.filter((id) => id === firstId)).toHaveLength(1);
  expect(reconciledIds.filter((id) => id === secondId)).toHaveLength(1);
  expect(append).toHaveBeenCalledTimes(2);
}

describe('useWorkbookController content mutations', () => {
  it('holds an undo save behind its delayed original content save', async () => {
    const firstSave = deferred<{ sheets: { sheetId: string; revision: number }[] }>();
    const writeCells = vi.fn().mockReturnValueOnce(firstSave.promise).mockResolvedValue({ sheets: [{ sheetId: 'sheet-inputs', revision: 2 }] });
    const apiClient = autosaveClient({ writeCells });
    const sheet = sheetDocument({ id: 'sheet-inputs', name: 'Inputs' });
    const { result } = renderHook(() => useWorkbookController({
      apiClient,
      initialWorkbook: workbookWithSheets([sheet]),
    }));

    act(() => {
      result.current.commands.updateCellContent(sheet.id, 'A1', '7');
      result.current.commands.undo();
    });

    await waitFor(() => expect(writeCells).toHaveBeenCalledTimes(1));
    expect(writeCells).toHaveBeenCalledWith(
      [{ sheetId: sheet.id, revision: 0 }],
      [{ sheetId: sheet.id, rowId: 'sheet-inputs:row:1', columnId: 'sheet-inputs:column:1', raw: '7' }],
    );

    await act(async () => {
      firstSave.resolve({ sheets: [{ sheetId: sheet.id, revision: 1 }] });
      await firstSave.promise;
    });

    await waitFor(() => expect(writeCells).toHaveBeenCalledTimes(2));
    expect(writeCells).toHaveBeenNthCalledWith(
      2,
      [{ sheetId: sheet.id, revision: 1 }],
      [{ sheetId: sheet.id, rowId: 'sheet-inputs:row:1', columnId: 'sheet-inputs:column:1', raw: '' }],
    );
  });

  it('undoes and redoes content with fresh feedback while leaving presentation outside history', async () => {
    const apiClient = autosaveClient();
    const sheet = sheetDocument({ id: 'sheet-inputs', name: 'Inputs', cells: { B1: '=SUM(A1)' } });
    const { result } = renderHook(() => useWorkbookController({
      apiClient,
      initialWorkbook: workbookWithSheets([sheet]),
    }));

    act(() => {
      result.current.commands.updateCellContent(sheet.id, 'A1', '7');
      result.current.commands.moveSheetFrame(sheet.id, { x: 90, y: 80 });
      result.current.commands.undo();
    });

    expect(cellRawContent(findSheetById(result.current.workbook, sheet.id)!, 'A1')).toBeUndefined();
    expect(findSheetById(result.current.workbook, sheet.id)!.frame.position).toEqual({ x: 90, y: 80 });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
    const undoFeedback = result.current.contentHistoryFeedback;
    expect(undoFeedback?.before).toMatchObject([{ raw: '7' }]);
    expect(undoFeedback?.after).toMatchObject([{ raw: null }]);
    expect(Object.isFrozen(undoFeedback)).toBe(true);
    expect(Object.isFrozen(undoFeedback?.before)).toBe(true);
    expect(Object.isFrozen(undoFeedback?.before[0]!)).toBe(true);

    act(() => result.current.commands.redo());

    expect(cellRawContent(findSheetById(result.current.workbook, sheet.id)!, 'A1')).toBe('7');
    expect(result.current.formulaResults[sheet.id].B1.display).toBe('7');
    expect(result.current.contentHistoryFeedback?.identity).not.toBe(undoFeedback?.identity);
    expect(result.current.contentHistoryFeedback?.before).toMatchObject([{ raw: null }]);
    expect(result.current.contentHistoryFeedback?.after).toMatchObject([{ raw: '7' }]);
    await waitFor(() => expect(apiClient.writeCells).toHaveBeenCalledTimes(3));
  });

  it('keeps committed frame changes outside calculation', () => {
    const apiClient = autosaveClient();
    const sheet = sheetDocument({
      id: 'sheet-inputs',
      name: 'Inputs',
      position: { x: 10, y: 20 },
      cells: { A1: '=1' },
    });
    const calculate = vi.fn();
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        calculationObserver: calculate,
        initialWorkbook: workbookWithSheets([sheet]),
      }),
    );
    const initialResults = result.current.formulaResults;
    const initialContent = findSheetById(result.current.workbook, 'sheet-inputs')!.content;
    expect(calculate).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.commands.moveSheetFrame('sheet-inputs', { x: 50, y: 60 });
    });

    expect(findSheetById(result.current.workbook, 'sheet-inputs')?.frame.position).toEqual({ x: 50, y: 60 });
    expect(apiClient.updateSheetPosition).toHaveBeenCalledWith('sheet-inputs', { x: 50, y: 60 }, { revision: 0 });
    expect(findSheetById(result.current.workbook, 'sheet-inputs')!.content).toBe(initialContent);
    expect(result.current.formulaResults).toBe(initialResults);
    expect(findSheetById(result.current.workbook, 'sheet-inputs')!.content).toBe(initialContent);
    expect(calculate).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.commands.resizeSheetFrame(
        'sheet-inputs',
        { x: 50, y: 60 },
        { width: 400, height: 300 },
      );
      result.current.commands.changeSheetZOrder('sheet-inputs', 'top');
    });

    expect(result.current.formulaResults).toBe(initialResults);
    expect(calculate).toHaveBeenCalledTimes(1);
  });

  it('updates cells through a command and derives formula display results from workbook state', () => {
    const apiClient = autosaveClient();
    const calculate = vi.fn();
    const sheet = sheetDocument({
      id: 'sheet-inputs',
      name: 'Inputs',
      cells: { B1: '=SUM(A1)' },
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        calculationObserver: calculate,
        initialWorkbook: workbookWithSheets([sheet]),
      }),
    );

    act(() => {
      result.current.commands.updateCellContent('sheet-inputs', 'A1', '7');
    });

    expect(cellRawContent(findSheetById(result.current.workbook, 'sheet-inputs')!, 'A1')).toEqual('7');
    expect(result.current.formulaResults['sheet-inputs'].B1.display).toBe('7');
    expect(calculate).toHaveBeenLastCalledWith({
        kind: 'cells',
        cells: [{ sheetId: 'sheet-inputs', key: 'A1' }],
    });
    expect(apiClient.writeCells).toHaveBeenCalledTimes(1);
  });

  it('uses one current transition for batched change-then-restore cell actions', async () => {
    const apiClient = autosaveClient();
    const calculate = vi.fn();
    const sheet = sheetDocument({
      id: 'sheet-inputs',
      name: 'Inputs',
      cells: { B1: '=SUM(A1)' },
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        calculationObserver: calculate,
        initialWorkbook: workbookWithSheets([sheet]),
      }),
    );

    act(() => {
      result.current.commands.updateCellContent('sheet-inputs', 'A1', '7');
      result.current.commands.updateCellContent('sheet-inputs', 'A1', '');
    });

    expect(cellRawContent(findSheetById(result.current.workbook, 'sheet-inputs')!, 'A1')).toBeUndefined();
    expect(result.current.formulaResults['sheet-inputs'].B1.display).toBe('0');
    expect(calculate).toHaveBeenLastCalledWith({
      kind: 'cells',
      cells: [{ sheetId: 'sheet-inputs', key: 'A1' }],
    });
    await waitFor(() => expect(apiClient.writeCells).toHaveBeenCalledTimes(2));
  });

  it('keeps local committed cell edits visibly failed when conflict recovery finds a changed remote cell', async () => {
    const initialSheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 });
    const staleServerSheet = documentWithCells(initialSheet, { A1: 'server value' }, 4);
    const apiClient = autosaveClient({
      loadSheet: vi.fn().mockResolvedValue(staleServerSheet),
      writeCells: vi
        .fn()
        .mockRejectedValueOnce(new WorkbookApiError('sheet-revision-conflict', 409, 'sheet-revision-conflict')),
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([initialSheet]),
      }),
    );

    act(() => {
      result.current.commands.updateCellContent('sheet-inputs', 'A1', 'Local value');
    });

    await waitFor(() => expect(apiClient.writeCells).toHaveBeenCalledTimes(1));
    expect(apiClient.loadSheet).toHaveBeenCalledWith('sheet-inputs');
    expect(cellRawContent(findSheetById(result.current.workbook, 'sheet-inputs')!, 'A1')).toEqual('Local value');
    await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
  });

  it('renames sheets through autosave with the current revision token', () => {
    const apiClient = autosaveClient();
    const sheet = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 10, y: 20 }), revision: 4 };
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([sheet]),
      }),
    );

    act(() => {
      const renamed = result.current.commands.renameSheet('sheet-inputs', 'Renamed Inputs');
      expect(renamed.ok).toBe(true);
    });

    expect(findSheetById(result.current.workbook, 'sheet-inputs')?.name).toBe('Renamed Inputs');
    expect(apiClient.renameSheet).toHaveBeenCalledWith('sheet-inputs', 'Renamed Inputs', { revision: 4 });
  });

  it('queues creating axis slots without changing durable bounds', async () => {
    const rowAppend = deferred<{ sheetId: string; revision: number; rowCount: number; rowId: string }>();
    const columnAppend = deferred<{ sheetId: string; revision: number; columnCount: number; columnId: string }>();
    const apiClient = autosaveClient({
      appendRow: vi.fn().mockReturnValue(rowAppend.promise),
      appendColumn: vi.fn().mockReturnValue(columnAppend.promise),
    });
    const sheet = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 10, y: 20 }), revision: 5 };
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([sheet]),
      }),
    );

    act(() => {
      result.current.commands.appendRow('sheet-inputs');
    });
    act(() => {
      result.current.commands.appendColumn('sheet-inputs');
    });

    expect(sheetBounds(findSheetById(result.current.workbook, 'sheet-inputs')!)).toEqual({
      rowCount: 20,
      columnCount: 10,
    });
    expect(result.current.creatingAxes['sheet-inputs']).toMatchObject({
      rows: [{ kind: 'creating' }],
      columns: [{ kind: 'creating' }],
    });
    expect(apiClient.appendRow).toHaveBeenCalledWith('sheet-inputs', { revision: 5 });
    expect(apiClient.appendColumn).not.toHaveBeenCalled();

    await act(async () => {
      rowAppend.resolve({ sheetId: 'sheet-inputs', revision: 6, rowCount: 21, rowId: 'server-row' });
      await rowAppend.promise;
    });

    await waitFor(() => expect(apiClient.appendColumn).toHaveBeenCalledWith('sheet-inputs', { revision: 6 }));
    expect(sheetBounds(findSheetById(result.current.workbook, 'sheet-inputs')!)).toEqual({
      rowCount: 21,
      columnCount: 10,
    });

    await act(async () => {
      columnAppend.resolve({ sheetId: 'sheet-inputs', revision: 7, columnCount: 11, columnId: 'server-column' });
      await columnAppend.promise;
    });

    await waitFor(() => expect(result.current.creatingAxes['sheet-inputs']).toBeUndefined());
    expect(apiClient.appendColumn).toHaveBeenCalledWith('sheet-inputs', { revision: 6 });
  });

  it.each(['row', 'column'] as const)(
    'reconciles queued %s placeholders once in request order with exact backend IDs',
    expectQueuedAxisReconciliation,
  );

  it('removes only the failed creating slot and reports a failed save', async () => {
    const rowAppend = deferred<{ sheetId: string; revision: number; rowCount: number; rowId: string }>();
    const apiClient = autosaveClient({ appendRow: vi.fn().mockReturnValue(rowAppend.promise) });
    const sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 10, y: 20 });
    const { result } = renderHook(() => useWorkbookController({
      apiClient,
      initialWorkbook: workbookWithSheets([sheet]),
    }));

    act(() => result.current.commands.appendRow('sheet-inputs'));
    expect(result.current.creatingAxes['sheet-inputs'].rows).toHaveLength(1);

    await act(async () => {
      rowAppend.reject(new Error('append failed'));
      await rowAppend.promise.catch(() => undefined);
    });

    await waitFor(() => {
      expect(result.current.creatingAxes['sheet-inputs']).toBeUndefined();
      expect(result.current.saveStatus).toBe('failed');
    });
    expect(sheetBounds(findSheetById(result.current.workbook, 'sheet-inputs')!)).toEqual({
      rowCount: 20,
      columnCount: 10,
    });
  });

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
