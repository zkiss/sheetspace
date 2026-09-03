import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { sheetsInOrder } from '@workbook/read/queries';
import { useWorkbookController } from './useWorkbookController';
import { autosaveClient, deferred } from '@test/apiClients';
import { positionedSheet, sheetDocument, workbookWithSheets } from '@test/workbookFactories';

describe('useWorkbookController sheet deletion', () => {
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

  it.each([
    ['row', 'column', 'succeeds'],
    ['column', 'row', 'fails'],
  ] as const)(
    'waits for a running %s append, drops the queued %s append, and deletes after the append %s',
    async (runningAxis, queuedAxis, settlement) => {
      const append = deferred<{ sheetId: string; revision: number; rowCount?: number; rowId?: string; columnCount?: number; columnId?: string }>();
      const deleteSave = deferred<void>();
      const appendRow = vi.fn();
      const appendColumn = vi.fn();
      const runningAppend = runningAxis === 'row' ? appendRow : appendColumn;
      const queuedAppend = queuedAxis === 'row' ? appendRow : appendColumn;
      runningAppend.mockReturnValue(append.promise);
      const apiClient = autosaveClient({
        appendRow,
        appendColumn,
        deleteSheet: vi.fn().mockReturnValue(deleteSave.promise),
      });
      const sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 });
      const { result } = renderHook(() => useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([sheet]),
      }));

      act(() => {
        result.current.commands[runningAxis === 'row' ? 'appendRow' : 'appendColumn'](sheet.id);
        result.current.commands[queuedAxis === 'row' ? 'appendRow' : 'appendColumn'](sheet.id);
        result.current.commands.deleteSheet(sheet.id);
      });

      expect(result.current.workbook.manifest.sheetIds).toEqual([]);
      expect(runningAppend).toHaveBeenCalledTimes(1);
      expect(queuedAppend).not.toHaveBeenCalled();
      expect(apiClient.deleteSheet).not.toHaveBeenCalled();

      await act(async () => {
        if (settlement === 'succeeds') {
          append.resolve(runningAxis === 'row'
            ? { sheetId: sheet.id, revision: 1, rowCount: 21, rowId: 'server-row' }
            : { sheetId: sheet.id, revision: 1, columnCount: 11, columnId: 'server-column' });
        } else {
          append.reject(new Error('obsolete append failed'));
        }
        await append.promise.catch(() => undefined);
      });

      await waitFor(() => expect(apiClient.deleteSheet).toHaveBeenCalledTimes(1));
      expect(apiClient.deleteSheet).toHaveBeenCalledWith(sheet.id, {
        revision: settlement === 'succeeds' ? 1 : 0,
      });
      expect(queuedAppend).not.toHaveBeenCalled();
      expect(result.current.saveStatus).toBe('saving');

      deleteSave.resolve();
      await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    },
  );

});
