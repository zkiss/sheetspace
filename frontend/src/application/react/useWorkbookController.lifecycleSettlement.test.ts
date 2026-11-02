import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Workbook } from '@workbook/core/model';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';

describe('lifecycle settlement', () => {
  it('keeps history locked until successful settlement and resets it only once across rerenders', async () => {
    const workbook = workbookWithSheets([sheetDocument({ id: 'one', name: 'One' })]);
    const save = deferred<Workbook>();
    const api = autosaveClient({ saveModelLifecycle: () => save.promise });
    const { result, rerender } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => result.current.commands.updateCellContent('one', 'A1', '1'));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    let submission: ReturnType<typeof result.current.commands.addDataModel>;
    act(() => {
      submission = result.current.commands.addDataModel({ id: 'm', name: 'Model', columns: [] });
      expect(result.current.commands.updateCellContent('one', 'A1', '2')).toEqual({ ok: false, reason: 'pending-model-transition' });
      result.current.commands.undo();
    });
    expect(result.current.canUndo).toBe(false);
    await act(async () => { save.resolve(result.current.workbook); await submission!.completion; });
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.commands.updateCellContent('one', 'A1', '3'));
    expect(result.current.canUndo).toBe(true);
    rerender();
    expect(result.current.canUndo).toBe(true);
  });

  it('retains a predecessor revision and history when the queued lifecycle save fails', async () => {
    const workbook = workbookWithSheets([sheetDocument({ id: 'one', name: 'One' })]);
    const write = deferred<{ sheets: { sheetId: string; revision: number }[] }>();
    const save = deferred<Workbook>();
    const api = autosaveClient({
      writeCells: vi.fn().mockReturnValueOnce(write.promise).mockResolvedValue({ sheets: [{ sheetId: 'one', revision: 8 }] }),
      saveModelLifecycle: vi.fn().mockReturnValue(save.promise),
    });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    let submission: ReturnType<typeof result.current.commands.addDataModel>;
    act(() => {
      result.current.commands.updateCellContent('one', 'A1', '1');
      submission = result.current.commands.addDataModel({ id: 'm', name: 'Model', columns: [] });
    });
    await act(async () => write.resolve({ sheets: [{ sheetId: 'one', revision: 7 }] }));
    await waitFor(() => expect(api.saveModelLifecycle).toHaveBeenCalledOnce());
    await act(async () => { save.reject(new Error('offline')); await submission!.completion; });
    expect(result.current.workbook.documents.one!.revision).toBe(7);
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.commands.updateCellContent('one', 'A1', '2'));
    await waitFor(() => expect(api.writeCells).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.writeCells).mock.calls[1]![0]).toEqual([{ sheetId: 'one', revision: 7 }]);
  });
});
