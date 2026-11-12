import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DataModel, Workbook } from '@workbook/core/model';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import { persistedWorkbookClient } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';

function fixture(loseFirstReplay = false) {
  const model: DataModel = { id: 'model', name: 'Model', columns: [
    { id: 'input', name: 'Input', kind: 'manual', type: 'float' },
    { id: 'output', name: 'Output', kind: 'calculated', type: 'float', formula: '=SUM(@A[1])' },
  ] };
  const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2, cells: { A1: '3' } });
  const other = sheetDocument({ id: 'other', name: 'Other', rowCount: 2, columnCount: 1, cells: { A1: '=@Sheet!A[#2]', A2: '2' } });
  const bound = bindSheetToModel({ ...workbookWithSheets([sheet, other]), dataModels: { model } }, 'sheet', 'model', () => 'unused');
  if (!bound.ok) throw new Error(bound.reason);
  const target = bound.value.documents.sheet!;
  const dependent = bound.value.documents.other!;
  const initial: Workbook = { ...bound.value, documents: { ...bound.value.documents,
    sheet: { ...target, sorting: [{ columnId: target.modelColumnBindings!.output!, direction: 'ascending' }] },
    other: { ...dependent, sorting: [{ columnId: dependent.content.columns[0]!, direction: 'ascending' }], content: { ...dependent.content, rows: [...dependent.content.rows].reverse(), cells: { ...dependent.content.cells, [cellIdentityKey({ rowId: dependent.content.rows[0]!, columnId: dependent.content.columns[0]! })]: prepareUserFormula('=@Sheet!A[#2]', bound.value, 'other') } } },
  } };
  const api = persistedWorkbookClient(initial);
  const admit = api.admitRecord.getMockImplementation()!;
  let current = initial;
  let admitted: Workbook;
  let revision = 1;
  const receipts = new Map<string, Workbook>();
  api.loadWorkbook.mockImplementation(async () => current);
  api.admitRecord.mockImplementation(async (...args) => {
    const response = await admit(...args);
    admitted = response.workbook;
    current = admitted;
    return { ...response, workbook: current };
  });
  api.replayRecord.mockImplementation(async (_sheetId, rowId, request) => {
    const receipt = receipts.get(request.operationId);
    if (receipt) return { operationId: request.operationId, rowId, alreadyCommitted: true, workbook: receipt };
    const endpoint = request.direction === 'undo' ? initial : admitted;
    revision++;
    current = { ...endpoint, documents: Object.fromEntries(Object.entries(endpoint.documents).map(([id, document]) => [id, { ...document, revision }])) };
    receipts.set(request.operationId, current);
    if (loseFirstReplay) {
      loseFirstReplay = false;
      throw new Error('connection lost after commit');
    }
    return { operationId: request.operationId, rowId, alreadyCommitted: false, workbook: current };
  });
  return { api, initial };
}

async function submit(result: { current: ReturnType<typeof useWorkbookController> }) {
  act(() => result.current.commands.changeEntryField('sheet', 'input', '1'));
  await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
}

async function replay(result: { current: ReturnType<typeof useWorkbookController> }, direction: 'undo' | 'redo', expected: number) {
  act(() => result.current.commands[direction]());
  await waitFor(() => expect(result.current.workbook.documents.sheet!.content.rows).toHaveLength(expected));
}

describe('persisted record replay integration', () => {
  it('adopts exact authoritative endpoints through an admission and three history moves', async () => {
    const { api, initial } = fixture();
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
    await submit(result);
    const admitted = result.current.workbook;
    const rowId = api.admitRecord.mock.calls[0]![1].rowId;
    const request = api.admitRecord.mock.calls[0]![1];
    expect(request.before.documents.sheet!.content.rows).toEqual(initial.documents.sheet!.content.rows);
    expect(request.before.documents.other!.content.rows).toEqual(initial.documents.other!.content.rows);
    expect(request.rowOrders).toEqual([
      { sheetId: 'sheet', order: [rowId, initial.documents.sheet!.content.rows[0]] },
      { sheetId: 'other', order: [...initial.documents.other!.content.rows].reverse() },
    ]);
    expect(admitted.documents.sheet!.content.rows).toEqual([rowId, initial.documents.sheet!.content.rows[0]]);
    expect(admitted.documents.other!.content.rows).toEqual([...initial.documents.other!.content.rows].reverse());
    const admittedCells = admitted.documents.sheet!.content.cells;
    const output = admitted.documents.sheet!.modelColumnBindings!.output!;
    const formula = admittedCells[cellIdentityKey({ rowId, columnId: output })];
    const input = admitted.documents.sheet!.modelColumnBindings!.input!;
    expect(admittedCells[cellIdentityKey({ rowId, columnId: input })]).toBe('1');
    expect(formula).toBe(`=SUM(@${input}[${rowId}])`);
    expect(Object.keys(admittedCells).filter((key) => key.startsWith(`${rowId}\0`)).sort()).toEqual([
      cellIdentityKey({ rowId, columnId: input }), cellIdentityKey({ rowId, columnId: output }),
    ].sort());

    await replay(result, 'undo', 1);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
    expect(result.current.workbook.documents.other!.content.rows).toEqual(initial.documents.other!.content.rows);
    await replay(result, 'redo', 2);
    expect(result.current.workbook.documents.sheet!.content.cells).toEqual(admittedCells);
    expect(result.current.workbook.documents.sheet!.content.rows).toEqual(admitted.documents.sheet!.content.rows);
    expect(result.current.workbook.documents.other!.content.rows).toEqual(admitted.documents.other!.content.rows);
    await replay(result, 'undo', 1);
    expect(result.current.workbook.documents.other!.content.rows).toEqual(initial.documents.other!.content.rows);
    const requests = api.replayRecord.mock.calls.map((call) => call[2]);
    expect(requests.map((request) => request.direction)).toEqual(['undo', 'redo', 'undo']);
    expect(new Set(requests.map((request) => request.operationId)).size).toBe(3);
    expect(api.admitRecord).toHaveBeenCalledOnce();
    expect(api.writeCells).not.toHaveBeenCalled();
    expect(api.saveModelLifecycle).not.toHaveBeenCalled();
  });

  it('retries an ambiguous replay with the same frozen request and releases the fence', async () => {
    const { api, initial } = fixture(true);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
    await submit(result);
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.recordReplay.error).toBeDefined());
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.workbook.documents.sheet!.content.rows).toHaveLength(2);
    await replay(result, 'undo', 1);
    expect(api.replayRecord.mock.calls[1]).toEqual(api.replayRecord.mock.calls[0]);
    await expect(api.replayRecord.mock.results[1]!.value).resolves.toMatchObject({ alreadyCommitted: true });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
    await replay(result, 'redo', 2);
  });
});
