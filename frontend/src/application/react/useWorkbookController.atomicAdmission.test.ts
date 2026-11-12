import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workbook } from '@workbook/core/model';
import { cellRawContent } from '@workbook/read/queries';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import { encodeWorkbookBundle, workbookApi, WorkbookApiError } from '@infrastructure/persistence/workbookApi';
import { deferred, persistedWorkbookClient } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';

afterEach(() => vi.unstubAllGlobals());

function workbook() {
  const before: Workbook = { ...workbookWithSheets([
    sheetDocument({ id: 'first', name: 'First', rowCount: 1, columnCount: 1, cells: { A1: '3' } }),
    sheetDocument({ id: 'other', name: 'Other', rowCount: 2, columnCount: 1 }),
  ]), dataModels: { model: { id: 'model', name: 'Model', columns: [{ id: 'input', name: 'Input', kind: 'manual', type: 'float' }] } } };
  const bound = bindSheetToModel(before, 'first', 'model', () => 'unused');
  if (!bound.ok) throw new Error(bound.reason);
  return bound.value;
}

function response(rowId: string, current: Workbook, alreadyCommitted = false) {
  return new Response(JSON.stringify({ rowId, alreadyCommitted, workbook: encodeWorkbookBundle(current) }), { status: 200 });
}

describe('live atomic admission wiring', () => {
  it('sends ordinary admission through the real HTTP adapter and consumes the complete authoritative bundle once', async () => {
    const before = workbook();
    const api = persistedWorkbookClient(before);
    api.admitRecord.mockImplementation(workbookApi.admitRecord);
    const fetch = vi.fn().mockImplementation(async (_url, init) => {
      const { rowId } = JSON.parse(init.body);
      const sheet = before.documents.first!;
      return response(rowId, { ...before, documents: { ...before.documents, first: { ...sheet, revision: 4, content: { ...sheet.content, rows: [...sheet.content.rows, rowId] } } } });
    });
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: before, apiClient: api }));
    act(() => result.current.commands.changeEntryField('first', 'input', '12'));
    await act(async () => { await result.current.commands.submitEntryDraft('first'); });

    const request = JSON.parse(fetch.mock.calls[0]![1].body);
    expect(request).toEqual({ rowId: expect.any(String), values: { input: '12' }, before: encodeWorkbookBundle(before), rowOrders: [] });
    expect(fetch.mock.calls[0]![1].headers['If-Match']).toBe(String(before.documents.first!.revision));
    expect(result.current.workbook.documents.first!.content.rows).toEqual([...before.documents.first!.content.rows, request.rowId]);
    expect(result.current.entrySessions.first!.draft.fields.input!.raw).toBe('');
    expect(api.saveModelLifecycle).not.toHaveBeenCalled();
    expect(api.writeCells).not.toHaveBeenCalled();
    api.writeCells.mockResolvedValueOnce({ sheets: [{ sheetId: 'first', revision: 5 }] });
    act(() => { result.current.commands.updateCellContent('first', 'A1', '8'); });
    await waitFor(() => expect(api.writeCells).toHaveBeenCalledWith([{ sheetId: 'first', revision: 4 }], expect.anything()));
  });

  it('reuses the session request after loss and adopts current membership, models and cross-sheet orders without stale replay', async () => {
    const before = workbook();
    const api = persistedWorkbookClient(before);
    api.admitRecord.mockImplementation(workbookApi.admitRecord);
    const fetch = vi.fn().mockRejectedValueOnce(new Error('lost response')).mockImplementationOnce(async (_url, init) => {
      const { rowId } = JSON.parse(init.body);
      const other = before.documents.other!;
      const added = sheetDocument({ id: 'added', name: 'Added', rowCount: 1, columnCount: 1 });
      const current = workbookWithSheets([{ ...other, revision: 3, content: { ...other.content, rows: [...other.content.rows].reverse() } }, added]);
      current.manifest.revision = 2;
      current.dataModels = { ...before.dataModels, addedModel: { id: 'addedModel', name: 'Added', columns: [] } };
      return response(rowId, current, true);
    });
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: before, apiClient: api }));
    act(() => result.current.commands.changeEntryField('first', 'input', '12'));
    await act(async () => { await result.current.commands.submitEntryDraft('first'); });
    act(() => { expect(result.current.commands.updateCellContent('other', 'A1', '7')).toMatchObject({ ok: true }); });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    await act(async () => { expect((await result.current.commands.submitEntryDraft('first')).result).toMatchObject({ rowId: expect.any(String), sheet: undefined }); });

    expect(fetch.mock.calls[1]).toEqual(fetch.mock.calls[0]);
    expect(api.loadWorkbook).toHaveBeenCalledOnce();
    expect(result.current.workbook.manifest).toMatchObject({ revision: 2, sheetIds: ['other', 'added'] });
    expect(result.current.workbook.documents.first).toBeUndefined();
    expect(result.current.workbook.documents.other!.content.rows).toEqual([...before.documents.other!.content.rows].reverse());
    expect(result.current.workbook.dataModels?.addedModel?.name).toBe('Added');
    expect(result.current.entrySessions.first).toBeUndefined();
  });

  it('drains an unrelated predecessor before capturing complete committed guards and fences successors', async () => {
    const before = workbook();
    const api = persistedWorkbookClient(before);
    const write = api.writeCells.getMockImplementation()!;
    const held = deferred<void>();
    api.writeCells.mockImplementationOnce(async (...args) => { await held.promise; return write(...args); });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: before, apiClient: api }));
    act(() => { result.current.commands.updateCellContent('other', 'A1', '7'); });
    await waitFor(() => expect(api.writeCells).toHaveBeenCalledOnce());
    act(() => result.current.commands.changeEntryField('first', 'input', '12'));
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.commands.submitEntryDraft('first'); });
    expect(api.loadWorkbook).not.toHaveBeenCalled();
    act(() => { expect(result.current.commands.updateCellContent('other', 'A1', '9')).toMatchObject({ ok: false }); });
    await act(async () => { held.resolve(); await pending; });
    expect(cellRawContent(api.admitRecord.mock.calls[0]![1].before.documents.other!, 'A1')).toBe('7');
    expect(cellRawContent(result.current.workbook.documents.other!, 'A1')).toBe('7');
  });

  it('does not dispatch over a failed unrelated save', async () => {
    const before = workbook();
    const api = persistedWorkbookClient(before);
    api.writeCells.mockRejectedValue(new WorkbookApiError('invalid', 400, 'invalid-cell-patch'));
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: before, apiClient: api }));
    act(() => { result.current.commands.updateCellContent('other', 'A1', '7'); });
    await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
    act(() => result.current.commands.changeEntryField('first', 'input', '12'));
    await act(async () => { await result.current.commands.submitEntryDraft('first'); });
    expect(api.loadWorkbook).not.toHaveBeenCalled();
    expect(api.admitRecord).not.toHaveBeenCalled();
    expect(result.current.entrySessions.first!.failure).toContain('Resolve failed saves');
    expect(result.current.entrySessions.first!.retryRequired).toBeUndefined();
    act(() => {
      result.current.commands.changeEntryField('first', 'input', '13');
      expect(result.current.commands.updateCellContent('first', 'A1', '8')).toMatchObject({ ok: true });
    });
    expect(result.current.entrySessions.first!.draft.fields.input!.raw).toBe('13');
  });

  it.each(['sheet', 'axis'])('rejects capture while %s creation is pending', async (kind) => {
    const before = workbook();
    const api = persistedWorkbookClient(before);
    const creation = deferred<never>();
    api.createSheet.mockReturnValue(creation.promise);
    api.appendColumn.mockReturnValue(creation.promise);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: before, apiClient: api }));
    act(() => {
      if (kind === 'sheet') result.current.commands.createSheet('New', { x: 0, y: 0 });
      else result.current.commands.appendColumn('other');
    });
    act(() => result.current.commands.changeEntryField('first', 'input', '12'));
    await act(async () => { await result.current.commands.submitEntryDraft('first'); });
    expect(api.loadWorkbook).not.toHaveBeenCalled();
    expect(api.admitRecord).not.toHaveBeenCalled();
    expect(result.current.entrySessions.first!.failure).toContain('pending sheet and axis creation');
    expect(result.current.entrySessions.first!.retryRequired).toBeUndefined();
    act(() => {
      result.current.commands.changeEntryField('first', 'input', '13');
      expect(result.current.commands.updateCellContent('first', 'A1', '8')).toMatchObject({ ok: true });
    });
    expect(result.current.entrySessions.first!.draft.fields.input!.raw).toBe('13');
    await act(async () => { creation.reject(new Error('cancelled')); });
  });
});
