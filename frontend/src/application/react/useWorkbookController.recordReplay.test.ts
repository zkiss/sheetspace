import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DataModel, Workbook } from '@workbook/core/model';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import { persistedWorkbookClient } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';
import { WorkbookApiError, workbookApi } from '@infrastructure/persistence/workbookApi';

function fixture(loseFirstReplay = false, sorting = true) {
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
    sheet: { ...target, sorting: sorting ? [{ columnId: target.modelColumnBindings!.output!, direction: 'ascending' }] : undefined },
    other: { ...dependent, sorting: sorting ? [{ columnId: dependent.content.columns[0]!, direction: 'ascending' }] : undefined, content: { ...dependent.content, rows: [...dependent.content.rows].reverse(), cells: { ...dependent.content.cells, [cellIdentityKey({ rowId: dependent.content.rows[0]!, columnId: dependent.content.columns[0]! })]: prepareUserFormula('=@Sheet!A[#2]', bound.value, 'other') } } },
  } };
  const api = persistedWorkbookClient(initial);
  const admit = api.admitRecord.getMockImplementation()!;
  let current = initial;
  api.saveModelLifecycle.mockImplementation(async (_before, after) => { current = after; return current; });
  let admitted: Workbook;
  let revision = 1;
  const receipts = new Map<string, { sheetId: string; rowId: string; request: Parameters<typeof api.replayRecord>[2]; workbook: Workbook }>();
  let admittedIdentity: { sheetId: string; rowId: string };
  api.loadWorkbook.mockImplementation(async () => current);
  api.writeCells.mockImplementation(async (expected, cells) => {
    for (const cell of cells) {
      const sheet = current.documents[cell.sheetId]!;
      const nextCells = { ...sheet.content.cells, [cellIdentityKey(cell)]: cell.raw };
      current = { ...current, documents: { ...current.documents, [cell.sheetId]: { ...sheet, content: { ...sheet.content, cells: nextCells } } } };
    }
    return { sheets: expected.map(({ sheetId }: { sheetId: string }) => ({ sheetId, revision: current.documents[sheetId]!.revision })) };
  });
  api.deleteSheet.mockImplementation(async (sheetId) => {
    const { [sheetId]: removed, ...documents } = current.documents;
    void removed;
    current = { ...current, manifest: { ...current.manifest, sheetIds: current.manifest.sheetIds.filter((id) => id !== sheetId) }, documents };
  });
  api.admitRecord.mockImplementation(async (...args) => {
    const response = await admit(...args);
    admittedIdentity = { sheetId: args[0], rowId: args[1].rowId };
    admitted = response.workbook;
    current = admitted;
    return { ...response, workbook: current };
  });
  api.replayRecord.mockImplementation(async (sheetId, rowId, request) => {
    expect({ sheetId, rowId }).toEqual(admittedIdentity);
    const receipt = receipts.get(request.operationId);
    if (receipt) {
      expect({ sheetId, rowId, request }).toEqual({ sheetId: receipt.sheetId, rowId: receipt.rowId, request: receipt.request });
      return { operationId: request.operationId, rowId, alreadyCommitted: true, workbook: current };
    }
    const endpoint = request.direction === 'undo' ? initial : admitted;
    revision++;
    current = { ...endpoint, documents: Object.fromEntries(Object.entries(endpoint.documents).map(([id, document]) => [id, { ...document, revision }])) };
    receipts.set(request.operationId, { sheetId, rowId, request: structuredClone(request), workbook: current });
    if (loseFirstReplay) {
      loseFirstReplay = false;
      throw new Error('connection lost after commit');
    }
    return { operationId: request.operationId, rowId, alreadyCommitted: false, workbook: current };
  });
  return { api, initial, loseNext: () => { loseFirstReplay = true; } };
}

async function submit(result: { current: ReturnType<typeof useWorkbookController> }) {
  act(() => result.current.commands.changeEntryField('sheet', 'input', '1'));
  await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
}

async function replay(result: { current: ReturnType<typeof useWorkbookController> }, direction: 'undo' | 'redo', expected: string[]) {
  act(() => result.current.commands[direction]());
  await waitFor(() => expect(result.current.workbook.documents.sheet!.content.rows).toEqual(expected));
}

function assertEndpoint(result: { current: ReturnType<typeof useWorkbookController> }, initial: Workbook, rowId: string, admitted: boolean) {
  const target = initial.documents.sheet!;
  const dependent = initial.documents.other!;
  const input = target.modelColumnBindings!.input!;
  const output = target.modelColumnBindings!.output!;
  const inputKey = cellIdentityKey({ rowId, columnId: input });
  const outputKey = cellIdentityKey({ rowId, columnId: output });
  const cells = admitted ? { ...target.content.cells, [inputKey]: '1', [outputKey]: `=SUM(@${input}[${rowId}])` } : target.content.cells;
  expect(result.current.workbook.documents.sheet!.content).toEqual({
    ...target.content, rows: admitted ? [rowId, ...target.content.rows] : target.content.rows, cells,
  });
  expect(result.current.workbook.documents.other!.content).toEqual({
    ...dependent.content, rows: admitted ? [...dependent.content.rows].reverse() : dependent.content.rows,
  });
  if (!admitted) {
    expect(Object.prototype.hasOwnProperty.call(result.current.workbook.documents.sheet!.content.cells, inputKey)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result.current.workbook.documents.sheet!.content.cells, outputKey)).toBe(false);
  }
  expect(result.current.canUndo).toBe(admitted || result.current.recordReplay.unresolved);
  expect(result.current.canRedo).toBe(!admitted);
}

function assertNoSubstituteWrites(api: ReturnType<typeof persistedWorkbookClient>) {
  expect(api.admitRecord).toHaveBeenCalledOnce();
  expect(api.writeCells).not.toHaveBeenCalled();
  expect(api.saveModelLifecycle).not.toHaveBeenCalled();
  expect(api.writeSorting).not.toHaveBeenCalled();
  expect(api.writeAxisOrder).not.toHaveBeenCalled();
}

describe('persisted record replay integration', () => {
  it.each([
    [404, { error: 'sheet-not-found', sheetId: 'other' }, /sheet-not-found \(sheet other\)/],
    [404, { error: 'sheet-not-found', sheetId: 'sheet' }, /sheet-not-found \(sheet sheet\)/],
    [409, { error: 'sheet-revision-conflict', sheetId: 'other', expectedRevision: 1, actualRevision: 2 }, /sheet other, expected revision 1, actual revision 2/],
    [409, { error: 'model-lifecycle-conflict', scope: 'workbook' }, /model-lifecycle-conflict \(scope workbook\)/],
  ])('publishes contextual HTTP replay failure %s %j', async (status, body, message) => {
    const { api, initial } = fixture();
    api.replayRecord.mockImplementation(workbookApi.replayRecord);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, json: async () => body }));
    try {
      const { result, unmount } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
      await submit(result);
      act(() => result.current.commands.undo());
      await waitFor(() => expect(result.current.recordReplay.error).toMatch(message));
      expect(result.current.recordReplay.unresolved).toBe(false);
      expect(result.current.canUndo).toBe(true);
      unmount();
    } finally { vi.unstubAllGlobals(); }
  });

  it('adopts exact authoritative endpoints through an admission and three history moves', async () => {
    const { api, initial } = fixture();
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
    expect(result.current.workbook.documents.sheet!.content).toEqual(initial.documents.sheet!.content);
    expect(result.current.workbook.documents.other!.content).toEqual(initial.documents.other!.content);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    await submit(result);
    const admitted = result.current.workbook;
    const rowId = api.admitRecord.mock.calls[0]![1].rowId;
    const request = api.admitRecord.mock.calls[0]![1];
    const bindings = initial.documents.sheet!.modelColumnBindings!;
    expect(Object.prototype.hasOwnProperty.call(initial.documents.sheet!.content.cells, cellIdentityKey({ rowId, columnId: bindings.input! }))).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(initial.documents.sheet!.content.cells, cellIdentityKey({ rowId, columnId: bindings.output! }))).toBe(false);
    assertEndpoint(result, initial, rowId, true);
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

    await replay(result, 'undo', initial.documents.sheet!.content.rows);
    assertEndpoint(result, initial, rowId, false);
    await replay(result, 'redo', admitted.documents.sheet!.content.rows);
    assertEndpoint(result, initial, rowId, true);
    await replay(result, 'undo', initial.documents.sheet!.content.rows);
    assertEndpoint(result, initial, rowId, false);
    const requests = api.replayRecord.mock.calls.map((call) => call[2]);
    expect(api.replayRecord.mock.calls.map(([sheetId, replayRowId]) => [sheetId, replayRowId])).toEqual([
      ['sheet', rowId], ['sheet', rowId], ['sheet', rowId],
    ]);
    expect(requests.map((request) => request.direction)).toEqual(['undo', 'redo', 'undo']);
    expect(new Set(requests.map((request) => request.operationId)).size).toBe(3);
    assertNoSubstituteWrites(api);
  });

  it('retries an ambiguous replay with the same frozen request and releases the fence', async () => {
    const { api, initial } = fixture(true);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
    await submit(result);
    const rowId = api.admitRecord.mock.calls[0]![1].rowId;
    const admittedRows = result.current.workbook.documents.sheet!.content.rows;
    assertEndpoint(result, initial, rowId, true);
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.recordReplay.error).toBeDefined());
    assertEndpoint(result, initial, rowId, true);
    await replay(result, 'undo', initial.documents.sheet!.content.rows);
    expect(api.replayRecord.mock.calls[1]).toEqual(api.replayRecord.mock.calls[0]);
    await expect(api.replayRecord.mock.results[1]!.value).resolves.toMatchObject({ alreadyCommitted: true });
    assertEndpoint(result, initial, rowId, false);
    await replay(result, 'redo', admittedRows);
    assertEndpoint(result, initial, rowId, true);
    expect(api.replayRecord).toHaveBeenCalledTimes(3);
    const [first, , third] = api.replayRecord.mock.calls;
    expect(third!.slice(0, 2)).toEqual(['sheet', rowId]);
    expect(third![2].direction).toBe('redo');
    expect(third![2].operationId).not.toBe(first![2].operationId);
    assertNoSubstituteWrites(api);
  });

  it('confirms a retained receipt before an intervening history entry', async () => {
    const { api, initial } = fixture(true, false);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
    await submit(result);
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.recordReplay.unresolved).toBe(true));
    act(() => { result.current.commands.updateCellContent('other', 'A1', '42'); });
    await waitFor(() => expect(api.writeCells).toHaveBeenCalled());
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.recordReplay.unresolved).toBe(false));
    expect(result.current.recordReplay.error).toMatch(/history position changed/i);
    expect(api.replayRecord.mock.calls[1]).toEqual(api.replayRecord.mock.calls[0]);
    expect(result.current.canUndo).toBe(true);
    const other = result.current.workbook.documents.other!;
    const savedCell = api.writeCells.mock.calls.flatMap(([, cells]) => cells).find((cell) => cell.raw === '42')!;
    expect(other.content.cells[cellIdentityKey(savedCell)]).toBe('42');
    expect(other.content.rows).toEqual(initial.documents.other!.content.rows);
    expect(result.current.workbook.documents.sheet!.content.rows).toEqual(initial.documents.sheet!.content.rows);
  });

  it('fences sorted aggregate edits until an ambiguous record receipt is confirmed', async () => {
    const { api, initial } = fixture(true);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
    await submit(result);
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.recordReplay.unresolved).toBe(true));
    act(() => expect(result.current.commands.updateCellContent('other', 'A1', '42')).toEqual({ ok: false, reason: 'pending-model-transition' }));
    expect(api.saveModelLifecycle).not.toHaveBeenCalled();
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.recordReplay.unresolved).toBe(false));
  });

  it('confirms a lost redo after an edit invalidates redo without restoring the old cursor', async () => {
    const { api, initial, loseNext } = fixture(false, false);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
    await submit(result);
    await replay(result, 'undo', initial.documents.sheet!.content.rows);
    loseNext();
    act(() => result.current.commands.redo());
    await waitFor(() => expect(result.current.recordReplay.unresolved).toBe(true));
    act(() => { result.current.commands.updateCellContent('other', 'A1', '42'); });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(result.current.canRedo).toBe(false);
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.recordReplay.unresolved).toBe(false));
    expect(result.current.recordReplay.error).toMatch(/history position changed/i);
    expect(api.replayRecord.mock.calls[2]).toEqual(api.replayRecord.mock.calls[1]);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.canUndo).toBe(true);
  });

  it('confirms a receipt after the target sheet is deleted without resurrecting it', async () => {
    const { api, initial } = fixture(true);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
    await submit(result);
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.recordReplay.unresolved).toBe(true));
    act(() => { result.current.commands.deleteSheet('sheet'); });
    await waitFor(() => expect(api.deleteSheet).toHaveBeenCalled());
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.recordReplay.unresolved).toBe(false));
    expect(api.replayRecord.mock.calls[1]).toEqual(api.replayRecord.mock.calls[0]);
    expect(result.current.workbook.documents.sheet).toBeUndefined();
  });

  it('retains an uncommitted request through failed reconciliation and retires it after refresh', async () => {
    const { api, initial } = fixture();
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
    await submit(result);
    api.replayRecord.mockRejectedValueOnce(new Error('connection lost before commit'));
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.recordReplay.unresolved).toBe(true));
    act(() => { result.current.commands.updateCellContent('other', 'A1', '42'); });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    const conflict = new WorkbookApiError('Revision conflict', 409, 'sheet-revision-conflict', { sheetId: 'other', expectedRevision: 1, actualRevision: 2 });
    api.replayRecord.mockRejectedValueOnce(conflict).mockRejectedValueOnce(conflict);
    api.loadWorkbook.mockRejectedValueOnce(new Error('offline'));
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.recordReplay.error).toMatch(/could not be reloaded/i));
    expect(result.current.recordReplay.error).toMatch(/sheet other, expected revision 1, actual revision 2/);
    expect(result.current.recordReplay.unresolved).toBe(true);
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.recordReplay.unresolved).toBe(false));
    expect(result.current.recordReplay.error).toMatch(/Revision conflict/);
    expect(api.replayRecord.mock.calls[1]).toEqual(api.replayRecord.mock.calls[0]);
    expect(api.replayRecord.mock.calls[2]).toEqual(api.replayRecord.mock.calls[0]);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });
});
