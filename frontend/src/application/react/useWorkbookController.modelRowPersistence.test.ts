import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DataModel, Workbook } from '@workbook/core/model';
import { cellRawContent } from '@workbook/read/queries';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import { decodeWorkbookBundle, encodeWorkbookBundle, WorkbookApiError } from '@infrastructure/persistence/workbookApi';
import { persistedWorkbookClient } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';

const model: DataModel = { id: 'model', name: 'Model', columns: [
  { id: 'input', name: 'Input', kind: 'manual', type: 'float' },
  { id: 'output', name: 'Output', kind: 'calculated', type: 'float', formula: '=SUM(@A[1])' },
] };

/** A sheet bound through the lifecycle route, with its templates and derived contents. */
function boundWorkbook(): Workbook {
  const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2, cells: { A1: '3' } });
  const workbook: Workbook = { ...workbookWithSheets([sheet]), dataModels: { model } };
  const bound = bindSheetToModel(workbook, sheet.id, model.id, () => 'unused');
  if (!bound.ok) throw new Error(bound.reason);
  return bound.value;
}

describe('calculated row persistence', () => {
  it('admits complete records locally without persistence and starts a fresh draft', async () => {
    const workbook = boundWorkbook();
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook }));

    act(() => result.current.commands.changeEntryField('sheet', 'input', '5'));
    expect(result.current.workbook.documents.sheet!.content.rows).toHaveLength(1);
    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });

    const local = result.current.workbook;
    expect(local.documents.sheet!.content.rows).toHaveLength(2);
    expect(cellRawContent(local.documents.sheet!, 'A2')).toBe('5');
    expect(projectStoredFormula(cellRawContent(local.documents.sheet!, 'B2')!, local, 'sheet').text).toBe('=SUM(@A[2])');
    expect(result.current.entrySessions.sheet!.draft.fields.input!.raw).toBe('');
  });
  it('protects the admitting sheet while allowing edits to another sheet', async () => {
    const bound = boundWorkbook();
    const other = sheetDocument({ id: 'other', name: 'Other', rowCount: 1, columnCount: 1 });
    const workbook = { ...bound, manifest: { ...bound.manifest, sheetIds: [...bound.manifest.sheetIds, other.id] }, documents: { ...bound.documents, other } };
    const api = persistedWorkbookClient(workbook);
    let reject!: (error: Error) => void;
    api.admitRecord.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => result.current.commands.changeEntryField('sheet', 'input', '5'));
    let submission!: Promise<unknown>;
    act(() => { submission = result.current.commands.submitEntryDraft('sheet'); });
    await waitFor(() => expect(api.admitRecord).toHaveBeenCalledTimes(1));
    act(() => {
      expect(result.current.commands.updateCellContent('sheet', 'A1', '8')).toMatchObject({ ok: false });
      expect(result.current.commands.updateCellContent('other', 'A1', '9')).toMatchObject({ ok: true });
      expect(result.current.commands.deleteSheet('sheet')).toMatchObject({ ok: false });
    });
    await act(async () => { reject(new Error('connection lost')); await submission; });
    expect(result.current.entrySessions.sheet).toMatchObject({ retryRequired: true, failure: 'connection lost' });
    expect(cellRawContent(result.current.workbook.documents.other!, 'A1')).toBe('9');
  });
  it('persists the two-sheet model workflow through editing, reload, append, and unbind', async () => {
    const first = sheetDocument({ id: 'first', name: 'First', rowCount: 1, columnCount: 2, cells: { A1: '3' }, presentation: { rowHeights: { 'first:row:1': 31 }, columnWidths: {} } });
    const second = sheetDocument({ id: 'second', name: 'Second', rowCount: 1, columnCount: 2, cells: { A1: '7' }, presentation: { rowHeights: {}, columnWidths: { 'second:column:1': 123 } } });
    const workflowModel: DataModel = { id: 'model', name: 'Model', columns: [
      { id: 'input', name: 'Input', kind: 'manual', type: 'float' },
      { id: 'output', name: 'Output', kind: 'calculated', type: 'float', formula: "=SUM(@'Input'[1])" },
    ] };
    const initial: Workbook = workbookWithSheets([first, second]);
    const api = persistedWorkbookClient(initial);
    const { result, unmount } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));

    let creation: ReturnType<typeof result.current.commands.addDataModel>;
    act(() => { creation = result.current.commands.addDataModel(workflowModel); });
    await expect(creation!.completion).resolves.toMatchObject({ ok: true });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));

    act(() => { result.current.commands.bindSheetToModel('first', 'model'); });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    act(() => { result.current.commands.bindSheetToModel('second', 'model'); });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    act(() => { result.current.commands.replaceModelDeclaration({
      ...workflowModel,
      name: 'Renamed model',
      columns: [
        { id: 'output', name: 'Total', kind: 'calculated', type: 'float', formula: "=SUM(@'Input'[1])" },
        { id: 'input', name: 'Input', kind: 'manual', type: 'float' },
      ],
    }); });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    act(() => { result.current.commands.appendRow('first'); });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));

    expect(cellRawContent(result.current.workbook.documents.first!, 'B1')).toBe('3');
    expect(cellRawContent(result.current.workbook.documents.second!, 'B1')).toBe('7');
    expect(projectStoredFormula(cellRawContent(result.current.workbook.documents.first!, 'A2')!, result.current.workbook, 'first').text).toMatch(/^=SUM\(/);
    expect(result.current.workbook.documents.first!.presentation.rowHeights['first:row:1']).toBe(31);
    expect(result.current.workbook.documents.second!.presentation.columnWidths['second:column:1']).toBe(123);
    unmount();

    const { result: reloaded } = renderHook(() => useWorkbookController({ apiClient: api }));
    await waitFor(() => expect(reloaded.current.startupLoad.status).toBe('loaded'));
    expect(reloaded.current.workbook.dataModels?.model?.name).toBe('Renamed model');
    expect(reloaded.current.workbook.documents.first!.modelId).toBe('model');
    expect(reloaded.current.workbook.documents.second!.modelId).toBe('model');
    act(() => { reloaded.current.commands.unbindSheetFromModel('first'); });
    await waitFor(() => expect(reloaded.current.saveStatus).toBe('saved'));
    expect(reloaded.current.workbook.documents.first!.modelId).toBeUndefined();
    expect(cellRawContent(reloaded.current.workbook.documents.first!, 'A1')).toBe('3');
    expect(reloaded.current.commands.updateCellContent('first', 'A1', '9')).toEqual({ ok: true, changed: true });
  });

  it('materializes an appended calculated row through the append route without an ordinary protected write', async () => {
    const workbook = boundWorkbook();
    const api = persistedWorkbookClient(workbook);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));

    act(() => { result.current.commands.appendRow('sheet'); });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));

    expect(api.appendRow).toHaveBeenCalledTimes(1);
    expect(api.writeCells).not.toHaveBeenCalled();
    const local = result.current.workbook;
    expect(projectStoredFormula(cellRawContent(local.documents.sheet!, 'B2')!, local, 'sheet').text).toBe('=SUM(@A[2])');
    expect(cellRawContent(local.documents.sheet!, 'A1')).toBe('3');
    const reloaded = decodeWorkbookBundle(JSON.parse(JSON.stringify(encodeWorkbookBundle(await api.loadWorkbook()))));
    expect(reloaded).toEqual(local);
  });

  it('persists the calculated bindings and derived contents atomically through the lifecycle route', async () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2, cells: { A1: '3' } });
    const workbook: Workbook = { ...workbookWithSheets([sheet]), dataModels: { model } };
    const api = persistedWorkbookClient(workbook);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));

    act(() => { result.current.commands.bindSheetToModel('sheet', 'model'); });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));

    expect(api.saveModelLifecycle).toHaveBeenCalledTimes(1);
    expect(api.writeCells).not.toHaveBeenCalled();
    const persisted = await api.loadWorkbook();
    expect(projectStoredFormula(persisted.documents.sheet!.modelFormulaBindings!.output.content, persisted, 'sheet').text).toBe('=SUM(@A[1])');
    expect(projectStoredFormula(cellRawContent(persisted.documents.sheet!, 'B1')!, persisted, 'sheet').text).toBe('=SUM(@A[1])');
    expect(persisted).toEqual(result.current.workbook);

    act(() => { result.current.commands.unbindSheetFromModel('sheet'); });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));

    const unbound = await api.loadWorkbook();
    expect(unbound.documents.sheet!.modelId).toBeUndefined();
    expect(unbound.documents.sheet!.modelFormulaBindings).toBeUndefined();
    expect(cellRawContent(unbound.documents.sheet!, 'B1')).toBe('3');
  });

  it('keeps an ordinary edit and its history when a save fails and retries it', async () => {
    const workbook = boundWorkbook();
    const api = persistedWorkbookClient(workbook);
    const write = api.writeCells.getMockImplementation()!;
    api.writeCells.mockRejectedValueOnce(new WorkbookApiError('invalid', 400, 'invalid-cell-patch')).mockImplementation(write);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));

    act(() => { result.current.commands.updateCellContent('sheet', 'A1', '8'); });
    await waitFor(() => expect(result.current.canRetryFailedSaves).toBe(true));

    expect(result.current.canUndo).toBe(true);
    expect((await api.loadWorkbook()).documents.sheet!.content.cells).toEqual(workbook.documents.sheet!.content.cells);

    act(() => { result.current.commands.retryFailedSaves(); });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));

    expect(result.current.canUndo).toBe(true);
    expect(await api.loadWorkbook()).toEqual(result.current.workbook);
  });
});
