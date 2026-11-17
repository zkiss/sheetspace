import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cellRawContent, findSheetById, sheetsInOrder } from '@workbook/read/queries';
import { type SheetDocument } from '@workbook/core/model';
import { useWorkbookController } from '@application/react/useWorkbookController';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { creationReceipt, positionedSheet, sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { workbookApi, WorkbookApiError } from '@infrastructure/persistence/workbookApi';
import { encodeWorkbookBundle } from '@infrastructure/persistence/workbookApi';
import { setCustomFunction } from '@calculation/customFunctions';

afterEach(() => vi.unstubAllGlobals());

describe('useWorkbookController sheet creation', () => {
  it.each(['identity', 'functions'])('keeps existing state when creation response omits %s', async (missing) => {
    const old = sheetDocument({ id: 'old', name: 'Old' });
    const created = sheetDocument({ id: 'new', name: 'New' });
    const fn = { identity: 'lineage', name: 'F', parameters: [], body: '=1', bodyBindings: { old: '=1' as never } };
    const initial = { ...workbookWithSheets([old]), functions: [fn] };
    const bundle = encodeWorkbookBundle({ ...workbookWithSheets([old, created]), functions: [{ ...fn, bodyBindings: { old: '=1' as never, new: '=1' as never } }] });
    const malformed = missing === 'functions' ? { ...bundle, functions: undefined } : { ...bundle, functions: [{ ...bundle.functions[0], identity: undefined }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ sheetId: 'new', workbook: malformed }))));
    const callback = vi.fn();
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: autosaveClient({ createSheet: workbookApi.createSheet }) }));
    act(() => { result.current.commands.createSheet('New', { x: 0, y: 0 }, 1, callback); });
    await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
    expect(result.current.workbook).toEqual(initial);
    expect(result.current.creatingFrames).toHaveLength(1);
    expect(callback).not.toHaveBeenCalled();
  });
  it('rejects invalid and reserved names before issuing another create request', () => {
    const apiClient = autosaveClient({ createSheet: vi.fn().mockReturnValue(new Promise<SheetDocument>(() => undefined)) });
    const { result } = renderHook(() => useWorkbookController({ apiClient, initialWorkbook: workbookWithSheets([]) }));

    act(() => {
      expect(result.current.commands.createSheet('   ', { x: 0, y: 0 })).toMatchObject({ ok: false });
      expect(result.current.commands.createSheet('Inputs', { x: 0, y: 0 })).toEqual({ ok: true, name: 'Inputs' });
      expect(result.current.commands.createSheet('Inputs', { x: 10, y: 10 })).toEqual({ ok: false, reason: 'duplicate' });
    });

    expect(apiClient.createSheet).toHaveBeenCalledTimes(1);
  });

  it('keeps an in-flight create out of the canonical workbook', () => {
    const apiClient = autosaveClient({ createSheet: vi.fn().mockReturnValue(new Promise<SheetDocument>(() => undefined)) });
    const { result } = renderHook(() => useWorkbookController({ apiClient, initialWorkbook: workbookWithSheets([]) }));
    act(() => expect(result.current.commands.createSheet('Inputs', { x: 24, y: 48 }, 2)).toEqual({ ok: true, name: 'Inputs' }));
    expect(sheetsInOrder(result.current.workbook)).toEqual([]);
    expect(result.current.creatingFrames).toMatchObject([{ kind: 'creating', name: 'Inputs', position: { x: 24, y: 48 }, visualScale: 0.5 }]);
    expect(apiClient.createSheet).toHaveBeenCalledWith({ name: 'Inputs', position: { x: 24, y: 48 }, visualScale: 0.5, zIndex: 1 });
  });

  it.each([
    [0.1, 8],
    [8, 0.125],
  ])('clamps the inverse viewport scale for creation at zoom %s', (viewportScale, visualScale) => {
    const apiClient = autosaveClient({ createSheet: vi.fn().mockReturnValue(new Promise<SheetDocument>(() => undefined)) });
    const { result } = renderHook(() => useWorkbookController({ apiClient, initialWorkbook: workbookWithSheets([]) }));

    act(() => { result.current.commands.createSheet('Inputs', { x: 24, y: 48 }, viewportScale); });

    expect(result.current.creatingFrames[0]).toMatchObject({ visualScale, zIndex: 1 });
    expect(apiClient.createSheet).toHaveBeenCalledWith(expect.objectContaining({ visualScale, zIndex: 1 }));
  });

  it('persists edits to a saved sheet while another sheet creation remains unresolved', async () => {
    const existing = positionedSheet('sheet-saved', 'Saved', { x: 0, y: 0 });
    const createSave = deferred<ReturnType<typeof creationReceipt>>();
    const cellSave = deferred<{ sheets: Array<{ sheetId: string; revision: number }> }>();
    const apiClient = autosaveClient({
      createSheet: vi.fn().mockReturnValue(createSave.promise),
      writeCells: vi.fn().mockReturnValue(cellSave.promise),
    });
    const { result } = renderHook(() => useWorkbookController({
      apiClient,
      initialWorkbook: workbookWithSheets([existing]),
    }));

    act(() => {
      result.current.commands.createSheet('Creating', { x: 24, y: 48 });
      result.current.commands.updateCellContent(existing.id, 'A1', 'Saved independently');
    });

    expect(apiClient.writeCells).toHaveBeenCalledTimes(1);
    expect(result.current.creatingFrames).toMatchObject([{ kind: 'creating', name: 'Creating' }]);
    expect(sheetsInOrder(result.current.workbook).map((sheet) => sheet.id)).toEqual([existing.id]);

    await act(async () => {
      cellSave.resolve({ sheets: [{ sheetId: existing.id, revision: 1 }] });
      await cellSave.promise;
    });

    await waitFor(() => expect(findSheetById(result.current.workbook, existing.id)?.revision).toBe(1));
    expect(cellRawContent(findSheetById(result.current.workbook, existing.id)!, 'A1')).toBe(
      'Saved independently',
    );
    expect(apiClient.writeCells).toHaveBeenCalledTimes(1);
    expect(result.current.creatingFrames).toMatchObject([{ kind: 'creating', name: 'Creating' }]);
    expect(result.current.saveStatus).toBe('saving');

    await act(async () => {
      createSave.resolve(creationReceipt(sheetDocument({ id: 'sheet-created', name: 'Creating', position: { x: 24, y: 48 }, zIndex: 2 }), workbookWithSheets([existing])));
      await createSave.promise;
    });

    await waitFor(() => expect(result.current.creatingFrames).toEqual([]));
    expect(sheetsInOrder(result.current.workbook).map((sheet) => sheet.id)).toEqual([
      existing.id,
      'sheet-created',
    ]);
    expect(cellRawContent(findSheetById(result.current.workbook, existing.id)!, 'A1')).toBe(
      'Saved independently',
    );
  });

  it('inserts the returned document only after success', async () => {
    const returned = positionedSheet('sheet-inputs', 'Inputs', { x: 24, y: 48 });
    let resolve!: (sheet: ReturnType<typeof creationReceipt>) => void;
    const pending = new Promise<ReturnType<typeof creationReceipt>>((done) => { resolve = done; });
    const apiClient = autosaveClient({ createSheet: vi.fn().mockReturnValue(pending) });
    const { result } = renderHook(() => useWorkbookController({ apiClient, initialWorkbook: workbookWithSheets([]) }));
    act(() => { result.current.commands.createSheet('Inputs', { x: 24, y: 48 }); });
    await act(async () => { resolve(creationReceipt(returned)); await pending; });
    await waitFor(() => expect(result.current.creatingFrames).toEqual([]));
    expect(sheetsInOrder(result.current.workbook)).toEqual([returned]);
  });

  it('discards a successful duplicate document returned by the server', async () => {
    const existing = positionedSheet('sheet-existing', 'Existing', { x: 0, y: 0 });
    const pending = deferred<ReturnType<typeof creationReceipt>>();
    const apiClient = autosaveClient({ createSheet: vi.fn().mockReturnValue(pending.promise) });
    const { result } = renderHook(() => useWorkbookController({ apiClient, initialWorkbook: workbookWithSheets([existing]) }));

    act(() => { result.current.commands.createSheet('New', { x: 24, y: 48 }); });
    await act(async () => {
      pending.resolve(creationReceipt({ ...existing, name: 'Unexpected duplicate' }));
      await pending.promise;
    });

    await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
    expect(result.current.creatingFrames).toHaveLength(1);
    expect(sheetsInOrder(result.current.workbook)).toEqual([existing]);
  });

  it('admits a local caller with stable function bindings and preserves them through reorder and reload', async () => {
    const first = sheetDocument({ id: 'first', name: 'First' });
    const defined = setCustomFunction(workbookWithSheets([first]), { name: 'F', parameters: [], body: '=@A[1]' });
    if (!defined.ok) throw new Error(defined.error);
    const oldBinding = defined.workbook.functions![0]!.bodyBindings!.first;
    const callback = vi.fn();
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: defined.workbook }));

    act(() => { result.current.commands.createSheet('Local', { x: 1, y: 2 }, 1, callback); });

    const sheet = callback.mock.calls[0]![0] as SheetDocument;
    expect(result.current.creatingFrames).toEqual([]);
    expect(result.current.saveStatus).toBe('saved');
    expect(result.current.workbook.documents[sheet.id]).toEqual(sheet);
    const bindings = result.current.workbook.functions![0]!.bodyBindings!;
    expect(bindings.first).toBe(oldBinding);
    expect(bindings[sheet.id]).toContain(sheet.content.rows[0]);
    act(() => { result.current.commands.shiftAxis(sheet.id, 'row', [sheet.content.rows[0]!], 1); });
    await waitFor(() => expect(result.current.workbook.documents[sheet.id]!.content.rows[1]).toBe(sheet.content.rows[0]));
    const reloaded = JSON.parse(JSON.stringify(result.current.workbook));
    expect(reloaded.functions![0]!.bodyBindings).toEqual(bindings);
  });

  it('uses the default create API when the partial client omits it', async () => {
    const returned = positionedSheet('default-created', 'Default', { x: 1, y: 2 });
    const request = vi.spyOn(workbookApi, 'createSheet').mockResolvedValue(creationReceipt(returned));
    const { result } = renderHook(() => useWorkbookController({ apiClient: {}, initialWorkbook: workbookWithSheets([]) }));

    act(() => { result.current.commands.createSheet('Default', { x: 1, y: 2 }); });
    await waitFor(() => expect(result.current.creatingFrames).toEqual([]));

    expect(request).toHaveBeenCalledOnce();
    request.mockRestore();
  });

  it('removes a failed placeholder without changing saved sheets', async () => {
    const existing = positionedSheet('saved', 'Saved', { x: 0, y: 0 });
    const updateSheetVisualScale = vi.fn();
    const apiClient = autosaveClient({ createSheet: vi.fn().mockRejectedValue(new WorkbookApiError('failed', 400, 'sheet-name-duplicate')), updateSheetVisualScale });
    const { result } = renderHook(() => useWorkbookController({ apiClient, initialWorkbook: workbookWithSheets([existing]) }));
    act(() => { result.current.commands.createSheet('Inputs', { x: 24, y: 48 }, 1 / 1.2); });
    expect(result.current.creatingFrames).toMatchObject([{ name: 'Inputs', visualScale: 1.2 }]);
    expect(apiClient.createSheet).toHaveBeenCalledWith(expect.objectContaining({ name: 'Inputs', position: { x: 24, y: 48 }, visualScale: 1.2 }));
    await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
    expect(result.current.creatingFrames).toEqual([]);
    expect(sheetsInOrder(result.current.workbook)).toEqual([existing]);
    expect(updateSheetVisualScale).not.toHaveBeenCalled();
  });

  it('matches concurrent creates by operation key when they resolve out of order', async () => {
    let resolveInputs!: (sheet: ReturnType<typeof creationReceipt>) => void;
    let resolveOutputs!: (sheet: ReturnType<typeof creationReceipt>) => void;
    const inputs = new Promise<ReturnType<typeof creationReceipt>>((done) => { resolveInputs = done; });
    const outputs = new Promise<ReturnType<typeof creationReceipt>>((done) => { resolveOutputs = done; });
    const firstCallback = vi.fn();
    const latestCallback = vi.fn();
    const apiClient = autosaveClient({ createSheet: vi.fn().mockImplementation(({ name }: { name: string }) => name === 'Inputs' ? inputs : outputs) });
    const { result } = renderHook(() => useWorkbookController({ apiClient, initialWorkbook: workbookWithSheets([]) }));
    act(() => {
      result.current.commands.createSheet('Inputs', { x: 24, y: 48 }, 1, firstCallback);
      result.current.commands.createSheet('Outputs', { x: 96, y: 144 }, 1, latestCallback);
    });
    expect(result.current.creatingFrames.map((frame) => frame.name)).toEqual(['Inputs', 'Outputs']);
    await act(async () => { resolveOutputs(creationReceipt(sheetDocument({ id: 'outputs', name: 'Outputs', position: { x: 96, y: 144 }, zIndex: 2 }))); await outputs; });
    expect(sheetsInOrder(result.current.workbook).map((sheet) => sheet.id)).toEqual(['outputs']);
    expect(result.current.creatingFrames.map((frame) => frame.name)).toEqual(['Inputs']);
    await act(async () => { resolveInputs(creationReceipt(positionedSheet('inputs', 'Inputs', { x: 24, y: 48 }))); await inputs; });
    await waitFor(() => expect(result.current.creatingFrames).toEqual([]));
    expect(sheetsInOrder(result.current.workbook).map((sheet) => sheet.id)).toEqual(['outputs', 'inputs']);
    expect(firstCallback).not.toHaveBeenCalled();
    expect(latestCallback).toHaveBeenCalledOnce();
  });
  it('installs authoritative functions and axes from the creation receipt', async () => {
    const old = positionedSheet('old', 'Old', { x: 0, y: 0 });
    const created = sheetDocument({ id: 'new', name: 'New', position: { x: 1, y: 1 }, zIndex: 2 });
    const serverOld = { ...old, content: { ...old.content, rows: ['server-row'] } };
    const receipt = creationReceipt(created, workbookWithSheets([serverOld]));
    receipt.workbook.functions = [{ identity: 'f', name: 'Fn', parameters: [], body: '=BROKEN(', bodyBindings: { old: '=old' as never, new: '=server' as never } }];
    const callback = vi.fn();
    const api = autosaveClient({ createSheet: vi.fn().mockResolvedValue(receipt) });
    const { result } = renderHook(() => useWorkbookController({ apiClient: api, initialWorkbook: workbookWithSheets([old]) }));
    act(() => { result.current.commands.createSheet('New', { x: 1, y: 1 }, 1, callback); });
    await waitFor(() => expect(callback).toHaveBeenCalledWith(created));
    expect(result.current.workbook.documents.old.content.rows).toEqual(['server-row']);
    expect(result.current.workbook.functions).toEqual(receipt.workbook.functions);
  });

  it('retains an ambiguous failure and cannot repost its name or erase it with another success', async () => {
    const callback = vi.fn();
    const created = sheetDocument({ id: 'ok', name: 'Other', zIndex: 2 });
    const api = autosaveClient({ createSheet: vi.fn().mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce(creationReceipt(created)) });
    const { result } = renderHook(() => useWorkbookController({ apiClient: api, initialWorkbook: workbookWithSheets([]) }));
    act(() => { result.current.commands.createSheet('Unknown', { x: 0, y: 0 }, 1, callback); });
    await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
    act(() => {
      expect(result.current.commands.createSheet('Unknown', { x: 0, y: 0 })).toEqual({ ok: false, reason: 'duplicate' });
      result.current.commands.createSheet('Other', { x: 0, y: 0 });
    });
    await waitFor(() => expect(result.current.workbook.documents.ok).toBeDefined());
    expect(result.current.saveStatus).toBe('failed');
    expect(result.current.creatingFrames.map((frame) => frame.name)).toEqual(['Unknown']);
    expect(callback).not.toHaveBeenCalled();
    expect(api.createSheet).toHaveBeenCalledTimes(2);
  });

  it('permits a fresh attempt after a definite rejection', async () => {
    const created = positionedSheet('new', 'New', { x: 0, y: 0 });
    const api = autosaveClient({ createSheet: vi.fn().mockRejectedValueOnce(new WorkbookApiError('rejected', 400, 'sheet-name-duplicate')).mockResolvedValueOnce(creationReceipt(created)) });
    const { result } = renderHook(() => useWorkbookController({ apiClient: api, initialWorkbook: workbookWithSheets([]) }));
    act(() => { result.current.commands.createSheet('New', { x: 0, y: 0 }); });
    await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
    act(() => { expect(result.current.commands.createSheet('New', { x: 0, y: 0 })).toMatchObject({ ok: true }); });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(result.current.workbook.documents.new).toEqual(created);
    expect(api.createSheet).toHaveBeenCalledTimes(2);
  });

});
