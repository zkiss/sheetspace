import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  cellRawContent,
  findSheetById,
  sheetBounds,
  sheetsInOrder,
  type SheetDocument,
} from './workbook';
import { WorkbookApiError } from './workbookApi';
import { useWorkbookController } from './useWorkbookController';
import { autosaveClient, deferred } from './test/apiClients';
import { positionedSheet, sheetDocument, workbookWithSheets } from './test/workbookFactories';

function documentWithCells(
  document: SheetDocument,
  cells: Record<string, string>,
  revision = document.revision,
): SheetDocument {
  const bounds = sheetBounds(document);
  return sheetDocument({
    id: document.id,
    name: document.name,
    position: document.frame.position,
    frameSize: document.frame.size,
    zIndex: document.frame.zIndex,
    revision,
    rowCount: bounds.rowCount,
    columnCount: bounds.columnCount,
    cells,
  });
}

describe('useWorkbookController', () => {
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

  it('queues pending sheet mutations until create resolves and sends them with the backend id', async () => {
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
      result.current.commands.createSheet('Inputs', { x: 24, y: 48 });
    });
    const pendingSheetId = sheetsInOrder(result.current.workbook)[0].id;
    act(() => {
      result.current.commands.updateCellContent(pendingSheetId, 'A1', 'Local value');
    });

    expect(apiClient.updateCellContent).not.toHaveBeenCalled();
    await act(async () => {
      resolveCreate(savedSheet);
      await createSheetSave;
    });

    await waitFor(() =>
      expect(apiClient.updateCellContent).toHaveBeenCalledWith(savedSheet.id, 'A1', 'Local value', {
        revision: 0,
      }),
    );
    expect(sheetsInOrder(result.current.workbook)[0].id).toBe(savedSheet.id);
    expect(cellRawContent(sheetsInOrder(result.current.workbook)[0], 'A1')).toBe('Local value');
  });

  it('defers malformed formula saves with a later pending-sheet reference until the target has a backend id', async () => {
    const outputs = positionedSheet('sheet-outputs', 'Outputs', { x: 0, y: 0 });
    const savedInputs = positionedSheet('00000000-0000-4000-8000-000000000001', '📈 Plan', { x: 24, y: 48 });
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
        initialWorkbook: workbookWithSheets([outputs]),
      }),
    );

    act(() => {
      result.current.commands.createSheet('📈 Plan', { x: 24, y: 48 });
    });
    const pendingInputsId = sheetsInOrder(result.current.workbook).find((sheet) => sheet.name === '📈 Plan')!.id;
    act(() => {
      result.current.commands.updateCellContent('sheet-outputs', 'A1', "=SUM(A1,) + '📈 Plan'!A1");
    });

    expect(cellRawContent(sheetsInOrder(result.current.workbook)[0], 'A1')).toBe(`=SUM(A1,) + ${pendingInputsId}!A1`);
    expect(apiClient.updateCellContent).not.toHaveBeenCalled();

    await act(async () => {
      resolveCreate(savedInputs);
      await createSheetSave;
    });

    await waitFor(() =>
      expect(apiClient.updateCellContent).toHaveBeenCalledWith(
        'sheet-outputs',
        'A1',
        `=SUM(A1,) + ${savedInputs.id}!A1`,
        { revision: 0 },
      ),
    );
  });

  it('saves formulas that reference a deleted pending sheet as broken references', async () => {
    const outputs = positionedSheet('sheet-outputs', 'Outputs', { x: 0, y: 0 });
    const savedInputs = positionedSheet('00000000-0000-4000-8000-000000000001', 'Inputs', { x: 24, y: 48 });
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
        initialWorkbook: workbookWithSheets([outputs]),
      }),
    );

    act(() => {
      result.current.commands.createSheet('Inputs', { x: 24, y: 48 });
    });
    await waitFor(() => expect(apiClient.createSheet).toHaveBeenCalledTimes(1));
    const pendingInputsId = sheetsInOrder(result.current.workbook).find((sheet) => sheet.name === 'Inputs')!.id;
    act(() => {
      result.current.commands.updateCellContent('sheet-outputs', 'A1', '=SUM(Inputs!A1)');
      result.current.commands.deletePendingSheet(pendingInputsId);
    });

    await waitFor(() =>
      expect(apiClient.updateCellContent).toHaveBeenCalledWith('sheet-outputs', 'A1', '=SUM(#REF!A1)', {
        revision: 0,
      }),
    );
    expect(result.current.formulaResults['sheet-outputs'].A1).toMatchObject({ kind: 'error', error: '#REF!' });

    await act(async () => {
      resolveCreate(savedInputs);
      await createSheetSave;
    });
    await waitFor(() => expect(apiClient.deleteSheet).toHaveBeenCalledWith(savedInputs.id, { revision: 0 }));
  });

  it('saves formulas that reference a failed pending sheet as broken references', async () => {
    const outputs = positionedSheet('sheet-outputs', 'Outputs', { x: 0, y: 0 });
    let rejectCreate!: (cause: unknown) => void;
    const createSheetSave = new Promise<SheetDocument>((_, reject) => {
      rejectCreate = reject;
    });
    const apiClient = autosaveClient({
      createSheet: vi.fn().mockReturnValue(createSheetSave),
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([outputs]),
      }),
    );

    act(() => {
      result.current.commands.createSheet('Inputs', { x: 24, y: 48 });
    });
    await waitFor(() => expect(apiClient.createSheet).toHaveBeenCalledTimes(1));
    const pendingInputsId = sheetsInOrder(result.current.workbook).find((sheet) => sheet.name === 'Inputs')!.id;
    act(() => {
      result.current.commands.updateCellContent('sheet-outputs', 'A1', '=SUM(Inputs!A1)');
    });

    expect(cellRawContent(sheetsInOrder(result.current.workbook)[0], 'A1')).toBe(`=SUM(${pendingInputsId}!A1)`);
    expect(apiClient.updateCellContent).not.toHaveBeenCalled();

    await act(async () => {
      rejectCreate(new Error('backend unavailable'));
      await createSheetSave.catch(() => undefined);
    });

    await waitFor(() =>
      expect(apiClient.updateCellContent).toHaveBeenCalledWith('sheet-outputs', 'A1', '=SUM(#REF!A1)', {
        revision: 0,
      }),
    );
    expect(sheetsInOrder(result.current.workbook)).toHaveLength(1);
    expect(cellRawContent(sheetsInOrder(result.current.workbook)[0], 'A1')).toBe('=SUM(#REF!A1)');
    expect(result.current.formulaResults['sheet-outputs'].A1).toMatchObject({ kind: 'error', error: '#REF!' });
  });

  it('preserves pending frame layout changes while saving them with the backend id', async () => {
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
      result.current.commands.createSheet('Inputs', { x: 24, y: 48 });
    });
    const pendingSheetId = sheetsInOrder(result.current.workbook)[0].id;
    act(() => {
      result.current.commands.moveSheetFrame(pendingSheetId, { x: 96, y: 144 });
    });

    expect(apiClient.updateSheetPosition).not.toHaveBeenCalled();
    await act(async () => {
      resolveCreate(savedSheet);
      await createSheetSave;
    });

    await waitFor(() =>
      expect(apiClient.updateSheetPosition).toHaveBeenCalledWith(savedSheet.id, { x: 96, y: 144 }, { revision: 0 }),
    );
    expect(sheetsInOrder(result.current.workbook)[0]).toMatchObject({
      id: savedSheet.id,
      frame: { position: { x: 96, y: 144 } },
    });
  });

  it('drops a pending sheet and its queued work when deleted before create resolves', async () => {
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
      result.current.commands.createSheet('Inputs', { x: 24, y: 48 });
    });
    const pendingSheetId = sheetsInOrder(result.current.workbook)[0].id;
    act(() => {
      result.current.commands.updateCellContent(pendingSheetId, 'A1', 'obsolete');
      result.current.commands.deletePendingSheet(pendingSheetId);
    });

    await act(async () => {
      resolveCreate(savedSheet);
      await createSheetSave;
    });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(sheetsInOrder(result.current.workbook)).toHaveLength(0);
    expect(apiClient.updateCellContent).not.toHaveBeenCalled();
  });

  it('does not resurrect a deleted pending sheet or send stale work after an in-flight create resolves', async () => {
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
      result.current.commands.createSheet('Inputs', { x: 24, y: 48 });
    });
    await waitFor(() => expect(apiClient.createSheet).toHaveBeenCalledTimes(1));
    const pendingSheetId = sheetsInOrder(result.current.workbook)[0].id;
    act(() => {
      result.current.commands.updateCellContent(pendingSheetId, 'A1', 'obsolete');
      result.current.commands.deletePendingSheet(pendingSheetId);
    });

    await act(async () => {
      resolveCreate(savedSheet);
      await createSheetSave;
    });

    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(sheetsInOrder(result.current.workbook)).toHaveLength(0);
    expect(apiClient.updateCellContent).not.toHaveBeenCalled();
    expect(apiClient.deleteSheet).toHaveBeenCalledWith(savedSheet.id, { revision: 0 });
  });

  it('removes an optimistic sheet after create fails', async () => {
    const apiClient = autosaveClient({
      createSheet: vi.fn().mockRejectedValue(new Error('backend unavailable')),
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([]),
      }),
    );

    act(() => {
      result.current.commands.createSheet('Inputs', { x: 24, y: 48 });
    });

    expect(sheetsInOrder(result.current.workbook)).toHaveLength(1);
    await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
    expect(sheetsInOrder(result.current.workbook)).toHaveLength(0);
  });

  it('drops queued pending mutations after create fails', async () => {
    let rejectCreate!: (cause: unknown) => void;
    const createSheetSave = new Promise<SheetDocument>((_, reject) => {
      rejectCreate = reject;
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
      result.current.commands.createSheet('Inputs', { x: 24, y: 48 });
    });
    const pendingSheetId = sheetsInOrder(result.current.workbook)[0].id;
    act(() => {
      result.current.commands.updateCellContent(pendingSheetId, 'A1', 'first');
    });
    act(() => {
      result.current.commands.updateCellContent(pendingSheetId, 'A1', 'latest');
    });

    await act(async () => {
      rejectCreate(new Error('backend unavailable'));
      await createSheetSave.catch(() => undefined);
    });

    await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
    expect(sheetsInOrder(result.current.workbook)).toHaveLength(0);
    expect(apiClient.updateCellContent).not.toHaveBeenCalled();
  });

  it('clears a failed create status when retrying the same sheet name succeeds', async () => {
    const savedSheet = positionedSheet('00000000-0000-4000-8000-000000000001', 'Inputs', { x: 24, y: 48 });
    const apiClient = autosaveClient({
      createSheet: vi.fn()
        .mockRejectedValueOnce(new Error('backend unavailable'))
        .mockResolvedValueOnce(savedSheet),
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([]),
      }),
    );

    act(() => {
      result.current.commands.createSheet('Inputs', { x: 24, y: 48 });
    });
    await waitFor(() => expect(result.current.saveStatus).toBe('failed'));

    act(() => {
      result.current.commands.createSheet('Inputs', { x: 24, y: 48 });
    });

    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(sheetsInOrder(result.current.workbook)).toEqual([savedSheet]);
  });

  it('keeps frame changes outside calculation and persists only committed frame commands', () => {
    const apiClient = autosaveClient();
    const sheet = sheetDocument({
      id: 'sheet-inputs',
      name: 'Inputs',
      position: { x: 10, y: 20 },
      cells: { A1: '=1' },
    });
    const calculate = vi.fn();
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        calculationObserver: calculate,
        initialWorkbook: workbookWithSheets([sheet]),
      }),
    );
    const initialResults = result.current.formulaResults;
    const initialContent = findSheetById(result.current.workbook, 'sheet-inputs')!.content;
    expect(calculate).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.commands.previewSheetFrameLayout('sheet-inputs', { x: 30, y: 40 });
    });

    expect(findSheetById(result.current.workbook, 'sheet-inputs')?.frame.position).toEqual({ x: 30, y: 40 });
    expect(apiClient.updateSheetPosition).not.toHaveBeenCalled();
    expect(findSheetById(result.current.workbook, 'sheet-inputs')!.content).toBe(initialContent);
    expect(result.current.formulaResults).toBe(initialResults);
    expect(calculate).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.commands.moveSheetFrame('sheet-inputs', { x: 50, y: 60 });
    });

    expect(findSheetById(result.current.workbook, 'sheet-inputs')?.frame.position).toEqual({ x: 50, y: 60 });
    expect(apiClient.updateSheetPosition).toHaveBeenCalledWith('sheet-inputs', { x: 50, y: 60 }, { revision: 0 });
    expect(findSheetById(result.current.workbook, 'sheet-inputs')!.content).toBe(initialContent);
    expect(result.current.formulaResults).toBe(initialResults);
    expect(findSheetById(result.current.workbook, 'sheet-inputs')!.content).toBe(initialContent);
    expect(calculate).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.commands.resizeSheetFrame(
        'sheet-inputs',
        { x: 50, y: 60 },
        { width: 400, height: 300 },
      );
      result.current.commands.changeSheetZOrder('sheet-inputs', 'top');
    });

    expect(result.current.formulaResults).toBe(initialResults);
    expect(calculate).toHaveBeenCalledTimes(1);
  });

  it('updates cells through a command and derives formula display results from workbook state', () => {
    const apiClient = autosaveClient();
    const calculate = vi.fn();
    const sheet = sheetDocument({
      id: 'sheet-inputs',
      name: 'Inputs',
      cells: { B1: '=SUM(A1)' },
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        calculationObserver: calculate,
        initialWorkbook: workbookWithSheets([sheet]),
      }),
    );

    act(() => {
      result.current.commands.updateCellContent('sheet-inputs', 'A1', '7');
    });

    expect(cellRawContent(findSheetById(result.current.workbook, 'sheet-inputs')!, 'A1')).toEqual('7');
    expect(result.current.formulaResults['sheet-inputs'].B1.display).toBe('7');
    expect(calculate).toHaveBeenLastCalledWith({
        kind: 'cells',
        cells: [{ sheetId: 'sheet-inputs', key: 'A1' }],
    });
    expect(apiClient.updateCellContent).toHaveBeenCalledWith('sheet-inputs', 'A1', '7', { revision: 0 });
  });

  it('uses one current transition for batched change-then-restore cell actions', async () => {
    const apiClient = autosaveClient();
    const calculate = vi.fn();
    const sheet = sheetDocument({
      id: 'sheet-inputs',
      name: 'Inputs',
      cells: { B1: '=SUM(A1)' },
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        calculationObserver: calculate,
        initialWorkbook: workbookWithSheets([sheet]),
      }),
    );

    act(() => {
      result.current.commands.updateCellContent('sheet-inputs', 'A1', '7');
      result.current.commands.updateCellContent('sheet-inputs', 'A1', '');
    });

    expect(cellRawContent(findSheetById(result.current.workbook, 'sheet-inputs')!, 'A1')).toBeUndefined();
    expect(result.current.formulaResults['sheet-inputs'].B1.display).toBe('0');
    expect(calculate).toHaveBeenLastCalledWith({
      kind: 'cells',
      cells: [{ sheetId: 'sheet-inputs', key: 'A1' }],
    });
    await waitFor(() => expect(apiClient.updateCellContent).toHaveBeenCalledTimes(2));
    expect(apiClient.updateCellContent).toHaveBeenNthCalledWith(1, 'sheet-inputs', 'A1', '7', { revision: 0 });
    expect(apiClient.updateCellContent).toHaveBeenNthCalledWith(2, 'sheet-inputs', 'A1', '', { revision: 0 });
  });

  it('keeps local committed cell edits while retrying a conflicting revisioned autosave', async () => {
    const initialSheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 });
    const staleServerSheet = documentWithCells(initialSheet, { A1: 'server value' }, 4);
    const savedServerSheet = documentWithCells(initialSheet, { A1: 'Local value' }, 5);
    const apiClient = autosaveClient({
      loadSheet: vi.fn().mockResolvedValue(staleServerSheet),
      updateCellContent: vi
        .fn()
        .mockRejectedValueOnce(new WorkbookApiError('sheet-revision-conflict', 409, 'sheet-revision-conflict'))
        .mockResolvedValueOnce({ sheetId: savedServerSheet.id, revision: savedServerSheet.revision }),
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([initialSheet]),
      }),
    );

    act(() => {
      result.current.commands.updateCellContent('sheet-inputs', 'A1', 'Local value');
    });

    await waitFor(() => expect(apiClient.updateCellContent).toHaveBeenCalledTimes(2));
    expect(apiClient.updateCellContent).toHaveBeenNthCalledWith(1, 'sheet-inputs', 'A1', 'Local value', {
      revision: 0,
    });
    expect(apiClient.loadSheet).toHaveBeenCalledWith('sheet-inputs');
    expect(apiClient.updateCellContent).toHaveBeenNthCalledWith(2, 'sheet-inputs', 'A1', 'Local value', {
      revision: 4,
    });
    expect(cellRawContent(findSheetById(result.current.workbook, 'sheet-inputs')!, 'A1')).toEqual('Local value');
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  });

  it('deletes saved sheets optimistically and persists deletion with the current revision token', async () => {
    const deletedSheet = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 10, y: 20 }), revision: 4 };
    const remainingSheet = { ...positionedSheet('sheet-outputs', 'Outputs', { x: 300, y: 20 }), revision: 6 };
    const apiClient = autosaveClient({
      deleteSheet: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([deletedSheet, remainingSheet]),
      }),
    );

    act(() => {
      result.current.commands.deleteSheet('sheet-inputs');
    });

    expect(sheetsInOrder(result.current.workbook).map((sheet) => sheet.id)).toEqual(['sheet-outputs']);
    await waitFor(() => expect(apiClient.deleteSheet).toHaveBeenCalledWith('sheet-inputs', { revision: 4 }));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  });

  it('drops queued saved-sheet mutations and waits for running saves before deleting', async () => {
    const initialSheet = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 }), revision: 0 };
    let resolveRunningSave!: (response: { sheetId: string; revision: number }) => void;
    const runningSave = new Promise<{ sheetId: string; revision: number }>((resolve) => {
      resolveRunningSave = resolve;
    });
    let resolveDeleteSave!: () => void;
    const deleteSave = new Promise<void>((resolve) => {
      resolveDeleteSave = resolve;
    });
    const apiClient = autosaveClient({
      updateCellContent: vi.fn().mockReturnValue(runningSave),
      deleteSheet: vi.fn().mockReturnValue(deleteSave),
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([initialSheet]),
      }),
    );

    act(() => {
      result.current.commands.updateCellContent('sheet-inputs', 'A1', 'first');
      result.current.commands.updateCellContent('sheet-inputs', 'A1', 'second');
      result.current.commands.deleteSheet('sheet-inputs');
    });

    expect(sheetsInOrder(result.current.workbook)).toHaveLength(0);
    expect(apiClient.updateCellContent).toHaveBeenCalledTimes(1);
    expect(apiClient.deleteSheet).not.toHaveBeenCalled();

    await act(async () => {
      resolveRunningSave({ sheetId: initialSheet.id, revision: 1 });
      await runningSave;
    });

    await waitFor(() => expect(apiClient.deleteSheet).toHaveBeenCalledWith('sheet-inputs', { revision: 1 }));
    expect(apiClient.updateCellContent).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDeleteSave();
      await deleteSave;
    });

    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  });

  it('preserves unrelated queued mutations when deleting a saved sheet', async () => {
    const inputs = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 }), revision: 0 };
    const outputs = { ...positionedSheet('sheet-outputs', 'Outputs', { x: 300, y: 0 }), revision: 0 };
    let resolveFirstOutputSave!: (response: { sheetId: string; revision: number }) => void;
    const firstOutputSave = new Promise<{ sheetId: string; revision: number }>((resolve) => {
      resolveFirstOutputSave = resolve;
    });
    let resolveLatestOutputSave!: (response: { sheetId: string; revision: number }) => void;
    const latestOutputSave = new Promise<{ sheetId: string; revision: number }>((resolve) => {
      resolveLatestOutputSave = resolve;
    });
    let resolveDeleteSave!: () => void;
    const deleteSave = new Promise<void>((resolve) => {
      resolveDeleteSave = resolve;
    });
    const apiClient = autosaveClient({
      updateCellContent: vi.fn().mockReturnValueOnce(firstOutputSave).mockReturnValueOnce(latestOutputSave),
      deleteSheet: vi.fn().mockReturnValue(deleteSave),
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([inputs, outputs]),
      }),
    );

    act(() => {
      result.current.commands.updateCellContent('sheet-outputs', 'A1', 'first');
      result.current.commands.updateCellContent('sheet-outputs', 'A1', 'latest');
      result.current.commands.deleteSheet('sheet-inputs');
    });

    expect(sheetsInOrder(result.current.workbook).map((sheet) => sheet.id)).toEqual(['sheet-outputs']);
    expect(apiClient.updateCellContent).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(apiClient.deleteSheet).toHaveBeenCalledWith('sheet-inputs', { revision: 0 }));

    await act(async () => {
      resolveDeleteSave();
      await deleteSave;
    });
    expect(result.current.saveStatus).toBe('saving');

    await act(async () => {
      resolveFirstOutputSave({ sheetId: outputs.id, revision: 1 });
      await firstOutputSave;
    });
    await waitFor(() =>
      expect(apiClient.updateCellContent).toHaveBeenNthCalledWith(2, 'sheet-outputs', 'A1', 'latest', { revision: 1 }),
    );

    await act(async () => {
      resolveLatestOutputSave({ sheetId: outputs.id, revision: 2 });
      await latestOutputSave;
    });

    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(sheetsInOrder(result.current.workbook)).toEqual([
      sheetDocument({
        id: outputs.id,
        name: outputs.name,
        position: outputs.frame.position,
        revision: 2,
        cells: { A1: 'latest' },
      }),
    ]);
  });

  it('waits for affected atomic z-order persistence before deleting a sheet', async () => {
    const zOrderSave = deferred<{ sheets: Array<{ sheetId: string; revision: number }> }>();
    const deleteSheet = vi.fn().mockResolvedValue(undefined);
    const apiClient = autosaveClient({
      updateSheetZOrder: vi.fn().mockReturnValue(zOrderSave.promise),
      deleteSheet,
    });
    const inputs = sheetDocument({ id: 'sheet-inputs', name: 'Inputs', zIndex: 1 });
    const outputs = sheetDocument({ id: 'sheet-outputs', name: 'Outputs', zIndex: 2 });
    const { result } = renderHook(() =>
      useWorkbookController({ apiClient, initialWorkbook: workbookWithSheets([inputs, outputs]) }),
    );

    act(() => {
      result.current.commands.changeSheetZOrder(inputs.id, 'up');
      result.current.commands.deleteSheet(inputs.id);
    });

    expect(apiClient.updateSheetZOrder).toHaveBeenCalledTimes(1);
    expect(deleteSheet).not.toHaveBeenCalled();

    zOrderSave.resolve({
      sheets: [
        { sheetId: inputs.id, revision: 1 },
        { sheetId: outputs.id, revision: 1 },
      ],
    });
    await waitFor(() => expect(deleteSheet).toHaveBeenCalledWith(inputs.id, { revision: 1 }));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  });

  it('renames sheets through autosave with the current revision token', () => {
    const apiClient = autosaveClient();
    const sheet = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 10, y: 20 }), revision: 4 };
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([sheet]),
      }),
    );

    act(() => {
      const renamed = result.current.commands.renameSheet('sheet-inputs', 'Renamed Inputs');
      expect(renamed.ok).toBe(true);
    });

    expect(findSheetById(result.current.workbook, 'sheet-inputs')?.name).toBe('Renamed Inputs');
    expect(apiClient.renameSheet).toHaveBeenCalledWith('sheet-inputs', 'Renamed Inputs', { revision: 4 });
  });

  it('appends rows and columns through autosave with revision tokens', () => {
    const apiClient = autosaveClient();
    const sheet = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 10, y: 20 }), revision: 5 };
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([sheet]),
      }),
    );

    act(() => {
      result.current.commands.appendRow('sheet-inputs');
    });
    act(() => {
      result.current.commands.appendColumn('sheet-inputs');
    });

    expect(sheetBounds(findSheetById(result.current.workbook, 'sheet-inputs')!)).toEqual({
      rowCount: 21,
      columnCount: 11,
    });
    expect(apiClient.appendRow).toHaveBeenCalledWith('sheet-inputs', { revision: 5 });
    expect(apiClient.appendColumn).toHaveBeenCalledWith('sheet-inputs', { revision: 5 });
  });

  it('persists committed frame size and anchored position together', () => {
    const apiClient = autosaveClient();
    const sheet = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }), revision: 6 };
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([sheet]),
      }),
    );

    act(() => {
      result.current.commands.resizeSheetFrame('sheet-inputs', { x: 180, y: 80 }, { width: 180, height: 160 });
    });

    expect(findSheetById(result.current.workbook, 'sheet-inputs')).toMatchObject({
      frame: {
        size: { width: 180, height: 160 },
        position: { x: 180, y: 80 },
      },
    });
    expect(apiClient.updateSheetFrameLayout).toHaveBeenCalledWith(
      'sheet-inputs',
      { x: 180, y: 80 },
      { width: 180, height: 160 },
      { revision: 6 },
    );
  });

  it.each(['move-then-resize', 'resize-then-move'] as const)(
    'orders overlapping frame writes for %s',
    async (commandOrder) => {
      const firstSave = deferred<{ sheetId: string; revision: number }>();
      const secondSave = deferred<{ sheetId: string; revision: number }>();
      const updateSheetPosition = vi.fn().mockReturnValue(
        commandOrder === 'move-then-resize' ? firstSave.promise : secondSave.promise,
      );
      const updateSheetFrameLayout = vi.fn().mockReturnValue(
        commandOrder === 'resize-then-move' ? firstSave.promise : secondSave.promise,
      );
      const apiClient = autosaveClient({
        updateSheetPosition,
        updateSheetFrameLayout,
      });
      const sheet = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }), revision: 6 };
      const { result } = renderHook(() =>
        useWorkbookController({ apiClient, initialWorkbook: workbookWithSheets([sheet]) }),
      );

      act(() => {
        if (commandOrder === 'move-then-resize') {
          result.current.commands.moveSheetFrame(sheet.id, { x: 140, y: 90 });
          result.current.commands.resizeSheetFrame(sheet.id, { x: 180, y: 80 }, { width: 180, height: 160 });
        } else {
          result.current.commands.resizeSheetFrame(sheet.id, { x: 180, y: 80 }, { width: 180, height: 160 });
          result.current.commands.moveSheetFrame(sheet.id, { x: 140, y: 90 });
        }
      });

      expect(apiClient.updateSheetPosition).toHaveBeenCalledTimes(commandOrder === 'move-then-resize' ? 1 : 0);
      expect(apiClient.updateSheetFrameLayout).toHaveBeenCalledTimes(commandOrder === 'resize-then-move' ? 1 : 0);

      await act(async () => {
        firstSave.resolve({ sheetId: sheet.id, revision: 7 });
        await firstSave.promise;
      });

      if (commandOrder === 'move-then-resize') {
        await waitFor(() => expect(apiClient.updateSheetFrameLayout).toHaveBeenCalledWith(
          sheet.id,
          { x: 180, y: 80 },
          { width: 180, height: 160 },
          { revision: 7 },
        ));
      } else {
        await waitFor(() => expect(apiClient.updateSheetPosition).toHaveBeenCalledWith(
          sheet.id,
          { x: 140, y: 90 },
          { revision: 7 },
        ));
      }

      await act(async () => {
        secondSave.resolve({ sheetId: sheet.id, revision: 8 });
        await secondSave.promise;
      });
      await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    },
  );

  it('preserves a queued resize between rapid moves', async () => {
    const firstMove = deferred<{ sheetId: string; revision: number }>();
    const resize = deferred<{ sheetId: string; revision: number }>();
    const finalMove = deferred<{ sheetId: string; revision: number }>();
    const updateSheetPosition = vi.fn()
      .mockReturnValueOnce(firstMove.promise)
      .mockReturnValueOnce(finalMove.promise);
    const updateSheetFrameLayout = vi.fn().mockReturnValue(resize.promise);
    const apiClient = autosaveClient({ updateSheetPosition, updateSheetFrameLayout });
    const sheet = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }), revision: 6 };
    const { result } = renderHook(() =>
      useWorkbookController({ apiClient, initialWorkbook: workbookWithSheets([sheet]) }),
    );

    act(() => {
      result.current.commands.moveSheetFrame(sheet.id, { x: 140, y: 90 });
      result.current.commands.resizeSheetFrame(sheet.id, { x: 180, y: 80 }, { width: 180, height: 160 });
      result.current.commands.moveSheetFrame(sheet.id, { x: 200, y: 100 });
    });
    expect(updateSheetPosition).toHaveBeenCalledTimes(1);
    expect(updateSheetFrameLayout).not.toHaveBeenCalled();

    firstMove.resolve({ sheetId: sheet.id, revision: 7 });
    await waitFor(() => expect(updateSheetFrameLayout).toHaveBeenCalledWith(
      sheet.id,
      { x: 180, y: 80 },
      { width: 180, height: 160 },
      { revision: 7 },
    ));

    resize.resolve({ sheetId: sheet.id, revision: 8 });
    await waitFor(() => expect(updateSheetPosition).toHaveBeenNthCalledWith(
      2,
      sheet.id,
      { x: 200, y: 100 },
      { revision: 8 },
    ));

    finalMove.resolve({ sheetId: sheet.id, revision: 9 });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  });

  it('persists z-order changes for every sheet whose z-index changes', async () => {
    const apiClient = autosaveClient();
    const inputs = sheetDocument({
      id: 'sheet-inputs', name: 'Inputs', position: { x: 10, y: 20 }, revision: 7, zIndex: 1,
    });
    const outputs = sheetDocument({
      id: 'sheet-outputs', name: 'Outputs', position: { x: 300, y: 20 }, revision: 8, zIndex: 2,
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([inputs, outputs]),
      }),
    );

    act(() => {
      result.current.commands.changeSheetZOrder('sheet-inputs', 'up');
    });

    expect(findSheetById(result.current.workbook, 'sheet-inputs')?.frame.zIndex).toBe(2);
    expect(findSheetById(result.current.workbook, 'sheet-outputs')?.frame.zIndex).toBe(1);
    await waitFor(() => {
      expect(apiClient.updateSheetZOrder).toHaveBeenCalledWith([
        { sheetId: 'sheet-inputs', expectedRevision: 7, zIndex: 2 },
        { sheetId: 'sheet-outputs', expectedRevision: 8, zIndex: 1 },
      ]);
    });
  });

  it('orders overlapping compound z-order commands through one workbook queue', async () => {
    const firstSave = deferred<{ sheets: Array<{ sheetId: string; revision: number }> }>();
    const secondSave = deferred<{ sheets: Array<{ sheetId: string; revision: number }> }>();
    const apiClient = autosaveClient({
      updateSheetZOrder: vi.fn()
        .mockReturnValueOnce(firstSave.promise)
        .mockReturnValueOnce(secondSave.promise)
        .mockResolvedValueOnce({
          sheets: [
            { sheetId: 'sheet-b', revision: 3 },
            { sheetId: 'sheet-c', revision: 3 },
          ],
        }),
    });
    const sheets = [
      sheetDocument({ id: 'sheet-a', name: 'A', zIndex: 1 }),
      sheetDocument({ id: 'sheet-b', name: 'B', zIndex: 2 }),
      sheetDocument({ id: 'sheet-c', name: 'C', zIndex: 3 }),
    ];
    const { result } = renderHook(() =>
      useWorkbookController({ apiClient, initialWorkbook: workbookWithSheets(sheets) }),
    );

    act(() => {
      result.current.commands.changeSheetZOrder('sheet-b', 'top');
      result.current.commands.changeSheetZOrder('sheet-a', 'top');
      result.current.commands.changeSheetZOrder('sheet-c', 'up');
    });

    expect(apiClient.updateSheetZOrder).toHaveBeenCalledTimes(1);
    expect(apiClient.updateSheetZOrder).toHaveBeenNthCalledWith(1, [
      { sheetId: 'sheet-b', expectedRevision: 0, zIndex: 3 },
      { sheetId: 'sheet-c', expectedRevision: 0, zIndex: 2 },
    ]);

    await act(async () => {
      firstSave.resolve({
        sheets: [
          { sheetId: 'sheet-b', revision: 1 },
          { sheetId: 'sheet-c', revision: 1 },
        ],
      });
      await firstSave.promise;
    });

    await waitFor(() => expect(apiClient.updateSheetZOrder).toHaveBeenNthCalledWith(2, [
      { sheetId: 'sheet-a', expectedRevision: 0, zIndex: 3 },
      { sheetId: 'sheet-b', expectedRevision: 1, zIndex: 2 },
      { sheetId: 'sheet-c', expectedRevision: 1, zIndex: 1 },
    ]));

    secondSave.resolve({
      sheets: [
        { sheetId: 'sheet-a', revision: 1 },
        { sheetId: 'sheet-b', revision: 2 },
        { sheetId: 'sheet-c', revision: 2 },
      ],
    });
    await waitFor(() => expect(apiClient.updateSheetZOrder).toHaveBeenNthCalledWith(3, [
      { sheetId: 'sheet-b', expectedRevision: 2, zIndex: 1 },
      { sheetId: 'sheet-c', expectedRevision: 2, zIndex: 2 },
    ]));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  });
});
