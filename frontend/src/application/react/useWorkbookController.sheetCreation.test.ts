import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cellRawContent, findSheetById, sheetsInOrder } from '@workbook/read/queries';
import { type SheetDocument } from '@workbook/core/model';
import { useWorkbookController } from '@application/react/useWorkbookController';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { positionedSheet, workbookWithSheets } from '@test-support/workbookFactories';
import { workbookApi } from '@infrastructure/persistence/workbookApi';

describe('useWorkbookController sheet creation', () => {
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
    const createSave = deferred<SheetDocument>();
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
      createSave.resolve(positionedSheet('sheet-created', 'Creating', { x: 24, y: 48 }));
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
    let resolve!: (sheet: SheetDocument) => void;
    const pending = new Promise<SheetDocument>((done) => { resolve = done; });
    const apiClient = autosaveClient({ createSheet: vi.fn().mockReturnValue(pending) });
    const { result } = renderHook(() => useWorkbookController({ apiClient, initialWorkbook: workbookWithSheets([]) }));
    act(() => { result.current.commands.createSheet('Inputs', { x: 24, y: 48 }); });
    await act(async () => { resolve(returned); await pending; });
    await waitFor(() => expect(result.current.creatingFrames).toEqual([]));
    expect(sheetsInOrder(result.current.workbook)).toEqual([returned]);
  });

  it('discards a successful duplicate document returned by the server', async () => {
    const existing = positionedSheet('sheet-existing', 'Existing', { x: 0, y: 0 });
    const pending = deferred<SheetDocument>();
    const apiClient = autosaveClient({ createSheet: vi.fn().mockReturnValue(pending.promise) });
    const { result } = renderHook(() => useWorkbookController({ apiClient, initialWorkbook: workbookWithSheets([existing]) }));

    act(() => { result.current.commands.createSheet('New', { x: 24, y: 48 }); });
    await act(async () => {
      pending.resolve({ ...existing, name: 'Unexpected duplicate' });
      await pending.promise;
    });

    await waitFor(() => expect(result.current.creatingFrames).toEqual([]));
    expect(sheetsInOrder(result.current.workbook)).toEqual([existing]);
  });

  it('retains a local placeholder without persistence when autosave is disabled', () => {
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([]) }));

    act(() => { result.current.commands.createSheet('Local', { x: 1, y: 2 }); });

    expect(result.current.creatingFrames).toMatchObject([{ name: 'Local', position: { x: 1, y: 2 } }]);
    expect(result.current.saveStatus).toBe('saving');
  });

  it('uses the default create API when the partial client omits it', async () => {
    const returned = positionedSheet('default-created', 'Default', { x: 1, y: 2 });
    const request = vi.spyOn(workbookApi, 'createSheet').mockResolvedValue(returned);
    const { result } = renderHook(() => useWorkbookController({ apiClient: {}, initialWorkbook: workbookWithSheets([]) }));

    act(() => { result.current.commands.createSheet('Default', { x: 1, y: 2 }); });
    await waitFor(() => expect(result.current.creatingFrames).toEqual([]));

    expect(request).toHaveBeenCalledOnce();
    request.mockRestore();
  });

  it('removes a failed placeholder without changing saved sheets', async () => {
    const existing = positionedSheet('saved', 'Saved', { x: 0, y: 0 });
    const apiClient = autosaveClient({ createSheet: vi.fn().mockRejectedValue(new Error('failed')) });
    const { result } = renderHook(() => useWorkbookController({ apiClient, initialWorkbook: workbookWithSheets([existing]) }));
    act(() => { result.current.commands.createSheet('Inputs', { x: 24, y: 48 }); });
    await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
    expect(result.current.creatingFrames).toEqual([]);
    expect(sheetsInOrder(result.current.workbook)).toEqual([existing]);
  });

  it('matches concurrent creates by operation key when they resolve out of order', async () => {
    let resolveInputs!: (sheet: SheetDocument) => void;
    let resolveOutputs!: (sheet: SheetDocument) => void;
    const inputs = new Promise<SheetDocument>((done) => { resolveInputs = done; });
    const outputs = new Promise<SheetDocument>((done) => { resolveOutputs = done; });
    const apiClient = autosaveClient({ createSheet: vi.fn().mockImplementation(({ name }: { name: string }) => name === 'Inputs' ? inputs : outputs) });
    const { result } = renderHook(() => useWorkbookController({ apiClient, initialWorkbook: workbookWithSheets([]) }));
    act(() => {
      result.current.commands.createSheet('Inputs', { x: 24, y: 48 });
      result.current.commands.createSheet('Outputs', { x: 96, y: 144 });
    });
    expect(result.current.creatingFrames.map((frame) => frame.name)).toEqual(['Inputs', 'Outputs']);
    await act(async () => { resolveOutputs(positionedSheet('outputs', 'Outputs', { x: 96, y: 144 })); await outputs; });
    expect(sheetsInOrder(result.current.workbook).map((sheet) => sheet.id)).toEqual(['outputs']);
    expect(result.current.creatingFrames.map((frame) => frame.name)).toEqual(['Inputs']);
    await act(async () => { resolveInputs(positionedSheet('inputs', 'Inputs', { x: 24, y: 48 })); await inputs; });
    await waitFor(() => expect(result.current.creatingFrames).toEqual([]));
    expect(sheetsInOrder(result.current.workbook).map((sheet) => sheet.id)).toEqual(['outputs', 'inputs']);
  });
});
