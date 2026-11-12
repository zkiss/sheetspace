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
  it('rejects admission during a same-turn startup retry until its load completes', async () => {
    const workbook = boundWorkbook();
    const api = persistedWorkbookClient(workbook);
    let resolveRetry!: (value: Workbook) => void;
    api.loadWorkbook.mockResolvedValueOnce(workbook).mockImplementationOnce(() => new Promise((resolve) => { resolveRetry = resolve; }));
    const { result } = renderHook(() => useWorkbookController({ apiClient: api }));
    await waitFor(() => expect(result.current.startupLoad.status).toBe('loaded'));
    act(() => result.current.commands.changeEntryField('sheet', 'input', '5'));

    let submission!: ReturnType<typeof result.current.commands.submitEntryDraft>;
    act(() => {
      result.current.retryStartupLoad();
      submission = result.current.commands.submitEntryDraft('sheet');
    });
    await act(async () => { await submission; });
    expect(api.admitRecord).not.toHaveBeenCalled();
    expect(result.current.entrySessions.sheet!.draft.fields.input!.raw).toBe('5');
    expect(result.current.startupLoad.status).toBe('loading');

    await act(async () => { resolveRetry(workbook); });
    expect(result.current.startupLoad.status).toBe('loaded');
    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
    expect(api.admitRecord).toHaveBeenCalledTimes(1);
    expect(result.current.workbook.documents.sheet!.content.rows).toHaveLength(2);
  });

  it('sorts a committed model entry by its calculated value without including the draft', async () => {
    const original = boundWorkbook();
    const sheet = original.documents.sheet!;
    const workbook: Workbook = { ...original, documents: { ...original.documents, sheet: {
      ...sheet, sorting: [{ columnId: sheet.modelColumnBindings!.output!, direction: 'ascending' }],
    } } };
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook }));
    act(() => result.current.commands.changeEntryField('sheet', 'input', '1'));
    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
    const rows = result.current.workbook.documents.sheet!.content.rows;
    expect(rows).toHaveLength(2);
    expect(rows[1]).toBe(sheet.content.rows[0]);
    expect(result.current.entrySessions.sheet!.draft.fields.input!.raw).toBe('');
    expect(result.current.canUndo).toBe(false);
  });

  it('persists a sorted model admission atomically and reloads its physical order', async () => {
    const original = boundWorkbook();
    const sheet = original.documents.sheet!;
    const workbook: Workbook = { ...original, documents: { ...original.documents, sheet: {
      ...sheet, sorting: [{ columnId: sheet.modelColumnBindings!.output!, direction: 'ascending' }],
    } } };
    const api = persistedWorkbookClient(workbook);
    const { result, unmount } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => result.current.commands.changeEntryField('sheet', 'input', '1'));
    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });

    const rows = result.current.workbook.documents.sheet!.content.rows;
    expect(rows).toHaveLength(2);
    expect(rows[1]).toBe(sheet.content.rows[0]);
    expect(api.admitRecord).toHaveBeenCalledTimes(1);
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.commands.undo());
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.workbook.documents.sheet!.content.rows).toEqual(rows);
    expect(api.writeCells).not.toHaveBeenCalled();
    expect((await api.loadWorkbook()).documents.sheet!.content.rows).toEqual(rows);
    unmount();

    const { result: reloaded } = renderHook(() => useWorkbookController({ apiClient: api }));
    await waitFor(() => expect(reloaded.current.startupLoad.status).toBe('loaded'));
    expect(reloaded.current.workbook.documents.sheet!.content.rows).toEqual(rows);
    expect(api.admitRecord).toHaveBeenCalledTimes(1);
  });

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
    api.admitRecord.mockRejectedValueOnce(new Error('connection lost'));
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => result.current.commands.changeEntryField('sheet', 'input', '5'));

    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
    expect(result.current.workbook.documents.sheet!.content.rows).toHaveLength(1);
    expect(result.current.entrySessions.sheet).toMatchObject({ retryRequired: true, failure: 'connection lost' });
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.commands.changeEntryField('sheet', 'input', '8'));
    expect(result.current.entrySessions.sheet!.draft.fields.input!.raw).toBe('5');

    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
    expect(api.admitRecord).toHaveBeenCalledTimes(2);
    expect(api.admitRecord.mock.calls[1]).toEqual(api.admitRecord.mock.calls[0]);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.workbook.documents.sheet!.content.rows).toHaveLength(2);
    expect(result.current.entrySessions.sheet!.draft.fields.input!.raw).toBe('');
  });
  it('retains a rejected draft for correction and submits it with a new identity', async () => {
    const workbook = boundWorkbook();
    const api = persistedWorkbookClient(workbook);
    api.admitRecord.mockRejectedValueOnce(new WorkbookApiError('invalid', 400, 'invalid-model-record'));
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => result.current.commands.changeEntryField('sheet', 'input', '5'));
    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
    expect(result.current.entrySessions.sheet).toMatchObject({ draft: { fields: { input: { raw: '5' } } }, failure: expect.stringContaining('Correct') });
    expect(result.current.entrySessions.sheet!.retryRequired).toBeUndefined();
    act(() => result.current.commands.changeEntryField('sheet', 'input', '8'));
    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
    expect(api.admitRecord.mock.calls[1]![1].rowId).not.toBe(api.admitRecord.mock.calls[0]![1].rowId);
    expect(api.admitRecord.mock.calls[1]![1].values).toEqual({ input: '8' });
  });

  it('reloads a revision conflict before allowing a fresh submission', async () => {
    const workbook = boundWorkbook();
    const api = persistedWorkbookClient(workbook);
    const refreshed = { ...workbook, documents: { ...workbook.documents, sheet: { ...workbook.documents.sheet!, revision: 7 } } };
    api.loadWorkbook.mockResolvedValueOnce(workbook).mockResolvedValue(refreshed);
    api.admitRecord.mockRejectedValueOnce(new WorkbookApiError('conflict', 409, 'sheet-revision-conflict'))
      .mockImplementationOnce(async (_sheetId, request) => ({ rowId: request.rowId, alreadyCommitted: false, workbook: { ...refreshed, documents: { ...refreshed.documents, sheet: { ...refreshed.documents.sheet!, revision: 8, content: { ...refreshed.documents.sheet!.content, rows: [...refreshed.documents.sheet!.content.rows, request.rowId] } } } } }));
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => result.current.commands.changeEntryField('sheet', 'input', '5'));
    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
    expect(api.loadWorkbook).toHaveBeenCalledTimes(2);
    expect(result.current.entrySessions.sheet!.draft.fields.input!.raw).toBe('5');
    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
    expect(api.admitRecord.mock.calls[1]![1].rowId).not.toBe(api.admitRecord.mock.calls[0]![1].rowId);
    expect(api.admitRecord.mock.calls[1]![1].revision).toBe(7);
  });

  it('keeps the original retry locked if conflict recovery cannot reload the sheet', async () => {
    const workbook = boundWorkbook();
    const api = persistedWorkbookClient(workbook);
    api.loadWorkbook.mockResolvedValueOnce(workbook).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ...workbook, documents: { ...workbook.documents, sheet: { ...workbook.documents.sheet!, revision: 7 } } });
    api.admitRecord.mockRejectedValue(new WorkbookApiError('conflict', 409, 'sheet-revision-conflict'));
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => result.current.commands.changeEntryField('sheet', 'input', '5'));
    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
    expect(result.current.entrySessions.sheet).toMatchObject({ retryRequired: true, failure: expect.stringContaining('could not be reloaded') });
    act(() => result.current.commands.changeEntryField('sheet', 'input', '8'));
    expect(result.current.entrySessions.sheet!.draft.fields.input!.raw).toBe('5');
    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
    expect(api.admitRecord.mock.calls[1]).toEqual(api.admitRecord.mock.calls[0]);
    expect(result.current.entrySessions.sheet!.retryRequired).toBeUndefined();
  });
  it('retains a target submission after missing-sheet recovery fails and retries the identical receipt', async () => {
    const workbook = boundWorkbook();
    const api = persistedWorkbookClient(workbook);
    const removed = { ...workbook, manifest: { ...workbook.manifest, revision: workbook.manifest.revision + 1, sheetIds: [] }, documents: {} };
    api.loadWorkbook.mockResolvedValueOnce(workbook).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(removed);
    api.admitRecord.mockRejectedValueOnce(new WorkbookApiError('missing', 404, 'sheet-not-found', { sheetId: 'sheet' }))
      .mockRejectedValueOnce(new WorkbookApiError('missing', 404, 'sheet-not-found', { sheetId: 'sheet' }));
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => result.current.commands.changeEntryField('sheet', 'input', '5'));
    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
    expect(result.current.entrySessions.sheet).toMatchObject({ retryRequired: true, draft: { fields: { input: { raw: '5' } } } });
    act(() => { result.current.commands.changeEntryField('sheet', 'input', '8'); });
    expect(result.current.entrySessions.sheet!.draft.fields.input!.raw).toBe('5');
    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
    expect(api.admitRecord.mock.calls[1]).toEqual(api.admitRecord.mock.calls[0]);
    expect(result.current.workbook.documents.sheet).toBeUndefined();
  });

  it('confirms a frozen receipt after another admission refresh removes its target', async () => {
    const bound = boundWorkbook();
    const second = { ...bound.documents.sheet!, id: 'second', name: 'Second' };
    const workbook = { ...bound, manifest: { ...bound.manifest, sheetIds: ['sheet', 'second'] }, documents: { ...bound.documents, second } };
    const removed = { ...workbook, manifest: { ...workbook.manifest, revision: workbook.manifest.revision + 1, sheetIds: ['second'] }, documents: { second } };
    const api = persistedWorkbookClient(workbook);
    api.loadWorkbook.mockResolvedValueOnce(workbook).mockResolvedValueOnce(workbook).mockResolvedValueOnce(removed);
    api.admitRecord.mockRejectedValueOnce(new Error('connection lost'))
      .mockRejectedValueOnce(new WorkbookApiError('missing', 404, 'sheet-not-found', { sheetId: 'sheet' }))
      .mockImplementationOnce(async (_id, request) => ({ rowId: request.rowId, alreadyCommitted: true, workbook: removed }));
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => result.current.commands.changeEntryField('sheet', 'input', '5'));
    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
    act(() => result.current.commands.changeEntryField('second', 'input', '7'));
    await act(async () => { await result.current.commands.submitEntryDraft('second'); });
    expect(result.current.workbook.documents.sheet).toBeUndefined();
    let confirmation!: Awaited<ReturnType<typeof result.current.commands.submitEntryDraft>>;
    await act(async () => { confirmation = await result.current.commands.submitEntryDraft('sheet'); });
    expect(api.admitRecord.mock.calls[2]).toEqual(api.admitRecord.mock.calls[0]);
    expect(confirmation.result?.rowId).toBe(api.admitRecord.mock.calls[0]![1].rowId);
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.commands.undo());
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.workbook.documents.sheet).toBeUndefined();
  });
  it('refreshes a deleted guarded dependency on retry and permits a corrected new submission', async () => {
    const bound = boundWorkbook();
    const other = sheetDocument({ id: 'other', name: 'Other', rowCount: 1, columnCount: 1 });
    const workbook = { ...bound, manifest: { ...bound.manifest, sheetIds: [...bound.manifest.sheetIds, 'other'] }, documents: { ...bound.documents, other } };
    const refreshed = { ...bound, manifest: { ...bound.manifest, revision: workbook.manifest.revision + 1 } };
    const api = persistedWorkbookClient(workbook);
    api.loadWorkbook.mockResolvedValueOnce(workbook).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(refreshed);
    api.admitRecord.mockRejectedValueOnce(new Error('connection lost'))
      .mockRejectedValueOnce(new WorkbookApiError('missing', 404, 'sheet-not-found', { sheetId: 'other' }))
      .mockRejectedValueOnce(new WorkbookApiError('missing', 404, 'sheet-not-found', { sheetId: 'other' }))
      .mockImplementationOnce(async (_id, request) => ({ rowId: request.rowId, alreadyCommitted: false, workbook: { ...refreshed, documents: { sheet: { ...refreshed.documents.sheet!, content: { ...refreshed.documents.sheet!.content, rows: [...refreshed.documents.sheet!.content.rows, request.rowId] } } } } }));
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => result.current.commands.changeEntryField('sheet', 'input', '5'));
    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
    expect(api.admitRecord.mock.calls[1]).toEqual(api.admitRecord.mock.calls[0]);
    expect(result.current.entrySessions.sheet).toMatchObject({ retryRequired: true, draft: { fields: { input: { raw: '5' } } } });
    expect(result.current.workbook.documents.other).toBeDefined();
    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
    expect(api.admitRecord.mock.calls[2]).toEqual(api.admitRecord.mock.calls[0]);
    expect(result.current.workbook.documents.other).toBeUndefined();
    expect(result.current.entrySessions.sheet!.retryRequired).toBeUndefined();
    act(() => result.current.commands.changeEntryField('sheet', 'input', '8'));
    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
    expect(api.admitRecord.mock.calls[3]![1]).toMatchObject({ values: { input: '8' }, before: refreshed });
    expect(api.admitRecord.mock.calls[3]![1].rowId).not.toBe(api.admitRecord.mock.calls[0]![1].rowId);
  });
  it('retries the captured formula after a cross-sheet dependency becomes invalid', async () => {
    const bound = boundWorkbook();
    const other = sheetDocument({ id: 'other', name: 'Other', rowCount: 1, columnCount: 1, cells: { A1: '5' } });
    const workbook: Workbook = { ...bound, manifest: { ...bound.manifest, sheetIds: [...bound.manifest.sheetIds, other.id] }, documents: { ...bound.documents, other } };
    const api = persistedWorkbookClient(workbook);
    api.admitRecord.mockRejectedValueOnce(new Error('connection lost'));
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => result.current.commands.changeEntryField('sheet', 'input', '=@Other!A[1]'));
    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
    expect(api.admitRecord).toHaveBeenCalledTimes(1);
    expect(result.current.entrySessions.sheet).toMatchObject({ retryRequired: true, failure: 'connection lost' });

    act(() => { expect(result.current.commands.updateCellContent('other', 'A1', 'text')).toMatchObject({ ok: true }); });
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
  it('fences the entire workbook until the request settles, then allows unrelated edits', async () => {
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
      expect(result.current.commands.updateCellContent('other', 'A1', '9')).toMatchObject({ ok: false });
      expect(result.current.commands.createSheet('New', { x: 0, y: 0 })).toMatchObject({ ok: false, reason: 'pending-model-transition' });
      expect(result.current.commands.addDataModel({ id: 'new', name: 'New', columns: [] }).result).toMatchObject({ ok: false });
      result.current.commands.appendColumn('other');
      result.current.commands.appendRow('other');
      expect(result.current.commands.deleteSheet('sheet')).toMatchObject({ ok: false });
      result.current.commands.retryFailedSaves();
      expect(result.current.mutationFailure).toBeUndefined();
    });
    expect(result.current.mutationFailure).toBe('pending-model-transition');
    act(() => result.current.commands.undo());
    expect(cellRawContent(result.current.workbook.documents.other!, 'A1')).toBeUndefined();
    act(() => result.current.commands.redo());
    expect(cellRawContent(result.current.workbook.documents.other!, 'A1')).toBeUndefined();
    expect(api.createSheet).not.toHaveBeenCalled();
    expect(api.appendColumn).not.toHaveBeenCalled();
    expect(api.appendRow).not.toHaveBeenCalled();
    await act(async () => { reject(new Error('connection lost')); await submission; });
    expect(result.current.entrySessions.sheet).toMatchObject({ retryRequired: true, failure: 'connection lost' });
    act(() => { expect(result.current.commands.updateCellContent('other', 'A1', '9')).toMatchObject({ ok: true }); });
    expect(cellRawContent(result.current.workbook.documents.other!, 'A1')).toBe('9');
    act(() => result.current.commands.undo());
    expect(cellRawContent(result.current.workbook.documents.other!, 'A1')).toBeUndefined();
    act(() => result.current.commands.redo());
    expect(cellRawContent(result.current.workbook.documents.other!, 'A1')).toBe('9');
  });
  it('removes an externally deleted sheet and its locked draft after a deferred admission returns missing', async () => {
    const workbook = boundWorkbook();
    const api = persistedWorkbookClient(workbook);
    api.loadWorkbook.mockResolvedValueOnce(workbook).mockResolvedValue({ ...workbook, manifest: { ...workbook.manifest, revision: workbook.manifest.revision + 1, sheetIds: [] }, documents: {} });
    let reject!: (error: Error) => void;
    api.admitRecord.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => result.current.commands.changeEntryField('sheet', 'input', '5'));
    let submission!: Promise<unknown>;
    act(() => { submission = result.current.commands.submitEntryDraft('sheet'); });
    await waitFor(() => expect(api.admitRecord).toHaveBeenCalledTimes(1));
    expect(result.current.entrySessions.sheet).toMatchObject({ pending: true, retryRequired: true });

    await act(async () => { reject(new WorkbookApiError('missing', 404, 'sheet-not-found')); await submission; });

    expect(result.current.workbook.documents.sheet).toBeUndefined();
    expect(result.current.workbook.manifest.sheetIds).not.toContain('sheet');
    expect(result.current.entrySessions.sheet).toBeUndefined();
    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
    expect(api.admitRecord).toHaveBeenCalledTimes(1);
    expect(result.current.workbook.documents.sheet).toBeUndefined();
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
      return response;
    });
    api.admitRecord.mockImplementationOnce(async (_sheetId, { rowId }) => {
      const saved = await api.loadWorkbook();
      const sheet = saved.documents.sheet!;
      return { rowId, alreadyCommitted: false, workbook: { ...saved, documents: { ...saved.documents, sheet: { ...sheet, revision: sheet.revision + 1, content: { ...sheet.content, rows: [...sheet.content.rows, rowId] } } } } };
    });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => { result.current.commands.updateCellContent('sheet', 'A1', '8'); });
    await waitFor(() => expect(api.writeCells).toHaveBeenCalledTimes(1));
    act(() => result.current.commands.changeEntryField('sheet', 'input', '5'));
    let submission!: Promise<unknown>;
    act(() => { submission = result.current.commands.submitEntryDraft('sheet'); });
    expect(api.admitRecord).not.toHaveBeenCalled();
    await act(async () => { release(); await submission; });
    expect(api.admitRecord).toHaveBeenCalledWith('sheet', expect.objectContaining({ rowId: expect.any(String), revision: workbook.documents.sheet!.revision, rowOrders: [] }));
    expect(cellRawContent(api.admitRecord.mock.calls[0]![1].before.documents.sheet!, 'A1')).toBe('8');
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
  it('rejects admission after a failed predecessor without losing the optimistic edit', async () => {
    const workbook = boundWorkbook();
    const api = persistedWorkbookClient(workbook);
    api.writeCells.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => { result.current.commands.updateCellContent('sheet', 'A1', '8'); });
    await waitFor(() => expect(result.current.canRetryFailedSaves).toBe(true));
    act(() => result.current.commands.changeEntryField('sheet', 'input', '5'));
    await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
    expect(api.admitRecord).not.toHaveBeenCalled();
    expect(cellRawContent(result.current.workbook.documents.sheet!, 'A1')).toBe('8');
    expect(result.current.canUndo).toBe(true);
  });
});
