import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DataModel, Workbook } from '@workbook/core/model';
import { cellRawContent } from '@workbook/read/queries';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import { WorkbookApiError } from '@infrastructure/persistence/workbookApi';
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
  it('rejects invalid drafts without dispatch and protects unfinished input from unbinding', async () => {
    const workbook = boundWorkbook();
    const api = persistedWorkbookClient(workbook);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));

    act(() => result.current.commands.changeEntryField('sheet', 'input', 'not a number'));
    let submission: Awaited<ReturnType<typeof result.current.commands.submitEntryDraft>>;
    await act(async () => { submission = await result.current.commands.submitEntryDraft('sheet'); });

    expect(submission!.firstInvalid).toBe('input');
    expect(api.admitRecord).not.toHaveBeenCalled();
    act(() => { expect(result.current.commands.unbindSheetFromModel('sheet').result).toMatchObject({ ok: false }); });
    expect(result.current.entrySessions.sheet!.draft.fields.input!.raw).toBe('not a number');
    expect(result.current.workbook.documents.sheet!.content.rows).toHaveLength(1);
  });

  it('does not dispatch incomplete, erroneous or type-incompatible formulas', async () => {
    const workbook = boundWorkbook();
    const api = persistedWorkbookClient(workbook);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    for (const raw of ['=', '=1+', '=1/0', '="text"']) {
      act(() => result.current.commands.changeEntryField('sheet', 'input', raw));
      await act(async () => expect(await result.current.commands.submitEntryDraft('sheet')).toMatchObject({ firstInvalid: 'input' }));
    }
    expect(api.admitRecord).not.toHaveBeenCalled();
  });

  it('retries an ambiguous admission with the same identity and reconciles only on success', async () => {
    const workbook = boundWorkbook();
    const api = persistedWorkbookClient(workbook);
    api.admitRecord.mockRejectedValueOnce(new Error('connection lost')).mockImplementationOnce(async (_sheetId, rowId) => ({
      rowId,
      sheet: { ...workbook.documents.sheet!, revision: workbook.documents.sheet!.revision + 1,
        content: { ...workbook.documents.sheet!.content, rows: [...workbook.documents.sheet!.content.rows, rowId] } },
    }));
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => result.current.commands.changeEntryField('sheet', 'input', '5'));

    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
    expect(result.current.workbook.documents.sheet!.content.rows).toHaveLength(1);
    expect(result.current.entrySessions.sheet).toMatchObject({ retryRequired: true, failure: 'connection lost' });
    act(() => result.current.commands.changeEntryField('sheet', 'input', '8'));
    expect(result.current.entrySessions.sheet!.draft.fields.input!.raw).toBe('5');

    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
    expect(api.admitRecord).toHaveBeenCalledTimes(2);
    expect(api.admitRecord.mock.calls[1]).toEqual(api.admitRecord.mock.calls[0]);
    expect(result.current.workbook.documents.sheet!.content.rows).toHaveLength(2);
    expect(result.current.entrySessions.sheet!.draft.fields.input!.raw).toBe('');
  });
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
    act(() => result.current.commands.undo());
    expect(cellRawContent(result.current.workbook.documents.other!, 'A1')).toBeUndefined();
    act(() => result.current.commands.redo());
    expect(cellRawContent(result.current.workbook.documents.other!, 'A1')).toBe('9');
    await act(async () => { reject(new Error('connection lost')); await submission; });
    expect(result.current.entrySessions.sheet).toMatchObject({ retryRequired: true, failure: 'connection lost' });
    expect(cellRawContent(result.current.workbook.documents.other!, 'A1')).toBe('9');
    act(() => result.current.commands.undo());
    expect(cellRawContent(result.current.workbook.documents.other!, 'A1')).toBeUndefined();
    act(() => result.current.commands.redo());
    expect(cellRawContent(result.current.workbook.documents.other!, 'A1')).toBe('9');
  });
  it('waits for a preceding cell save before capturing the admission revision', async () => {
    const workbook = boundWorkbook();
    const api = persistedWorkbookClient(workbook);
    const write = api.writeCells.getMockImplementation()!;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    api.writeCells.mockImplementationOnce(async (...args) => {
      await held;
      const response = await write(...args);
      return { sheets: response.sheets.map((sheet: { sheetId: string; revision: number }) => ({ ...sheet, revision: sheet.revision + 1 })) };
    });
    api.admitRecord.mockImplementationOnce(async (_sheetId, rowId) => {
      const saved = await api.loadWorkbook();
      const sheet = saved.documents.sheet!;
      return { rowId, sheet: { ...sheet, revision: sheet.revision + 1, content: { ...sheet.content, rows: [...sheet.content.rows, rowId] } } };
    });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => { result.current.commands.updateCellContent('sheet', 'A1', '8'); });
    await waitFor(() => expect(api.writeCells).toHaveBeenCalledTimes(1));
    act(() => result.current.commands.changeEntryField('sheet', 'input', '5'));
    let submission!: Promise<unknown>;
    act(() => { submission = result.current.commands.submitEntryDraft('sheet'); });
    expect(api.admitRecord).not.toHaveBeenCalled();
    await act(async () => { release(); await submission; });
    expect(api.admitRecord).toHaveBeenCalledWith('sheet', expect.any(String), expect.anything(), workbook.documents.sheet!.revision + 1);
    expect(cellRawContent(result.current.workbook.documents.sheet!, 'A1')).toBe('8');
    expect(result.current.workbook.documents.sheet!.content.rows).toHaveLength(2);
  });
  it('persists the two-sheet model workflow through editing, reload, and unbind', async () => {
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
    expect(result.current.workbook.documents.first!.content.rows).toHaveLength(1);
    expect(api.appendRow).not.toHaveBeenCalled();
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

  it('rejects generic append on a bound sheet without persistence or partial rows', async () => {
    const workbook = boundWorkbook();
    const api = persistedWorkbookClient(workbook);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));

    act(() => { result.current.commands.appendRow('sheet'); });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));

    expect(api.appendRow).not.toHaveBeenCalled();
    expect(api.writeCells).not.toHaveBeenCalled();
    expect(result.current.workbook).toEqual(workbook);
    expect(await api.loadWorkbook()).toEqual(workbook);
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
