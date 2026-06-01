import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createSheet, type Sheet, type Workbook, type WorkspacePosition } from './workbook';
import { WorkbookApiError, type WorkbookApi } from './workbookApi';
import { useWorkbookController } from './useWorkbookController';

function workbookWithSheets(sheets: Workbook['sheets']): Workbook {
  return {
    version: 1,
    sheets,
  };
}

function positionedSheet(id: string, name: string, position: WorkspacePosition) {
  const result = createSheet({ id, name, position });
  if (!result.ok) {
    throw new Error(`Failed to create test sheet ${name}`);
  }

  return result.value;
}

function autosaveClient(overrides: Partial<WorkbookApi> = {}) {
  return {
    loadWorkbook: vi.fn().mockResolvedValue(workbookWithSheets([])),
    createSheet: vi.fn().mockResolvedValue(workbookWithSheets([])),
    deleteSheet: vi.fn().mockResolvedValue(workbookWithSheets([])),
    renameSheet: vi.fn().mockResolvedValue(workbookWithSheets([])),
    updateSheetPosition: vi.fn().mockResolvedValue(workbookWithSheets([])),
    updateSheetFrameSize: vi.fn().mockResolvedValue(workbookWithSheets([])),
    updateSheetZIndex: vi.fn().mockResolvedValue(workbookWithSheets([])),
    updateCellContent: vi.fn().mockResolvedValue(workbookWithSheets([])),
    appendRow: vi.fn().mockResolvedValue(workbookWithSheets([])),
    appendColumn: vi.fn().mockResolvedValue(workbookWithSheets([])),
    ...overrides,
  } satisfies WorkbookApi;
}

describe('useWorkbookController', () => {
  it('creates sheets through a command and hides persistence details behind autosave', async () => {
    const savedSheet = positionedSheet('00000000-0000-4000-8000-000000000001', 'Inputs', { x: 24, y: 48 });
    const apiClient = autosaveClient({
      createSheet: vi.fn().mockResolvedValue(workbookWithSheets([savedSheet])),
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

    expect(result.current.workbook.sheets).toHaveLength(1);
    expect(result.current.workbook.sheets[0].id).toMatch(/^pending:[0-9a-f-]+$/);
    await waitFor(() => expect(apiClient.createSheet).toHaveBeenCalledWith({
      name: 'Inputs',
      position: { x: 24, y: 48 },
    }));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(result.current.workbook.sheets).toHaveLength(1);
    expect(result.current.workbook.sheets[0]).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Inputs',
      position: { x: 24, y: 48 },
    });
  });

  it('preserves optimistic edits to existing sheets when a created sheet response arrives', async () => {
    const existingSheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 });
    const savedCreatedSheet = positionedSheet('00000000-0000-4000-8000-000000000001', 'Outputs', { x: 24, y: 48 });
    let resolveCreate!: (workbook: Workbook) => void;
    const createSheetSave = new Promise<Workbook>((resolve) => {
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
    await waitFor(() => expect(result.current.workbook.sheets).toHaveLength(2));
    act(() => {
      result.current.commands.updateCellContent('sheet-inputs', 'A1', 'Local value');
    });

    await act(async () => {
      resolveCreate(workbookWithSheets([existingSheet, savedCreatedSheet]));
      await createSheetSave;
    });

    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(result.current.workbook.sheets).toHaveLength(2);
    expect(result.current.workbook.sheets[0].cells.A1).toEqual({ raw: 'Local value' });
    expect(result.current.workbook.sheets[1].id).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('rejects a duplicate sheet create while the first request is pending', async () => {
    const savedSheet = positionedSheet('00000000-0000-4000-8000-000000000001', 'Inputs', { x: 24, y: 48 });
    let resolveCreate!: (workbook: Workbook) => void;
    const createSheetSave = new Promise<Workbook>((resolve) => {
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
      resolveCreate(workbookWithSheets([savedSheet]));
      await createSheetSave;
    });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  });

  it('creates unique local pending ids for concurrent optimistic sheets', () => {
    const apiClient = autosaveClient({
      createSheet: vi.fn().mockReturnValue(new Promise<Workbook>(() => undefined)),
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

    const sheetIds = result.current.workbook.sheets.map((sheet) => sheet.id);
    expect(sheetIds).toHaveLength(2);
    expect(new Set(sheetIds).size).toBe(2);
    expect(sheetIds).toEqual([expect.stringMatching(/^pending:[0-9a-f-]+$/), expect.stringMatching(/^pending:[0-9a-f-]+$/)]);
    expect(sheetIds).not.toContain('pending:');
  });

  it('remaps concurrent creates without duplicating durable sheets when responses resolve out of order', async () => {
    const savedInputs = positionedSheet('00000000-0000-4000-8000-000000000001', 'Inputs', { x: 24, y: 48 });
    const savedOutputs = {
      ...positionedSheet('00000000-0000-4000-8000-000000000002', 'Outputs', { x: 96, y: 144 }),
      zIndex: 2,
    };
    let resolveInputs!: (workbook: Workbook) => void;
    let resolveOutputs!: (workbook: Workbook) => void;
    const inputsSave = new Promise<Workbook>((resolve) => {
      resolveInputs = resolve;
    });
    const outputsSave = new Promise<Workbook>((resolve) => {
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
      resolveOutputs(workbookWithSheets([savedInputs, savedOutputs]));
      await outputsSave;
    });
    expect(result.current.workbook.sheets.map((sheet) => sheet.name)).toEqual(['Inputs', 'Outputs']);
    expect(result.current.workbook.sheets.find((sheet) => sheet.name === 'Inputs')?.id).toMatch(/^pending:/);
    expect(result.current.workbook.sheets.find((sheet) => sheet.name === 'Outputs')?.id).toBe(savedOutputs.id);

    await act(async () => {
      resolveInputs(workbookWithSheets([savedInputs, savedOutputs]));
      await inputsSave;
    });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(result.current.workbook.sheets).toEqual([savedInputs, savedOutputs]);
  });

  it('does not append a durable duplicate when a concurrent pending sheet was renamed locally', async () => {
    const savedInputs = positionedSheet('00000000-0000-4000-8000-000000000001', 'Inputs', { x: 24, y: 48 });
    const savedOutputs = {
      ...positionedSheet('00000000-0000-4000-8000-000000000002', 'Outputs', { x: 96, y: 144 }),
      zIndex: 2,
    };
    let resolveInputs!: (workbook: Workbook) => void;
    let resolveOutputs!: (workbook: Workbook) => void;
    const inputsSave = new Promise<Workbook>((resolve) => {
      resolveInputs = resolve;
    });
    const outputsSave = new Promise<Workbook>((resolve) => {
      resolveOutputs = resolve;
    });
    const apiClient = autosaveClient({
      createSheet: vi.fn().mockImplementation(({ name }: { name: string }) =>
        name === 'Inputs' ? inputsSave : outputsSave,
      ),
      renameSheet: vi.fn().mockResolvedValue(workbookWithSheets([{ ...savedInputs, name: 'Data' }, savedOutputs])),
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
    const pendingInputsId = result.current.workbook.sheets.find((sheet) => sheet.name === 'Inputs')!.id;
    act(() => {
      result.current.commands.renameSheet(pendingInputsId, 'Data');
    });
    await waitFor(() => expect(apiClient.createSheet).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveOutputs(workbookWithSheets([savedInputs, savedOutputs]));
      await outputsSave;
    });
    expect(result.current.workbook.sheets.map((sheet) => sheet.name)).toEqual(['Data', 'Outputs']);

    await act(async () => {
      resolveInputs(workbookWithSheets([savedInputs, savedOutputs]));
      await inputsSave;
    });
    await waitFor(() => expect(apiClient.renameSheet).toHaveBeenCalledWith(savedInputs.id, 'Data', { revision: 0 }));
    expect(result.current.workbook.sheets.map((sheet) => sheet.id)).toEqual([savedInputs.id, savedOutputs.id]);
  });

  it('does not append a tombstoned concurrent create while compensating deletion is pending', async () => {
    const savedInputs = positionedSheet('00000000-0000-4000-8000-000000000001', 'Inputs', { x: 24, y: 48 });
    const savedOutputs = {
      ...positionedSheet('00000000-0000-4000-8000-000000000002', 'Outputs', { x: 96, y: 144 }),
      zIndex: 2,
    };
    let resolveInputs!: (workbook: Workbook) => void;
    let resolveOutputs!: (workbook: Workbook) => void;
    const inputsSave = new Promise<Workbook>((resolve) => {
      resolveInputs = resolve;
    });
    const outputsSave = new Promise<Workbook>((resolve) => {
      resolveOutputs = resolve;
    });
    const deleteSave = new Promise<Workbook>(() => undefined);
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
    const pendingInputsId = result.current.workbook.sheets.find((sheet) => sheet.name === 'Inputs')!.id;
    act(() => {
      result.current.commands.deletePendingSheet(pendingInputsId);
    });

    await act(async () => {
      resolveOutputs(workbookWithSheets([savedInputs, savedOutputs]));
      await outputsSave;
    });
    expect(result.current.workbook.sheets).toEqual([savedOutputs]);

    await act(async () => {
      resolveInputs(workbookWithSheets([savedInputs, savedOutputs]));
      await inputsSave;
    });
    await waitFor(() => expect(apiClient.deleteSheet).toHaveBeenCalledWith(savedInputs.id, { revision: 0 }));
    expect(result.current.workbook.sheets).toEqual([savedOutputs]);
  });

  it('queues pending sheet mutations until create resolves and sends them with the backend id', async () => {
    const savedSheet = positionedSheet('00000000-0000-4000-8000-000000000001', 'Inputs', { x: 24, y: 48 });
    let resolveCreate!: (workbook: Workbook) => void;
    const createSheetSave = new Promise<Workbook>((resolve) => {
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
    const pendingSheetId = result.current.workbook.sheets[0].id;
    act(() => {
      result.current.commands.updateCellContent(pendingSheetId, 'A1', 'Local value');
    });

    expect(apiClient.updateCellContent).not.toHaveBeenCalled();
    await act(async () => {
      resolveCreate(workbookWithSheets([savedSheet]));
      await createSheetSave;
    });

    await waitFor(() =>
      expect(apiClient.updateCellContent).toHaveBeenCalledWith(savedSheet.id, 'A1', 'Local value', {
        revision: 0,
      }),
    );
    expect(result.current.workbook.sheets[0]).toMatchObject({
      id: savedSheet.id,
      cells: { A1: { raw: 'Local value' } },
    });
  });

  it('preserves pending frame layout changes while saving them with the backend id', async () => {
    const savedSheet = positionedSheet('00000000-0000-4000-8000-000000000001', 'Inputs', { x: 24, y: 48 });
    let resolveCreate!: (workbook: Workbook) => void;
    const createSheetSave = new Promise<Workbook>((resolve) => {
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
    const pendingSheetId = result.current.workbook.sheets[0].id;
    act(() => {
      result.current.commands.moveSheetFrame(pendingSheetId, { x: 96, y: 144 });
    });

    expect(apiClient.updateSheetPosition).not.toHaveBeenCalled();
    await act(async () => {
      resolveCreate(workbookWithSheets([savedSheet]));
      await createSheetSave;
    });

    await waitFor(() =>
      expect(apiClient.updateSheetPosition).toHaveBeenCalledWith(savedSheet.id, { x: 96, y: 144 }, { revision: 0 }),
    );
    expect(result.current.workbook.sheets[0]).toMatchObject({
      id: savedSheet.id,
      position: { x: 96, y: 144 },
    });
  });

  it('drops a pending sheet and its queued work when deleted before create resolves', async () => {
    const savedSheet = positionedSheet('00000000-0000-4000-8000-000000000001', 'Inputs', { x: 24, y: 48 });
    let resolveCreate!: (workbook: Workbook) => void;
    const createSheetSave = new Promise<Workbook>((resolve) => {
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
    const pendingSheetId = result.current.workbook.sheets[0].id;
    act(() => {
      result.current.commands.updateCellContent(pendingSheetId, 'A1', 'obsolete');
      result.current.commands.deletePendingSheet(pendingSheetId);
    });

    await act(async () => {
      resolveCreate(workbookWithSheets([savedSheet]));
      await createSheetSave;
    });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(result.current.workbook.sheets).toHaveLength(0);
    expect(apiClient.updateCellContent).not.toHaveBeenCalled();
  });

  it('does not resurrect a deleted pending sheet or send stale work after an in-flight create resolves', async () => {
    const savedSheet = positionedSheet('00000000-0000-4000-8000-000000000001', 'Inputs', { x: 24, y: 48 });
    let resolveCreate!: (workbook: Workbook) => void;
    const createSheetSave = new Promise<Workbook>((resolve) => {
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
    const pendingSheetId = result.current.workbook.sheets[0].id;
    act(() => {
      result.current.commands.updateCellContent(pendingSheetId, 'A1', 'obsolete');
      result.current.commands.deletePendingSheet(pendingSheetId);
    });

    await act(async () => {
      resolveCreate(workbookWithSheets([savedSheet]));
      await createSheetSave;
    });

    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(result.current.workbook.sheets).toHaveLength(0);
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

    expect(result.current.workbook.sheets).toHaveLength(1);
    await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
    expect(result.current.workbook.sheets).toHaveLength(0);
  });

  it('drops queued pending mutations after create fails', async () => {
    let rejectCreate!: (cause: unknown) => void;
    const createSheetSave = new Promise<Workbook>((_, reject) => {
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
    const pendingSheetId = result.current.workbook.sheets[0].id;
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
    expect(result.current.workbook.sheets).toHaveLength(0);
    expect(apiClient.updateCellContent).not.toHaveBeenCalled();
  });

  it('clears a failed create status when retrying the same sheet name succeeds', async () => {
    const savedSheet = positionedSheet('00000000-0000-4000-8000-000000000001', 'Inputs', { x: 24, y: 48 });
    const apiClient = autosaveClient({
      createSheet: vi.fn()
        .mockRejectedValueOnce(new Error('backend unavailable'))
        .mockResolvedValueOnce(workbookWithSheets([savedSheet])),
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
    expect(result.current.workbook.sheets).toEqual([savedSheet]);
  });

  it('keeps frame previews local and persists only committed frame commands', () => {
    const apiClient = autosaveClient();
    const sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 10, y: 20 });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([sheet]),
      }),
    );

    act(() => {
      result.current.commands.previewSheetFrameLayout('sheet-inputs', { x: 30, y: 40 });
    });

    expect(result.current.workbook.sheets[0].position).toEqual({ x: 30, y: 40 });
    expect(apiClient.updateSheetPosition).not.toHaveBeenCalled();

    act(() => {
      result.current.commands.moveSheetFrame('sheet-inputs', { x: 50, y: 60 });
    });

    expect(result.current.workbook.sheets[0].position).toEqual({ x: 50, y: 60 });
    expect(apiClient.updateSheetPosition).toHaveBeenCalledWith('sheet-inputs', { x: 50, y: 60 }, { revision: 0 });
  });

  it('updates cells through a command and derives formula display results from workbook state', () => {
    const apiClient = autosaveClient();
    const sheet: Sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 }),
      cells: {
        B1: { raw: '=SUM(A1)' },
      },
    };
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([sheet]),
      }),
    );

    act(() => {
      result.current.commands.updateCellContent('sheet-inputs', 'A1', '7');
    });

    expect(result.current.workbook.sheets[0].cells.A1).toEqual({ raw: '7' });
    expect(result.current.formulaResults['sheet-inputs'].B1.display).toBe('7');
    expect(apiClient.updateCellContent).toHaveBeenCalledWith('sheet-inputs', 'A1', '7', { revision: 0 });
  });

  it('keeps local committed cell edits while retrying a conflicting revisioned autosave', async () => {
    const initialSheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 });
    const staleServerSheet: Sheet = { ...initialSheet, revision: 4, cells: { A1: { raw: 'server value' } } };
    const savedServerSheet: Sheet = { ...staleServerSheet, revision: 5, cells: { A1: { raw: 'Local value' } } };
    const apiClient = autosaveClient({
      loadWorkbook: vi.fn().mockResolvedValue(workbookWithSheets([staleServerSheet])),
      updateCellContent: vi
        .fn()
        .mockRejectedValueOnce(new WorkbookApiError('sheet-revision-conflict', 409, 'sheet-revision-conflict'))
        .mockResolvedValueOnce(workbookWithSheets([savedServerSheet])),
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
    expect(apiClient.loadWorkbook).toHaveBeenCalledTimes(1);
    expect(apiClient.updateCellContent).toHaveBeenNthCalledWith(2, 'sheet-inputs', 'A1', 'Local value', {
      revision: 4,
    });
    expect(result.current.workbook.sheets[0].cells.A1).toEqual({ raw: 'Local value' });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  });

  it('deletes saved sheets optimistically and persists deletion with the current revision token', async () => {
    const deletedSheet = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 10, y: 20 }), revision: 4 };
    const remainingSheet = { ...positionedSheet('sheet-outputs', 'Outputs', { x: 300, y: 20 }), revision: 6 };
    const apiClient = autosaveClient({
      deleteSheet: vi.fn().mockResolvedValue(workbookWithSheets([remainingSheet])),
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

    expect(result.current.workbook.sheets.map((sheet) => sheet.id)).toEqual(['sheet-outputs']);
    await waitFor(() => expect(apiClient.deleteSheet).toHaveBeenCalledWith('sheet-inputs', { revision: 4 }));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  });

  it('drops queued saved-sheet mutations and waits for running saves before deleting', async () => {
    const initialSheet = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 }), revision: 0 };
    let resolveRunningSave!: (workbook: Workbook) => void;
    const runningSave = new Promise<Workbook>((resolve) => {
      resolveRunningSave = resolve;
    });
    let resolveDeleteSave!: (workbook: Workbook) => void;
    const deleteSave = new Promise<Workbook>((resolve) => {
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

    expect(result.current.workbook.sheets).toHaveLength(0);
    expect(apiClient.updateCellContent).toHaveBeenCalledTimes(1);
    expect(apiClient.deleteSheet).not.toHaveBeenCalled();

    await act(async () => {
      resolveRunningSave(workbookWithSheets([{ ...initialSheet, revision: 1, cells: { A1: { raw: 'first' } } }]));
      await runningSave;
    });

    await waitFor(() => expect(apiClient.deleteSheet).toHaveBeenCalledWith('sheet-inputs', { revision: 1 }));
    expect(apiClient.updateCellContent).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDeleteSave(workbookWithSheets([]));
      await deleteSave;
    });

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

    expect(result.current.workbook.sheets[0].name).toBe('Renamed Inputs');
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

    expect(result.current.workbook.sheets[0].rowCount).toBe(21);
    expect(result.current.workbook.sheets[0].columnCount).toBe(11);
    expect(apiClient.appendRow).toHaveBeenCalledWith('sheet-inputs', { revision: 5 });
    expect(apiClient.appendColumn).toHaveBeenCalledWith('sheet-inputs', { revision: 5 });
  });

  it('persists committed frame size and anchored position updates separately', () => {
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

    expect(result.current.workbook.sheets[0]).toMatchObject({
      frameSize: { width: 180, height: 160 },
      position: { x: 180, y: 80 },
    });
    expect(apiClient.updateSheetFrameSize).toHaveBeenCalledWith(
      'sheet-inputs',
      { width: 180, height: 160 },
      { revision: 6 },
    );
    expect(apiClient.updateSheetPosition).toHaveBeenCalledWith('sheet-inputs', { x: 180, y: 80 }, { revision: 6 });
  });

  it('persists z-order changes for every sheet whose z-index changes', () => {
    const apiClient = autosaveClient();
    const inputs = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 10, y: 20 }), revision: 7, zIndex: 1 };
    const outputs = { ...positionedSheet('sheet-outputs', 'Outputs', { x: 300, y: 20 }), revision: 8, zIndex: 2 };
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([inputs, outputs]),
      }),
    );

    act(() => {
      result.current.commands.changeSheetZOrder('sheet-inputs', 'up');
    });

    expect(result.current.workbook.sheets.find((sheet) => sheet.id === 'sheet-inputs')?.zIndex).toBe(2);
    expect(result.current.workbook.sheets.find((sheet) => sheet.id === 'sheet-outputs')?.zIndex).toBe(1);
    expect(apiClient.updateSheetZIndex).toHaveBeenCalledWith('sheet-inputs', 2, { revision: 7 });
    expect(apiClient.updateSheetZIndex).toHaveBeenCalledWith('sheet-outputs', 1, { revision: 8 });
  });
});
