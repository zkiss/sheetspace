import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cellRawContent, findSheetById, sheetsInOrder } from './workbookQueries';
import { type SheetDocument } from './workbookModel';
import { useWorkbookController } from './useWorkbookController';
import { autosaveClient, deferred } from './test/apiClients';
import { positionedSheet, workbookWithSheets } from './test/workbookFactories';
import type { SheetRevisionResponse } from './workbookApi';

describe('useWorkbookController sheet creation', () => {
  it('keeps an in-flight create out of the canonical workbook', () => {
    const apiClient = autosaveClient({ createSheet: vi.fn().mockReturnValue(new Promise<SheetDocument>(() => undefined)) });
    const { result } = renderHook(() => useWorkbookController({ apiClient, initialWorkbook: workbookWithSheets([]) }));
    act(() => expect(result.current.commands.createSheet('Inputs', { x: 24, y: 48 })).toEqual({ ok: true, name: 'Inputs' }));
    expect(sheetsInOrder(result.current.workbook)).toEqual([]);
    expect(result.current.creatingFrames).toMatchObject([{ kind: 'creating', name: 'Inputs', position: { x: 24, y: 48 } }]);
  });

  it('persists edits to a saved sheet while another sheet creation remains unresolved', async () => {
    const existing = positionedSheet('sheet-saved', 'Saved', { x: 0, y: 0 });
    const createSave = deferred<SheetDocument>();
    const cellSave = deferred<SheetRevisionResponse>();
    const apiClient = autosaveClient({
      createSheet: vi.fn().mockReturnValue(createSave.promise),
      updateCellContent: vi.fn().mockReturnValue(cellSave.promise),
    });
    const { result } = renderHook(() => useWorkbookController({
      apiClient,
      initialWorkbook: workbookWithSheets([existing]),
    }));

    act(() => {
      result.current.commands.createSheet('Creating', { x: 24, y: 48 });
      result.current.commands.updateCellContent(existing.id, 'A1', 'Saved independently');
    });

    expect(apiClient.updateCellContent).toHaveBeenCalledWith(
      existing.id,
      'A1',
      'Saved independently',
      { revision: 0 },
    );
    expect(result.current.creatingFrames).toMatchObject([{ kind: 'creating', name: 'Creating' }]);
    expect(sheetsInOrder(result.current.workbook).map((sheet) => sheet.id)).toEqual([existing.id]);

    await act(async () => {
      cellSave.resolve({ sheetId: existing.id, revision: 1 });
      await cellSave.promise;
    });

    await waitFor(() => expect(findSheetById(result.current.workbook, existing.id)?.revision).toBe(1));
    expect(cellRawContent(findSheetById(result.current.workbook, existing.id)!, 'A1')).toBe(
      'Saved independently',
    );
    expect(apiClient.updateCellContent).toHaveBeenCalledTimes(1);
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
