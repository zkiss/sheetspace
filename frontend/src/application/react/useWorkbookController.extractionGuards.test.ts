import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import { cellRawContent } from '@workbook/read/queries';
import { WorkbookApiError } from '@infrastructure/persistence/workbookApi';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import type { ExtractionRequest } from '@application/core/extractionPreparation';
import type { DataModel, SheetDocument, Workbook } from '@workbook/core/model';
import { useWorkbookController } from './useWorkbookController';

function fixture() {
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 1, columnCount: 1 });
  const cell = cellIdentityAt(sheet.content, 'A1')!;
  const request = {
    sourceSheetId: 's', selection: { kind: 'cells' as const, start: cell, end: cell },
    targetSheetId: '00000000-0000-0000-0000-000000000001', targetName: 'Target',
    targetRows: ['00000000-0000-0000-0000-000000000002'], targetColumns: ['00000000-0000-0000-0000-000000000003'],
    frame: { position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, zIndex: 2 },
  };
  return { sheet, request };
}

const model = (formula: string): DataModel => ({ id: 'model', name: 'Model', columns: [
  { id: 'input', name: 'Input', kind: 'manual', type: 'float' },
  { id: 'output', name: 'Output', kind: 'calculated', type: 'float', formula },
] });

/** A workbook whose `bound` sheet is bound through the lifecycle route. */
function boundWorkbook(formula: string, sheets: SheetDocument[]): Workbook {
  const declaration = model(formula);
  const context: Workbook = { ...workbookWithSheets(sheets), dataModels: { model: declaration } };
  const result = bindSheetToModel(context, 'bound', declaration.id, () => 'unused-column');
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

const target = {
  targetSheetId: '00000000-0000-0000-0000-000000000001', targetName: 'Target',
  targetRows: ['00000000-0000-0000-0000-000000000002'], targetColumns: ['00000000-0000-0000-0000-000000000003'],
  frame: { position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, zIndex: 2 },
};

function requestFor(workbook: Workbook, sourceSheetId: string, address: string): ExtractionRequest {
  const cell = cellIdentityAt(workbook.documents[sourceSheetId]!.content, address)!;
  return { sourceSheetId, selection: { kind: 'cells', start: cell, end: cell }, ...target };
}

describe('extraction admission', () => {
  it('rejects pending axis and sheet creations without consuming history', async () => {
    const { sheet, request } = fixture();
    const axis = deferred<{ sheetId: string; revision: number; rowCount: number; rowId: string }>();
    const creation = deferred<ReturnType<typeof sheetDocument>>();
    const api = autosaveClient({ appendRow: () => axis.promise, createSheet: () => creation.promise });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
    act(() => result.current.commands.updateCellContent('s', 'A1', '1'));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    act(() => result.current.commands.appendRow('s'));
    let submission!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { submission = result.current.commands.extractSelection(request); });
    expect(submission.result).toEqual({ ok: false, reason: 'pending-axis-creation' });
    expect(await submission.completion).toEqual(submission.result);
    expect(result.current.canUndo).toBe(true);
    await act(async () => axis.resolve({ sheetId: 's', revision: 1, rowCount: 2, rowId: 'new-row' }));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    act(() => {
      result.current.commands.createSheet('New', { x: 0, y: 0 });
      submission = result.current.commands.extractSelection(request);
    });
    expect(submission.result).toEqual({ ok: false, reason: 'pending-sheet-creation' });
    expect(await submission.completion).toEqual(submission.result);
    expect(result.current.workbook.documents[request.targetSheetId]).toBeUndefined();
    expect(api.saveModelLifecycle).not.toHaveBeenCalled();
    await act(async () => creation.resolve(sheetDocument({ id: 'new', name: 'New' })));
  });

  it('rejects a second extraction while a lifecycle submission is pending', async () => {
    const { sheet, request } = fixture();
    const save = deferred<Workbook>();
    const api = autosaveClient({ saveModelLifecycle: vi.fn().mockReturnValue(save.promise) });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
    let first!: ReturnType<typeof result.current.commands.extractSelection>;
    let second!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => {
      first = result.current.commands.extractSelection(request);
      second = result.current.commands.extractSelection({ ...request, targetSheetId: '00000000-0000-0000-0000-000000000004', targetName: 'Second', targetRows: ['00000000-0000-0000-0000-000000000005'], targetColumns: ['00000000-0000-0000-0000-000000000006'] });
    });
    expect(second.result).toEqual({ ok: false, reason: 'pending-model-transition' });
    expect(await second.completion).toEqual(second.result);
    expect(result.current.workbook.documents['00000000-0000-0000-0000-000000000004']).toBeUndefined();
    await waitFor(() => expect(api.saveModelLifecycle).toHaveBeenCalledOnce());
    await act(async () => { save.resolve(result.current.workbook); await first.completion; });
    expect(result.current.canUndo).toBe(true);
  });
});

describe('extraction protected rejection', () => {
  it('releases history after a definite server rejection of extraction', async () => {
    const { sheet, request } = fixture();
    const api = autosaveClient({ saveModelLifecycle: vi.fn().mockRejectedValue(new WorkbookApiError('conflict', 409, 'model-lifecycle-conflict')) });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
    act(() => result.current.commands.updateCellContent('s', 'A1', '1'));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    let attempt!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { attempt = result.current.commands.extractSelection(request); });
    await act(async () => expect(await attempt.completion).toEqual({ ok: false, reason: 'persistence-failed' }));
    expect(result.current.workbook.documents[request.targetSheetId]).toBeUndefined();
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRetryFailedSaves).toBe(false);
    act(() => result.current.commands.undo());
    expect(cellRawContent(result.current.workbook.documents.s!, 'A1')).toBeUndefined();
  });

  it.each([408, 500])('retains an ambiguous HTTP %s failure for exact retry', async (status) => {
    const { sheet, request } = fixture();
    const save = vi.fn().mockRejectedValueOnce(new WorkbookApiError('server error', status))
      .mockImplementation(async (_before: Workbook, after: Workbook) => after);
    const api = autosaveClient({ saveModelLifecycle: save });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
    let attempt!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { attempt = result.current.commands.extractSelection(request); });
    await act(async () => expect(await attempt.completion).toEqual({ ok: false, reason: 'persistence-failed' }));
    expect(result.current.canRetryFailedSaves).toBe(true);
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.commands.retryFailedSaves());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.canUndo).toBe(true));
    expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
    expect(result.current.workbook.documents[request.targetSheetId]).toBeDefined();
  });

  it('rejects extraction that would rewrite a sheet with an unfinished entry draft', async () => {
    const bound = sheetDocument({ id: 'bound', name: 'Bound', rowCount: 1, columnCount: 2, cells: { A1: '1' } });
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '3' } });
    const workbook = boundWorkbook('=@A[1]*2', [bound, source]);
    const request = requestFor(workbook, 'source', 'A1');
    const api = autosaveClient();
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => result.current.commands.updateCellContent('bound', 'A1', '=@Source!A[1]'));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    act(() => result.current.commands.changeEntryField('bound', 'input', '5'));
    const before = result.current.workbook;

    let attempt!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { attempt = result.current.commands.extractSelection(request); });

    expect(attempt.result).toEqual({ ok: false, reason: 'pending-model-transition' });
    expect(await attempt.completion).toEqual(attempt.result);
    expect(result.current.workbook).toBe(before);
    expect(result.current.workbook.documents[request.targetSheetId]).toBeUndefined();
    expect(result.current.entrySessions.bound!.draft.fields.input!.raw).toBe('5');
    expect(api.saveModelLifecycle).not.toHaveBeenCalled();
    expect(result.current.canUndo).toBe(true);
  });

  it('rejects extraction undo that would rewrite a sheet with an unfinished entry draft', async () => {
    const bound = sheetDocument({ id: 'bound', name: 'Bound', rowCount: 1, columnCount: 2, cells: { A1: '1' } });
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '3' } });
    const workbook = boundWorkbook('=@A[1]*2', [bound, source]);
    const request = requestFor(workbook, 'source', 'A1');
    const api = autosaveClient({ saveModelLifecycle: vi.fn().mockImplementation(async (_before: Workbook, after: Workbook) => after) });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => result.current.commands.updateCellContent('bound', 'A1', '=@Source!A[1]'));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    let extraction!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { extraction = result.current.commands.extractSelection(request); });
    await act(async () => { await extraction.completion; });
    act(() => result.current.commands.changeEntryField('bound', 'input', '5'));
    const before = result.current.workbook;

    act(() => result.current.commands.undo());

    expect(result.current.extractionReplayFailure).toBe('pending-model-transition');
    expect(result.current.workbook).toBe(before);
    expect(result.current.workbook.documents[request.targetSheetId]).toBeDefined();
    expect(result.current.entrySessions.bound!.draft.fields.input!.raw).toBe('5');
    expect(api.saveModelLifecycle).toHaveBeenCalledTimes(1);
    expect(result.current.canUndo).toBe(true);
  });

  it('allows extraction undo when an unfinished entry belongs to an unchanged sheet', async () => {
    const bound = sheetDocument({ id: 'bound', name: 'Bound', rowCount: 1, columnCount: 2, cells: { A1: '1' } });
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '3' } });
    const workbook = boundWorkbook('=@A[1]*2', [bound, source]);
    const request = requestFor(workbook, 'source', 'A1');
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook }));
    act(() => { result.current.commands.extractSelection(request); });
    act(() => result.current.commands.changeEntryField('bound', 'input', '5'));

    act(() => result.current.commands.undo());

    expect(result.current.extractionReplayFailure).toBeUndefined();
    expect(result.current.workbook.documents[request.targetSheetId]).toBeUndefined();
    expect(result.current.entrySessions.bound!.draft.fields.input!.raw).toBe('5');
    expect(result.current.canRedo).toBe(true);
  });

  it('rejects extraction of a model-bound sheet holding an unfinished entry draft', async () => {
    const bound = sheetDocument({ id: 'bound', name: 'Bound', rowCount: 1, columnCount: 2, cells: { A1: '3' } });
    const workbook = boundWorkbook('=SUM(@A[1])', [bound]);
    const api = autosaveClient();
    const request = requestFor(workbook, 'bound', 'A1');
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => result.current.commands.updateCellContent('bound', 'A1', '8'));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    const before = result.current.workbook;

    act(() => result.current.commands.changeEntryField('bound', 'input', '5'));
    let attempt!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { attempt = result.current.commands.extractSelection(request); });

    expect(attempt.result).toEqual({ ok: false, reason: 'protected-source' });
    expect(await attempt.completion).toEqual(attempt.result);
    expect(result.current.workbook).toBe(before);
    expect(result.current.workbook.documents[request.targetSheetId]).toBeUndefined();
    expect(api.saveModelLifecycle).not.toHaveBeenCalled();
    expect(result.current.entrySessions.bound!.draft.fields.input!.raw).toBe('5');
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.commands.undo());
    expect(cellRawContent(result.current.workbook.documents.bound!, 'A1')).toBe('3');
    act(() => result.current.commands.redo());
    expect(cellRawContent(result.current.workbook.documents.bound!, 'A1')).toBe('8');
  });

  it('rejects extraction while an admission is in flight on an affected sheet, until the admission settles', async () => {
    const bound = sheetDocument({ id: 'bound', name: 'Bound', rowCount: 1, columnCount: 2, cells: { A1: '1' } });
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '3' } });
    const workbook = boundWorkbook('=@A[1]*2', [bound, source]);
    const request = requestFor(workbook, 'source', 'A1');
    const admission = deferred<{ rowId: string; sheet: SheetDocument }>();
    let admitRowId = '';
    const api = autosaveClient({
      admitRecord: vi.fn().mockImplementation((_sheetId: string, rowId: string) => { admitRowId = rowId; return admission.promise; }),
      saveModelLifecycle: vi.fn().mockImplementation(async (_before: Workbook, after: Workbook) => after),
    });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => result.current.commands.updateCellContent('source', 'A1', '8'));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    act(() => result.current.commands.updateCellContent('bound', 'A1', '=@Source!A[1]'));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));

    act(() => result.current.commands.changeEntryField('bound', 'input', '5'));
    let submission!: Promise<unknown>;
    act(() => { submission = result.current.commands.submitEntryDraft('bound'); });
    await waitFor(() => expect(api.admitRecord).toHaveBeenCalledTimes(1));

    const before = result.current.workbook;
    let attempt!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { attempt = result.current.commands.extractSelection(request); });

    expect(attempt.result).toEqual({ ok: false, reason: 'pending-model-transition' });
    expect(await attempt.completion).toEqual(attempt.result);
    expect(result.current.workbook).toBe(before);
    expect(result.current.workbook.documents[request.targetSheetId]).toBeUndefined();
    expect(api.saveModelLifecycle).not.toHaveBeenCalled();
    expect(result.current.mutationFailure).toBe('pending-model-transition');
    expect(result.current.canUndo).toBe(true);

    const admitted = result.current.workbook.documents.bound!;
    await act(async () => {
      admission.resolve({ rowId: admitRowId, sheet: { ...admitted, revision: admitted.revision + 1, content: { ...admitted.content, rows: [...admitted.content.rows, admitRowId] } } });
      await submission;
    });
    let retry!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { retry = result.current.commands.extractSelection(request); });
    expect(retry.result.ok).toBe(true);
    await act(async () => { await retry.completion; });
    expect(result.current.workbook.documents[request.targetSheetId]).toBeDefined();
    expect(api.saveModelLifecycle).toHaveBeenCalledTimes(1);
    expect(cellRawContent(result.current.workbook.documents.bound!, 'A1')).toBeDefined();
    expect(projectStoredFormula(cellRawContent(result.current.workbook.documents.bound!, 'A1')!, result.current.workbook, 'bound').text).toBe('=@Target!A[1]');
  });

  it('allows extraction while an admission is in flight on a sheet the extraction does not change', async () => {
    const bound = sheetDocument({ id: 'bound', name: 'Bound', rowCount: 1, columnCount: 2, cells: { A1: '1' } });
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '3' } });
    const workbook = boundWorkbook('=@A[1]*2', [bound, source]);
    const request = requestFor(workbook, 'source', 'A1');
    const admission = deferred<{ rowId: string; sheet: SheetDocument }>();
    let admitRowId = '';
    const api = autosaveClient({
      admitRecord: vi.fn().mockImplementation((_sheetId: string, rowId: string) => { admitRowId = rowId; return admission.promise; }),
      saveModelLifecycle: vi.fn().mockImplementation(async (_before: Workbook, after: Workbook) => after),
    });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));

    act(() => result.current.commands.changeEntryField('bound', 'input', '5'));
    let submission!: Promise<unknown>;
    act(() => { submission = result.current.commands.submitEntryDraft('bound'); });
    await waitFor(() => expect(api.admitRecord).toHaveBeenCalledTimes(1));

    let attempt!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { attempt = result.current.commands.extractSelection(request); });
    expect(attempt.result.ok).toBe(true);
    expect(result.current.workbook.documents[request.targetSheetId]).toBeDefined();
    expect(api.saveModelLifecycle).not.toHaveBeenCalled();

    const admitted = result.current.workbook.documents.bound!;
    await act(async () => {
      admission.resolve({ rowId: admitRowId, sheet: { ...admitted, revision: admitted.revision + 1, content: { ...admitted.content, rows: [...admitted.content.rows, admitRowId] } } });
      await submission;
    });
    await act(async () => { await attempt.completion; });
    expect(api.saveModelLifecycle).toHaveBeenCalledTimes(1);
    expect(result.current.workbook.documents[request.targetSheetId]).toBeDefined();
  });

  it('rejects extraction that would rewrite a model-owned calculated formula', async () => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '3' } });
    const bound = sheetDocument({ id: 'bound', name: 'Bound', rowCount: 1, columnCount: 2, cells: { A1: '1' } });
    const workbook = boundWorkbook('=@Source!A[1]*2', [bound, source]);
    const request = requestFor(workbook, 'source', 'A1');
    const api = autosaveClient();
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => result.current.commands.updateCellContent('bound', 'A1', '5'));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    const before = result.current.workbook;

    let attempt!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { attempt = result.current.commands.extractSelection(request); });

    expect(attempt.result).toEqual({ ok: false, reason: 'protected-model-formula' });
    expect(await attempt.completion).toEqual(attempt.result);
    expect(result.current.workbook).toBe(before);
    expect(result.current.workbook.documents[request.targetSheetId]).toBeUndefined();
    expect(api.saveModelLifecycle).not.toHaveBeenCalled();
    expect(result.current.canUndo).toBe(true);
  });

  it('rejects extraction that would split a referenced range', async () => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 2, cells: { A1: '3', B1: '4' } });
    const other = sheetDocument({ id: 'other', name: 'Other', rowCount: 1, columnCount: 1 });
    const workbook = workbookWithSheets([source, other]);
    const request = requestFor(workbook, 'source', 'A1');
    const api = autosaveClient();
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => result.current.commands.updateCellContent('other', 'A1', '=SUM(@Source!A[1]:B[1])'));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    act(() => result.current.commands.updateCellContent('source', 'B1', '9'));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    const before = result.current.workbook;

    let attempt!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { attempt = result.current.commands.extractSelection(request); });

    expect(attempt.result).toEqual({ ok: false, reason: 'unrepresentable-range' });
    expect(await attempt.completion).toEqual(attempt.result);
    expect(result.current.workbook).toBe(before);
    expect(result.current.workbook.documents[request.targetSheetId]).toBeUndefined();
    expect(api.saveModelLifecycle).not.toHaveBeenCalled();
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.commands.redo());
    expect(cellRawContent(result.current.workbook.documents.source!, 'B1')).toBe('9');
  });
});
