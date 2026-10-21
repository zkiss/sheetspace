import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DataModel, Workbook } from '@workbook/core/model';
import { cellRawContent } from '@workbook/read/queries';
import { decodeCellTextLiteral, encodeCellTextLiteral } from '@workbook/core/cellLiteral';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import { decodeWorkbookBundle, encodeWorkbookBundle, WorkbookApiError } from '@infrastructure/persistence/workbookApi';
import { autosaveClient, deferred, persistedWorkbookClient } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';

const model: DataModel = { id: 'model', name: 'Invoice', columns: [
  { id: 'input', name: 'Input', kind: 'manual', type: 'float' },
  { id: 'output', name: 'Output', kind: 'calculated', type: 'float', formula: '=@A[1]*2' },
] };

function initialWorkbook(): Workbook {
  const first = sheetDocument({ id: 'one', name: 'One', rowCount: 2, columnCount: 3, cells: { A1: '3', A2: '5' } });
  const second = sheetDocument({ id: 'two', name: 'Two', rowCount: 1, columnCount: 1, cells: { A1: '7' } });
  const dependent = sheetDocument({ id: 'dependent', name: 'Dependent', rowCount: 1, columnCount: 1, cells: { A1: "=@'One'!A[1]+@'Two'!A[1]" } });
  return { ...workbookWithSheets([first, second, dependent]), dataModels: { model } };
}

function bind(workbook: Workbook, sheetId: string): Workbook {
  const result = bindSheetToModel(workbook, sheetId, model.id, () => `${sheetId}-new-column`);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe('model lifecycle controller wiring', () => {
  it('creates and persists an unbound model through the lifecycle boundary', async () => {
    const workbook = workbookWithSheets([sheetDocument({ id: 'one', name: 'One' })]);
    const api = persistedWorkbookClient(workbook);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    const declaration: DataModel = { id: 'new-model', name: 'New model', columns: [
      { id: 'manual', name: 'Manual', kind: 'manual', type: 'string' },
      { id: 'calculated', name: 'Calculated', kind: 'calculated', type: 'float', formula: '=1' },
    ] };

    act(() => expect(result.current.commands.addDataModel(declaration).result).toEqual({
      ok: true, value: expect.objectContaining({ dataModels: { 'new-model': declaration } }),
    }));

    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(api.saveModelLifecycle).toHaveBeenCalledTimes(1);
    expect((await api.loadWorkbook()).dataModels).toEqual({ 'new-model': declaration });
  });

  it('rolls back rejected model declarations so retries and later declarations use the prior workbook', async () => {
    const workbook = workbookWithSheets([sheetDocument({ id: 'one', name: 'One' })]);
    const api = autosaveClient({
      saveModelLifecycle: vi.fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockImplementation(async (_before, after) => after),
    });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    const declaration: DataModel = { id: 'new-model', name: 'New model', columns: [
      { id: 'manual', name: 'Manual', kind: 'manual', type: 'string' },
    ] };
    let submission: ReturnType<typeof result.current.commands.addDataModel>;
    act(() => { submission = result.current.commands.addDataModel(declaration); });
    expect(submission!.result.ok).toBe(true);
    await expect(submission!.completion).resolves.toEqual({ ok: false, reason: 'persistence-failed' });
    await waitFor(() => expect(result.current.canRetryFailedSaves).toBe(false));
    await waitFor(() => expect(result.current.workbook.dataModels).toBeUndefined());
    let retry: ReturnType<typeof result.current.commands.addDataModel>;
    act(() => { retry = result.current.commands.addDataModel(declaration); });
    await expect(retry!.completion).resolves.toMatchObject({ ok: true });
    expect(result.current.workbook.dataModels).toEqual({ 'new-model': declaration });
  });

  it('restores a rejected edit before a subsequent model operation', async () => {
    const workbook = { ...workbookWithSheets([sheetDocument({ id: 'one', name: 'One' })]), dataModels: { model } };
    const api = autosaveClient({
      saveModelLifecycle: vi.fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockImplementation(async (_before, after) => after),
    });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    const rejected = { ...model, name: 'Rejected name' };
    let failed: ReturnType<typeof result.current.commands.replaceModelDeclaration>;
    act(() => { failed = result.current.commands.replaceModelDeclaration(rejected); });
    await expect(failed!.completion).resolves.toEqual({ ok: false, reason: 'persistence-failed' });
    await waitFor(() => expect(result.current.workbook.dataModels).toEqual({ model }));

    const later = { ...model, name: 'Saved name' };
    let replacement: ReturnType<typeof result.current.commands.replaceModelDeclaration>;
    act(() => { replacement = result.current.commands.replaceModelDeclaration(later); });
    await expect(replacement!.completion).resolves.toMatchObject({ ok: true });
    expect(vi.mocked(api.saveModelLifecycle).mock.calls[1]?.[0].dataModels).toEqual({ model });
    expect(result.current.workbook.dataModels).toEqual({ model: later });
  });

  it('updates differently sized instances, external dependencies and history through one declaration boundary', async () => {
    const workbook = bind(bind(initialWorkbook(), 'one'), 'two');
    const api = persistedWorkbookClient(workbook);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => result.current.commands.updateCellContent('one', 'A1', '4'));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(result.current.canRedo).toBe(true);
    expect(result.current.contentHistoryFeedback).toBeDefined();

    act(() => result.current.commands.replaceModelDeclaration({ ...model, columns: [
      { ...model.columns[1]!, name: 'Renamed output' }, { ...model.columns[0]!, name: 'Renamed input' },
    ] }));

    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(api.saveModelLifecycle).toHaveBeenCalledTimes(1);
    expect(result.current.formulaResults.one.A1?.display).toBe('6');
    expect(result.current.formulaResults.two.A1?.display).toBe('14');
    expect(result.current.formulaResults.dependent.A1?.display).toBe('10');
    expect(cellRawContent(result.current.workbook.documents.one!, 'B1')).toBe('3');
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.contentHistoryFeedback).toBeUndefined();
    const reloaded = decodeWorkbookBundle(JSON.parse(JSON.stringify(encodeWorkbookBundle(await api.loadWorkbook()))));
    expect(reloaded.documents.one!.modelFormulaBindings).toEqual(result.current.workbook.documents.one!.modelFormulaBindings);
    expect(reloaded.documents.two!.content.columns).toEqual(result.current.workbook.documents.two!.content.columns);
  });

  it('orders queued content and presentation before materialization, and newer edits after it', async () => {
    const workbook = bind(initialWorkbook(), 'one');
    const oldSave = deferred<{ sheets: { sheetId: string; revision: number }[] }>();
    const atomicSave = deferred<Workbook>();
    const calls: string[] = [];
    const api = autosaveClient({
      writeCells: vi.fn().mockImplementationOnce(() => { calls.push('old'); return oldSave.promise; }).mockImplementation(async () => { calls.push('new'); return { sheets: [{ sheetId: 'one', revision: 4 }] }; }),
      updateSheetPosition: vi.fn().mockImplementation(async () => { calls.push('frame'); return { sheetId: 'one', revision: 2 }; }),
      saveModelLifecycle: vi.fn().mockImplementation(() => { calls.push('atomic'); return atomicSave.promise; }),
    });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => {
      result.current.commands.updateCellContent('one', 'A1', '9');
      result.current.commands.moveSheetFrame('one', { x: 1, y: 2 });
      result.current.commands.unbindSheetFromModel('one');
      result.current.commands.moveSheetFrame('one', { x: 3, y: 4 });
      result.current.commands.updateCellContent('one', 'A1', '10');
      result.current.commands.undo();
    });
    expect(calls).toEqual(['old']);
    expect(cellRawContent(result.current.workbook.documents.one!, 'B1')).toBe('18');
    await act(async () => oldSave.resolve({ sheets: [{ sheetId: 'one', revision: 1 }] }));
    await waitFor(() => expect(calls).toEqual(['old', 'frame', 'atomic']));
    const snapshot = vi.mocked(api.saveModelLifecycle).mock.calls[0][1];
    expect(snapshot.documents.one!.frame.position).toEqual({ x: 1, y: 2 });
    expect(cellRawContent(snapshot.documents.one!, 'A1')).toBe('9');
    await act(async () => atomicSave.resolve(snapshot));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(calls).toEqual(['old', 'frame', 'atomic', 'frame', 'new']);
    expect(cellRawContent(result.current.workbook.documents.one!, 'A1')).toBe('10');
    expect(cellRawContent(result.current.workbook.documents.one!, 'B1')).toBe('18');
    expect(result.current.workbook.documents.one!.frame.position).toEqual({ x: 3, y: 4 });
  });

  it('retains failed structural snapshots for exact retry instead of rebasing stale structure on conflict', async () => {
    const save = vi.fn().mockRejectedValueOnce(new WorkbookApiError('conflict', 409, 'model-lifecycle-conflict')).mockImplementation(async (_before: Workbook, after: Workbook) => after);
    const api = autosaveClient({ saveModelLifecycle: save });
    const workbook = initialWorkbook();
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => result.current.commands.bindSheetToModel('one', 'model'));
    await waitFor(() => expect(result.current.canRetryFailedSaves).toBe(true));
    expect(api.loadSheet).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    act(() => {
      result.current.commands.updateCellContent('one', 'A1', '12');
      result.current.commands.retryFailedSaves();
    });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
    expect(api.writeCells).toHaveBeenCalledTimes(1);
    expect(result.current.canUndo).toBe(false);
  });

  it('appends declaration formulas to empty bound sheets, reloads and leaves changed-to-manual appends empty', async () => {
    const empty = sheetDocument({ id: 'empty', name: 'Empty', rowCount: 0, columnCount: 1 });
    const workbook = bind({ ...workbookWithSheets([empty]), dataModels: { model: { ...model, columns: [model.columns[0]!, { ...model.columns[1]!, kind: 'calculated', formula: '=SUM(@A[1])' }] } } }, 'empty');
    const api = persistedWorkbookClient(workbook);
    const first = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => { first.result.current.commands.appendRow('empty'); });
    await waitFor(() => expect(first.result.current.saveStatus).toBe('saved'));
    expect(first.result.current.workbook.documents.empty!.content.rows).toEqual(['empty:row:1']);
    expect(first.result.current.formulaResults.empty.B1?.display).toBe('0');
    const reloaded = await api.loadWorkbook();
    first.unmount();
    const second = renderHook(() => useWorkbookController({ initialWorkbook: reloaded, apiClient: api }));
    act(() => { second.result.current.commands.appendRow('empty'); });
    await waitFor(() => expect(second.result.current.saveStatus).toBe('saved'));
    expect(second.result.current.formulaResults.empty.B2?.display).toBe('0');
    act(() => second.result.current.commands.replaceModelDeclaration({ ...model, columns: [model.columns[0]!, { id: 'output', name: 'Output', kind: 'manual', type: 'float' }] }));
    await waitFor(() => expect(second.result.current.saveStatus).toBe('saved'));
    act(() => { second.result.current.commands.appendRow('empty'); });
    await waitFor(() => expect(second.result.current.saveStatus).toBe('saved'));
    expect(cellRawContent(second.result.current.workbook.documents.empty!, 'B2')).toBe('0');
    expect(cellRawContent(second.result.current.workbook.documents.empty!, 'B3')).toBeUndefined();
  });

  it('preserves history for no-ops and rejected commands and freezes literal text and errors on unbind', () => {
    const workbook = initialWorkbook();
    workbook.dataModels = { model: { ...model, columns: [model.columns[0]!, { ...model.columns[1]!, kind: 'calculated', formula: '="=literal"' }] } };
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook }));
    act(() => result.current.commands.updateCellContent('one', 'A1', '8'));
    expect(result.current.canUndo).toBe(true);
    act(() => {
      expect(result.current.commands.bindSheetToModel('missing', 'model')).toEqual({ ok: false, reason: 'unknown-sheet' });
      result.current.commands.unbindSheetFromModel('one');
    });
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.commands.bindSheetToModel('one', 'model'));
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.commands.updateCellContent('one', 'A1', '9'));
    act(() => result.current.commands.bindSheetToModel('one', 'model'));
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.commands.unbindSheetFromModel('one'));
    expect(decodeCellTextLiteral(cellRawContent(result.current.workbook.documents.one!, 'B1')!)).toBe('=literal');
    expect(result.current.formulaResults.one.B1).toBeUndefined();
    const envelope = encodeCellTextLiteral('user envelope');
    act(() => result.current.commands.updateCellContent('one', 'A1', envelope));
    expect(decodeCellTextLiteral(cellRawContent(result.current.workbook.documents.one!, 'A1')!)).toBe(envelope);
  });

  it('rejects lifecycle changes while an axis request is unsettled without invalidating history', async () => {
    const append = deferred<{ sheetId: string; revision: number; rowCount: number; rowId: string }>();
    const api = autosaveClient({ appendRow: () => append.promise });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initialWorkbook(), apiClient: api }));
    act(() => result.current.commands.updateCellContent('one', 'A1', '8'));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    act(() => { result.current.commands.appendRow('one'); });
    act(() => expect(result.current.commands.bindSheetToModel('one', 'model')).toEqual({ ok: false, reason: 'pending-axis-creation' }));
    expect(result.current.canUndo).toBe(true);
    await act(async () => append.resolve({ sheetId: 'one', revision: 1, rowCount: 3, rowId: 'server-row' }));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(result.current.workbook.documents.one!.modelId).toBeUndefined();
  });

  it('holds new sheet and axis requests behind a pending structural save without dropping them', async () => {
    const save = deferred<Workbook>();
    const workbook = bind(initialWorkbook(), 'one');
    const api = autosaveClient({
      saveModelLifecycle: () => save.promise,
      createSheet: vi.fn().mockResolvedValue(sheetDocument({ id: 'new', name: 'New' })),
    });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => {
      result.current.commands.unbindSheetFromModel('one');
      expect(result.current.commands.bindSheetToModel('two', 'model')).toEqual({ ok: false, reason: 'pending-model-transition' });
      result.current.commands.appendRow('one');
      result.current.commands.createSheet('New', { x: 0, y: 0 });
    });
    expect(api.appendRow).not.toHaveBeenCalled();
    expect(api.createSheet).not.toHaveBeenCalled();
    await act(async () => save.resolve(result.current.workbook));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(api.appendRow).toHaveBeenCalledTimes(1);
    expect(api.createSheet).toHaveBeenCalledTimes(1);
    expect(result.current.workbook.documents.one!.content.rows.slice(-1)[0]).toBe('row-appended');
    expect(result.current.workbook.documents.new).toBeDefined();
    expect(cellRawContent(result.current.workbook.documents.one!, 'B1')).toBe('6');
  });

  it('rejects structural changes after a same-turn sheet creation and preserves the pending sheet', async () => {
    const creation = deferred<ReturnType<typeof sheetDocument>>();
    const api = autosaveClient({ createSheet: () => creation.promise });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initialWorkbook(), apiClient: api }));
    act(() => {
      result.current.commands.createSheet('New', { x: 0, y: 0 });
      expect(result.current.commands.bindSheetToModel('one', 'model')).toEqual({ ok: false, reason: 'pending-sheet-creation' });
    });
    await act(async () => creation.resolve(sheetDocument({ id: 'new', name: 'New' })));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(result.current.workbook.documents.new).toBeDefined();
  });
});
