import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cellRawContent, sheetsInOrder, type SheetDocument } from './workbook';
import { useWorkbookController } from './useWorkbookController';
import { autosaveClient } from './test/apiClients';
import { positionedSheet, workbookWithSheets } from './test/workbookFactories';

describe('useWorkbookController pending sheet lifecycle', () => {
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

});
