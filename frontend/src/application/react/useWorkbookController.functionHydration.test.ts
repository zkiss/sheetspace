import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { setCustomFunction } from '@calculation/customFunctions';
import { autosaveClient } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { deletionFixture } from '@test-support/recordDeletionFixture';
import { useWorkbookController } from './useWorkbookController';
import { encodeWorkbookBundle, workbookApi } from '@infrastructure/persistence/workbookApi';

afterEach(() => vi.unstubAllGlobals());

function boundWorkbook() {
  const sheet = sheetDocument({ id: 'one', name: 'One', rowCount: 2, columnCount: 1 });
  const defined = setCustomFunction(workbookWithSheets([sheet]), { name: 'F', parameters: [], body: '=@A[1]' });
  if (!defined.ok) throw new Error(defined.error);
  return defined.workbook;
}

it('preserves bindings during unrelated saved edits and a failed lifecycle operation', async () => {
  const initial = boundWorkbook();
  const admit = vi.fn().mockRejectedValue(new Error('offline'));
  const api = autosaveClient({ admitModelLifecycle: admit });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
  act(() => result.current.commands.updateCellContent('one', 'A1', '42'));
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  expect(result.current.workbook.functions).toEqual(initial.functions);
  let submission: ReturnType<typeof result.current.commands.addDataModel>;
  act(() => { submission = result.current.commands.addDataModel({ id: 'model', name: 'Model', columns: [] }); });
  await act(async () => { expect(await submission!.completion).toMatchObject({ ok: false }); });
  expect(result.current.workbook.functions).toEqual(initial.functions);
  expect(result.current.canRetryFailedSaves).toBe(true);
});

it('keeps remaining caller bindings when a sheet is deleted', async () => {
  const initial = boundWorkbook();
  const api = autosaveClient({ deleteSheet: vi.fn().mockResolvedValue(undefined) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
  act(() => { expect(result.current.commands.deleteSheet('one').ok).toBe(true); });
  expect(result.current.workbook.functions![0]!.bodyBindings).toEqual({});
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
});

it('retains bound definitions across a failed save and retry', async () => {
  const initial = boundWorkbook();
  const writeCells = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ sheets: [{ sheetId: 'one', revision: 1 }] });
  const api = autosaveClient({ writeCells, loadSheet: vi.fn().mockResolvedValue(initial.documents.one) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
  act(() => result.current.commands.updateCellContent('one', 'A1', '42'));
  await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
  expect(result.current.workbook.functions).toEqual(initial.functions);
  act(() => result.current.commands.retryFailedSaves());
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  expect(result.current.workbook.functions).toEqual(initial.functions);
});

it('hydrates exact bound definitions after a failed startup load is retried', async () => {
  const initial = boundWorkbook();
  const loadWorkbook = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(initial);
  const api = autosaveClient({ loadWorkbook });
  const { result } = renderHook(() => useWorkbookController({ apiClient: api }));
  await waitFor(() => expect(result.current.startupLoad.status).toBe('error'));
  act(() => result.current.retryStartupLoad());
  await waitFor(() => expect(result.current.startupLoad.status).toBe('loaded'));
  expect(result.current.workbook.functions).toEqual(initial.functions);
});

it('rejects malformed startup transport and installs only a valid retry', async () => {
  const initial = boundWorkbook();
  initial.functions![0].identity = 'server-lineage';
  const bundle = encodeWorkbookBundle(initial);
  const malformed = { ...bundle, functions: [{ ...bundle.functions[0], identity: undefined }] };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(malformed)))
    .mockResolvedValueOnce(new Response(JSON.stringify(bundle))));
  const api = autosaveClient({ loadWorkbook: workbookApi.loadWorkbook });
  const { result } = renderHook(() => useWorkbookController({ apiClient: api }));
  await waitFor(() => expect(result.current.startupLoad.status).toBe('error'));
  expect(result.current.workbook.functions ?? []).toEqual([]);
  act(() => result.current.retryStartupLoad());
  await waitFor(() => expect(result.current.startupLoad.status).toBe('loaded'));
  expect(result.current.workbook.functions).toEqual(initial.functions);
});

it.each(['identity', 'functions'] as const)('preserves bound state and pending lifecycle work after malformed %s recovery', async (missing) => {
  const initial = boundWorkbook();
  initial.functions![0].identity = 'server-lineage';
  const fetchMock = vi.fn().mockRejectedValueOnce(new Error('lost response')).mockImplementation(async (_url, init: RequestInit) => {
    const request = JSON.parse(init.body as string);
    const workbook = request.after;
    if (fetchMock.mock.calls.length === 2) {
      if (missing === 'identity') delete workbook.functions[0].identity;
      else delete workbook.functions;
    }
    return new Response(JSON.stringify({ operationId: request.operationId, transitionId: 'dd36b1da-89af-4d7d-b81e-17a9c426f6e4', alreadyCommitted: true, workbook }));
  });
  vi.stubGlobal('fetch', fetchMock);
  const api = autosaveClient({ admitModelLifecycle: workbookApi.admitModelLifecycle });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
  let submission: ReturnType<typeof result.current.commands.addDataModel>;
  act(() => { submission = result.current.commands.addDataModel({ id: 'model', name: 'Model', columns: [] }); });
  await act(async () => { expect(await submission!.completion).toMatchObject({ ok: false }); });
  expect(result.current.canRetryFailedSaves).toBe(true);
  act(() => result.current.commands.retryFailedSaves());
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
  expect(result.current.canRetryFailedSaves).toBe(true);
  expect(result.current.commands.currentWorkbook()).toEqual(initial);
  expect(result.current.workbook.functions).toEqual(initial.functions);
  act(() => result.current.commands.retryFailedSaves());
  await waitFor(() => expect(result.current.canRetryFailedSaves).toBe(false));
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(result.current.saveStatus).toBe('saved');
  expect(result.current.workbook.functions).toEqual(initial.functions);
  expect(result.current.workbook.dataModels?.model).toBeDefined();
});

it('retains authoritative bindings when a reordered sheet response is installed', async () => {
  const initial = boundWorkbook();
  const sheet = initial.documents.one!;
  const reordered = { ...sheet, revision: 1, content: { ...sheet.content, rows: [...sheet.content.rows].reverse() } };
  const api = autosaveClient({ writeAxisOrder: vi.fn().mockResolvedValue(reordered), loadSheet: vi.fn().mockResolvedValue(reordered) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
  act(() => expect(result.current.commands.shiftAxis('one', 'row', [sheet.content.rows[0]!], 1).status).toBe('changed'));
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  expect(result.current.workbook.documents.one!.content.rows).toEqual(reordered.content.rows);
  expect(result.current.workbook.functions).toEqual(initial.functions);
});

it('retains bindings through an unrelated authoritative model response', async () => {
  const initial = boundWorkbook();
  initial.functions![0].identity = 'server-lineage';
  const api = autosaveClient({ admitModelLifecycle: vi.fn().mockImplementation(async (operationId, _before, after) => ({ operationId, transitionId: 'dd36b1da-89af-4d7d-b81e-17a9c426f6e4', alreadyCommitted: false, workbook: after })) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
  let submission: ReturnType<typeof result.current.commands.addDataModel>;
  act(() => { submission = result.current.commands.addDataModel({ id: 'model', name: 'Model', columns: [] }); });
  await act(async () => { expect(await submission!.completion).toMatchObject({ ok: true }); });
  expect(result.current.workbook.functions).toEqual(initial.functions);
});

it('retains function bindings through authoritative record deletion and replay', async () => {
  const fixture = deletionFixture();
  const defined = setCustomFunction(fixture.initial, { name: 'F', parameters: [], body: '=@A[1]' });
  if (!defined.ok) throw new Error(defined.error);
  const { api, initial, rowId } = deletionFixture(false, defined.workbook);
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
  await act(async () => { expect((await result.current.commands.deleteRow('sheet', rowId).completion).ok).toBe(true); });
  expect(result.current.workbook.functions).toEqual(initial.functions);
  act(() => result.current.commands.undo());
  await waitFor(() => expect(result.current.canRedo).toBe(true));
  expect(result.current.workbook.functions).toEqual(initial.functions);
});
