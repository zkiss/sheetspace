import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { cellRawContent } from '@workbook/read/queries';
import { useWorkbookController } from '@application/react/useWorkbookController';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { creationReceipt, positionedSheet, sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { encodeWorkbookBundle, workbookApi } from '@infrastructure/persistence/workbookApi';

afterEach(() => vi.unstubAllGlobals());

it('keeps a reversed receipt unresolved rather than dropping its server-only sheet', async () => {
  const first = positionedSheet('first', 'First', { x: 0, y: 0 });
  const second = sheetDocument({ id: 'second', name: 'Second', position: { x: 1, y: 1 }, zIndex: 2 });
  const definition = { identity: 'fn', name: 'Fn', parameters: [], body: '=1', bodyBindings: {} };
  const initial = { ...workbookWithSheets([]), functions: [definition] };
  const firstReceipt = creationReceipt(first, initial);
  firstReceipt.workbook.manifest.revision = 1;
  firstReceipt.workbook.functions = [{ ...definition, bodyBindings: { first: '=1' as never } }];
  const secondReceipt = creationReceipt(second, firstReceipt.workbook);
  secondReceipt.workbook.manifest.revision = 2;
  secondReceipt.workbook.functions = [{ ...definition, bodyBindings: { first: '=1' as never, second: '=2' as never } }];
  const firstResponse = deferred<typeof firstReceipt>();
  const secondResponse = deferred<typeof secondReceipt>();
  const firstCallback = vi.fn(), secondCallback = vi.fn();
  const api = autosaveClient({ createSheet: vi.fn().mockReturnValueOnce(firstResponse.promise).mockReturnValueOnce(secondResponse.promise) });
  const { result } = renderHook(() => useWorkbookController({ apiClient: api, initialWorkbook: initial }));
  act(() => {
    result.current.commands.createSheet('First', { x: 0, y: 0 }, 1, firstCallback);
    result.current.commands.createSheet('Second', { x: 1, y: 1 }, 1, secondCallback);
  });
  await act(async () => { secondResponse.resolve(secondReceipt); await secondResponse.promise; });
  await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
  expect(result.current.creatingFrames.map((frame) => frame.name)).toEqual(['First', 'Second']);
  expect(result.current.workbook.functions?.[0].bodyBindings).toEqual({});
  await act(async () => { firstResponse.resolve(firstReceipt); await firstResponse.promise; });
  await waitFor(() => expect(result.current.creatingFrames.map((frame) => frame.name)).toEqual(['Second']));
  expect(result.current.workbook.functions?.[0].bodyBindings).toEqual({ first: '=1' });
  expect(result.current.workbook.manifest.revision).toBe(1);
  expect(Object.keys(result.current.workbook.documents)).toEqual(['first']);
  expect(firstCallback).not.toHaveBeenCalled();
  expect(secondCallback).not.toHaveBeenCalled();
  expect(result.current.saveStatus).toBe('failed');
});

it('does not overwrite a saved edit or revision when a conflicting receipt arrives', async () => {
  const old = positionedSheet('old', 'Old', { x: 0, y: 0 });
  const created = sheetDocument({ id: 'new', name: 'New', position: { x: 1, y: 1 }, zIndex: 2 });
  const response = deferred<ReturnType<typeof creationReceipt>>();
  const callback = vi.fn();
  const writeCells = vi.fn().mockResolvedValue({ sheets: [{ sheetId: 'old', revision: 3 }] });
  const api = autosaveClient({ createSheet: vi.fn().mockReturnValue(response.promise), writeCells });
  const { result } = renderHook(() => useWorkbookController({ apiClient: api, initialWorkbook: workbookWithSheets([old]) }));
  act(() => {
    result.current.commands.createSheet('New', { x: 1, y: 1 }, 1, callback);
    result.current.commands.updateCellContent('old', 'A1', 'local');
  });
  await waitFor(() => expect(result.current.workbook.documents.old.revision).toBe(3));
  const remote = { ...old, frame: { ...old.frame, position: { x: 42, y: 42 } }, revision: 1 };
  await act(async () => { response.resolve(creationReceipt(created, workbookWithSheets([remote], 1))); await response.promise; });
  await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
  expect(cellRawContent(result.current.workbook.documents.old, 'A1')).toBe('"local"');
  expect(result.current.workbook.documents.old.revision).toBe(3);
  expect(result.current.workbook.documents.old.frame.position).toEqual({ x: 0, y: 0 });
  expect(result.current.workbook.documents.new).toBeUndefined();
  expect(result.current.creatingFrames.map((frame) => frame.name)).toEqual(['New']);
  expect(api.writeCells).toHaveBeenCalledOnce();
  expect(callback).not.toHaveBeenCalled();
  act(() => { result.current.commands.updateCellContent('old', 'B1', 'after conflict'); });
  await waitFor(() => expect(api.writeCells).toHaveBeenCalledTimes(2));
  expect(writeCells.mock.calls[1][0]).toEqual([{ sheetId: 'old', revision: 3 }]);
  expect(cellRawContent(result.current.workbook.documents.old, 'A1')).toBe('"local"');
  expect(cellRawContent(result.current.workbook.documents.old, 'B1')).toBe('"after conflict"');
});

it('keeps a malformed HTTP success unresolved through the real creation adapter', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const callback = vi.fn();
  const api = autosaveClient({ createSheet: workbookApi.createSheet });
  const { result } = renderHook(() => useWorkbookController({ apiClient: api, initialWorkbook: workbookWithSheets([]) }));
  act(() => { result.current.commands.createSheet('Unknown', { x: 0, y: 0 }, 1, callback); });
  await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
  expect(result.current.creatingFrames.map((frame) => frame.name)).toEqual(['Unknown']);
  expect(result.current.workbook.documents).toEqual({});
  act(() => expect(result.current.commands.createSheet('Unknown', { x: 0, y: 0 })).toEqual({ ok: false, reason: 'duplicate' }));
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith('/api/sheets', expect.objectContaining({ method: 'POST' }));
  expect(callback).not.toHaveBeenCalled();
});

it('retains function state and leaves creation unresolved when the receipt omits functions', async () => {
  const old = positionedSheet('old', 'Old', { x: 0, y: 0 });
  const initial = { ...workbookWithSheets([old]), functions: [{ identity: 'fn', name: 'Fn', parameters: [], body: '=1', bodyBindings: { old: '=1' as never } }] };
  const created = positionedSheet('new', 'New', { x: 1, y: 1 });
  const truncated = { ...encodeWorkbookBundle(creationReceipt(created, initial).workbook), functions: undefined };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ sheetId: 'new', workbook: truncated }))));
  const callback = vi.fn();
  const { result } = renderHook(() => useWorkbookController({ apiClient: autosaveClient({ createSheet: workbookApi.createSheet }), initialWorkbook: initial }));
  act(() => { result.current.commands.createSheet('New', { x: 1, y: 1 }, 1, callback); });
  await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
  expect(result.current.workbook).toEqual(initial);
  expect(result.current.creatingFrames.map((frame) => frame.name)).toEqual(['New']);
  expect(callback).not.toHaveBeenCalled();
});

it.each(['name', 'position', 'size', 'visualScale', 'zIndex'] as const)('keeps a valid HTTP receipt with a mismatched %s unresolved', async (field) => {
  const original = positionedSheet('wrong', 'Requested', { x: 4, y: 5 });
  const wrong = field === 'name' ? { ...original, name: 'Other' } : {
    ...original,
    frame: { ...original.frame, ...(field === 'position' ? { position: { x: 9, y: 5 } }
      : field === 'size' ? { size: { width: 241, height: 160 } }
        : field === 'visualScale' ? { visualScale: 2 } : { zIndex: 2 }) },
  };
  const receipt = creationReceipt(wrong);
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sheetId: wrong.id, workbook: encodeWorkbookBundle(receipt.workbook) }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const callback = vi.fn();
  const { result } = renderHook(() => useWorkbookController({ apiClient: autosaveClient({ createSheet: workbookApi.createSheet }), initialWorkbook: workbookWithSheets([]) }));
  act(() => { result.current.commands.createSheet('Requested', { x: 4, y: 5 }, 1, callback); });
  await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
  expect(result.current.workbook.documents).toEqual({});
  expect(result.current.creatingFrames).toMatchObject([{ name: 'Requested', position: { x: 4, y: 5 } }]);
  act(() => expect(result.current.commands.createSheet('Requested', { x: 4, y: 5 })).toEqual({ ok: false, reason: 'duplicate' }));
  expect(fetch).toHaveBeenCalledOnce();
  expect(callback).not.toHaveBeenCalled();
});
