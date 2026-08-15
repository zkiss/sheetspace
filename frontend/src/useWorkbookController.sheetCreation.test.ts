import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cellRawContent, sheetsInOrder, type SheetDocument } from './workbook';
import { useWorkbookController } from './useWorkbookController';
import { autosaveClient } from './test/apiClients';
import { positionedSheet, sheetDocument, workbookWithSheets } from './test/workbookFactories';

describe('useWorkbookController sheet creation', () => {
  it('creates sheets through a command and hides persistence details behind autosave', async () => {
    const savedSheet = positionedSheet('00000000-0000-4000-8000-000000000001', 'Inputs', { x: 24, y: 48 });
    const apiClient = autosaveClient({
      createSheet: vi.fn().mockResolvedValue(savedSheet),
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([]),
      }),
    );

    act(() => {
      const created = result.current.commands.createSheet('Inputs', { x: 24, y: 48 });
      expect(created.ok).toBe(true);
    });

    expect(sheetsInOrder(result.current.workbook)).toHaveLength(1);
    expect(sheetsInOrder(result.current.workbook)[0].id).toMatch(/^pending:[0-9a-f-]+$/);
    await waitFor(() => expect(apiClient.createSheet).toHaveBeenCalledWith({
      name: 'Inputs',
      position: { x: 24, y: 48 },
    }));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(sheetsInOrder(result.current.workbook)).toHaveLength(1);
    expect(sheetsInOrder(result.current.workbook)[0]).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Inputs',
      frame: { position: { x: 24, y: 48 } },
    });
  });

  it('preserves optimistic edits to existing sheets when a created sheet response arrives', async () => {
    const existingSheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 });
    const savedCreatedSheet = positionedSheet('00000000-0000-4000-8000-000000000001', 'Outputs', { x: 24, y: 48 });
    let resolveCreate!: (sheet: SheetDocument) => void;
    const createSheetSave = new Promise<SheetDocument>((resolve) => {
      resolveCreate = resolve;
    });
    const apiClient = autosaveClient({
      createSheet: vi.fn().mockReturnValue(createSheetSave),
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([existingSheet]),
      }),
    );

    act(() => {
      result.current.commands.createSheet('Outputs', { x: 24, y: 48 });
    });
    await waitFor(() => expect(sheetsInOrder(result.current.workbook)).toHaveLength(2));
    act(() => {
      result.current.commands.updateCellContent('sheet-inputs', 'A1', 'Local value');
    });

    await act(async () => {
      resolveCreate(savedCreatedSheet);
      await createSheetSave;
    });

    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(sheetsInOrder(result.current.workbook)).toHaveLength(2);
    expect(cellRawContent(sheetsInOrder(result.current.workbook)[0], 'A1')).toEqual('Local value');
    expect(sheetsInOrder(result.current.workbook)[1].id).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('rejects a duplicate sheet create while the first request is pending', async () => {
    const savedSheet = positionedSheet('00000000-0000-4000-8000-000000000001', 'Inputs', { x: 24, y: 48 });
    let resolveCreate!: (sheet: SheetDocument) => void;
    const createSheetSave = new Promise<SheetDocument>((resolve) => {
      resolveCreate = resolve;
    });
    const apiClient = autosaveClient({
      createSheet: vi.fn().mockReturnValue(createSheetSave),
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([]),
      }),
    );

    act(() => {
      expect(result.current.commands.createSheet('Inputs', { x: 24, y: 48 })).toEqual({ ok: true, name: 'Inputs' });
      expect(result.current.commands.createSheet(' Inputs ', { x: 96, y: 144 })).toEqual({
        ok: false,
        reason: 'duplicate',
      });
    });

    await waitFor(() => expect(apiClient.createSheet).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolveCreate(savedSheet);
      await createSheetSave;
    });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  });

  it('creates unique local pending ids for concurrent optimistic sheets', () => {
    const apiClient = autosaveClient({
      createSheet: vi.fn().mockReturnValue(new Promise<SheetDocument>(() => undefined)),
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([]),
      }),
    );

    act(() => {
      result.current.commands.createSheet('Inputs', { x: 24, y: 48 });
      result.current.commands.createSheet('Outputs', { x: 96, y: 144 });
    });

    const sheetIds = sheetsInOrder(result.current.workbook).map((sheet) => sheet.id);
    expect(sheetIds).toHaveLength(2);
    expect(new Set(sheetIds).size).toBe(2);
    expect(sheetIds).toEqual([expect.stringMatching(/^pending:[0-9a-f-]+$/), expect.stringMatching(/^pending:[0-9a-f-]+$/)]);
    expect(sheetIds).not.toContain('pending:');
  });

  it('remaps concurrent creates without duplicating durable sheets when responses resolve out of order', async () => {
    const savedInputs = positionedSheet('00000000-0000-4000-8000-000000000001', 'Inputs', { x: 24, y: 48 });
    const savedOutputs = sheetDocument({
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Outputs',
      position: { x: 96, y: 144 },
      zIndex: 2,
    });
    let resolveInputs!: (sheet: SheetDocument) => void;
    let resolveOutputs!: (sheet: SheetDocument) => void;
    const inputsSave = new Promise<SheetDocument>((resolve) => {
      resolveInputs = resolve;
    });
    const outputsSave = new Promise<SheetDocument>((resolve) => {
      resolveOutputs = resolve;
    });
    const apiClient = autosaveClient({
      createSheet: vi.fn().mockImplementation(({ name }: { name: string }) =>
        name === 'Inputs' ? inputsSave : outputsSave,
      ),
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([]),
      }),
    );

    act(() => {
      result.current.commands.createSheet('Inputs', { x: 24, y: 48 });
      result.current.commands.createSheet('Outputs', { x: 96, y: 144 });
    });
    await waitFor(() => expect(apiClient.createSheet).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveOutputs(savedOutputs);
      await outputsSave;
    });
    expect(sheetsInOrder(result.current.workbook).map((sheet) => sheet.name)).toEqual(['Inputs', 'Outputs']);
    expect(sheetsInOrder(result.current.workbook).find((sheet) => sheet.name === 'Inputs')?.id).toMatch(/^pending:/);
    expect(sheetsInOrder(result.current.workbook).find((sheet) => sheet.name === 'Outputs')?.id).toBe(savedOutputs.id);

    await act(async () => {
      resolveInputs(savedInputs);
      await inputsSave;
    });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(sheetsInOrder(result.current.workbook)).toEqual([savedInputs, savedOutputs]);
  });

  it('does not append a durable duplicate when a concurrent pending sheet was renamed locally', async () => {
    const savedInputs = positionedSheet('00000000-0000-4000-8000-000000000001', 'Inputs', { x: 24, y: 48 });
    const savedOutputs = sheetDocument({
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Outputs',
      position: { x: 96, y: 144 },
      zIndex: 2,
    });
    let resolveInputs!: (sheet: SheetDocument) => void;
    let resolveOutputs!: (sheet: SheetDocument) => void;
    const inputsSave = new Promise<SheetDocument>((resolve) => {
      resolveInputs = resolve;
    });
    const outputsSave = new Promise<SheetDocument>((resolve) => {
      resolveOutputs = resolve;
    });
    const apiClient = autosaveClient({
      createSheet: vi.fn().mockImplementation(({ name }: { name: string }) =>
        name === 'Inputs' ? inputsSave : outputsSave,
      ),
      renameSheet: vi.fn().mockResolvedValue({ sheetId: savedInputs.id, revision: 1 }),
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([]),
      }),
    );

    act(() => {
      result.current.commands.createSheet('Inputs', { x: 24, y: 48 });
      result.current.commands.createSheet('Outputs', { x: 96, y: 144 });
    });
    const pendingInputsId = sheetsInOrder(result.current.workbook).find((sheet) => sheet.name === 'Inputs')!.id;
    act(() => {
      result.current.commands.renameSheet(pendingInputsId, 'Data');
    });
    await waitFor(() => expect(apiClient.createSheet).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveOutputs(savedOutputs);
      await outputsSave;
    });
    expect(sheetsInOrder(result.current.workbook).map((sheet) => sheet.name)).toEqual(['Data', 'Outputs']);

    await act(async () => {
      resolveInputs(savedInputs);
      await inputsSave;
    });
    await waitFor(() => expect(apiClient.renameSheet).toHaveBeenCalledWith(savedInputs.id, 'Data', { revision: 0 }));
    expect(sheetsInOrder(result.current.workbook).map((sheet) => sheet.id)).toEqual([savedInputs.id, savedOutputs.id]);
  });

  it('does not append a tombstoned concurrent create while compensating deletion is pending', async () => {
    const savedInputs = positionedSheet('00000000-0000-4000-8000-000000000001', 'Inputs', { x: 24, y: 48 });
    const savedOutputs = sheetDocument({
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Outputs',
      position: { x: 96, y: 144 },
      zIndex: 2,
    });
    let resolveInputs!: (sheet: SheetDocument) => void;
    let resolveOutputs!: (sheet: SheetDocument) => void;
    const inputsSave = new Promise<SheetDocument>((resolve) => {
      resolveInputs = resolve;
    });
    const outputsSave = new Promise<SheetDocument>((resolve) => {
      resolveOutputs = resolve;
    });
    const deleteSave = new Promise<void>(() => undefined);
    const apiClient = autosaveClient({
      createSheet: vi.fn().mockImplementation(({ name }: { name: string }) =>
        name === 'Inputs' ? inputsSave : outputsSave,
      ),
      deleteSheet: vi.fn().mockReturnValue(deleteSave),
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([]),
      }),
    );

    act(() => {
      result.current.commands.createSheet('Inputs', { x: 24, y: 48 });
      result.current.commands.createSheet('Outputs', { x: 96, y: 144 });
    });
    await waitFor(() => expect(apiClient.createSheet).toHaveBeenCalledTimes(2));
    const pendingInputsId = sheetsInOrder(result.current.workbook).find((sheet) => sheet.name === 'Inputs')!.id;
    act(() => {
      result.current.commands.deletePendingSheet(pendingInputsId);
    });

    await act(async () => {
      resolveOutputs(savedOutputs);
      await outputsSave;
    });
    expect(sheetsInOrder(result.current.workbook)).toEqual([savedOutputs]);

    await act(async () => {
      resolveInputs(savedInputs);
      await inputsSave;
    });
    await waitFor(() => expect(apiClient.deleteSheet).toHaveBeenCalledWith(savedInputs.id, { revision: 0 }));
    expect(sheetsInOrder(result.current.workbook)).toEqual([savedOutputs]);
  });

});
