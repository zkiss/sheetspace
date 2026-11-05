import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Workbook } from '@workbook/core/model';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellTargetAt } from '@grid/cellInteraction';
import { useCellEditing } from '@grid/useCellEditing';
import { useWorkbookController } from './useWorkbookController';

describe('lifecycle settlement', () => {
  it('does not publish or save an unchanged unbind', async () => {
    const sheet = sheetDocument({ id: 'one', name: 'One' });
    const workbook = workbookWithSheets([sheet]);
    const api = autosaveClient();
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    const publication = vi.fn();
    let submission: ReturnType<typeof result.current.commands.unbindSheetFromModel>;
    act(() => { submission = result.current.commands.unbindSheetFromModel('one', publication); });
    expect(await submission!.completion).toEqual({ ok: true, value: workbook });
    expect(result.current.commands.currentWorkbook()).toBe(workbook);
    expect(publication).not.toHaveBeenCalled();
    expect(api.saveModelLifecycle).not.toHaveBeenCalled();
  });

  it('does not renew a retired selection lease when an ambiguous deletion recovers', async () => {
    const sheet = sheetDocument({ id: 'one', name: 'One', rowCount: 2, columnCount: 2 });
    const workbook = workbookWithSheets([sheet]);
    const save = deferred<Workbook>();
    const api = autosaveClient({ saveModelLifecycle: vi.fn().mockReturnValueOnce(save.promise).mockImplementation(async (_before: Workbook, after: Workbook) => after) });
    const { result } = renderHook(() => {
      const controller = useWorkbookController({ initialWorkbook: workbook, apiClient: api });
      const editing = useCellEditing({ commands: controller.commands, workbook: controller.workbook, currentWorkbook: controller.commands.currentWorkbook });
      return { controller, editing };
    });
    act(() => result.current.editing.selectCell(cellTargetAt(sheet, 'A1')!));
    const token = result.current.editing.beginSelectionSettlement();
    const phases: string[] = [];
    let submission: ReturnType<typeof result.current.controller.commands.deleteRow>;
    act(() => {
      submission = result.current.controller.commands.deleteRow('one', sheet.content.rows[0]!, (before, after, phase) => {
        phases.push(phase);
        result.current.editing.reconcileSelectionPublication(token, before, after);
      });
    });
    await act(async () => { save.reject(new Error('offline')); await submission!.completion; });
    expect(phases).toEqual(['optimistic', 'rollback']);
    result.current.editing.cancelSelectionSettlement(token);
    act(() => result.current.editing.selectCell(cellTargetAt(sheet, 'B2')!));
    const newerSelection = result.current.editing.queuedSelection();
    act(() => result.current.controller.commands.retryFailedSaves());
    await waitFor(() => expect(result.current.controller.canRetryFailedSaves).toBe(false));
    expect(api.saveModelLifecycle).toHaveBeenCalledTimes(2);
    expect(phases).toEqual(['optimistic', 'rollback']);
    expect(result.current.editing.ownsSelectionSettlement(token)).toBe(false);
    expect(result.current.editing.queuedSelection()).toEqual(newerSelection);
  });
  it.each(['before', 'after'] as const)('keeps the rollback authoritative when settlement occurs %s a rendered publication', async (renderTiming) => {
    const sheet = sheetDocument({ id: 'one', name: 'One', rowCount: 2, columnCount: 2 });
    const workbook = workbookWithSheets([sheet]);
    const save = deferred<Workbook>();
    const api = autosaveClient({ saveModelLifecycle: () => save.promise });
    const { result, rerender } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    const phases: string[] = [];
    let rollback: Workbook | undefined;
    let submission: ReturnType<typeof result.current.commands.deleteRow>;
    const submit = () => {
      submission = result.current.commands.deleteRow('one', sheet.content.rows[0]!, (_before, after, phase) => {
        expect(result.current.commands.currentWorkbook()).toBe(after);
        phases.push(phase);
        if (phase === 'rollback') rollback = after;
      });
    };
    if (renderTiming === 'after') {
      act(submit);
      rerender();
    }
    await act(async () => {
      if (renderTiming === 'before') submit();
      save.reject(new Error('offline'));
      await submission!.completion;
    });
    rerender();
    expect(phases).toEqual(['optimistic', 'rollback']);
    expect(result.current.commands.currentWorkbook()).toBe(rollback);
    expect(result.current.workbook).toBe(rollback);
    expect(rollback!.documents.one!.content.rows).toEqual(sheet.content.rows);
  });
  it('does not publish a rejected deletion or a deletion blocked by a pending transition', async () => {
    const sheet = sheetDocument({ id: 'one', name: 'One', rowCount: 2, columnCount: 2 });
    const workbook = workbookWithSheets([sheet]);
    const save = deferred<Workbook>();
    const api = autosaveClient({ saveModelLifecycle: () => save.promise });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    const publication = vi.fn();
    let pending: ReturnType<typeof result.current.commands.deleteRow>;
    act(() => {
      expect(result.current.commands.deleteRow('one', 'missing', publication).result.ok).toBe(false);
      pending = result.current.commands.deleteRow('one', sheet.content.rows[0]!);
      expect(result.current.commands.deleteRow('one', sheet.content.rows[1]!, publication).result.ok).toBe(false);
    });
    expect(publication).not.toHaveBeenCalled();
    await act(async () => { save.resolve(result.current.commands.currentWorkbook()); await pending!.completion; });
    expect(publication).not.toHaveBeenCalled();
  });
  it('publishes exact optimistic and revision-adjusted rollback snapshots before completion', async () => {
    const sheet = sheetDocument({ id: 'one', name: 'One', rowCount: 2, columnCount: 2 });
    const workbook = workbookWithSheets([sheet]);
    const write = deferred<{ sheets: { sheetId: string; revision: number }[] }>();
    const save = deferred<Workbook>();
    const api = autosaveClient({ writeCells: vi.fn().mockReturnValue(write.promise), saveModelLifecycle: vi.fn().mockReturnValue(save.promise) });
    const { result, rerender } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    const publications: { before: Workbook; after: Workbook; phase: string }[] = [];
    let completed = false;
    let submission: ReturnType<typeof result.current.commands.deleteRow>;
    act(() => {
      result.current.commands.updateCellContent('one', 'A1', '1');
      submission = result.current.commands.deleteRow('one', sheet.content.rows[0]!, (before, after, phase) => {
        expect(result.current.commands.currentWorkbook()).toBe(after);
        expect(completed).toBe(false);
        publications.push({ before, after, phase });
      });
      expect(publications.map(({ phase }) => phase)).toEqual(['optimistic']);
      expect(result.current.commands.currentWorkbook()).toBe(publications[0]!.after);
    });
    rerender();
    expect(publications).toHaveLength(1);
    await act(async () => write.resolve({ sheets: [{ sheetId: 'one', revision: 7 }] }));
    await waitFor(() => expect(api.saveModelLifecycle).toHaveBeenCalledOnce());
    await act(async () => {
      save.reject(new Error('offline'));
      await submission!.completion;
      completed = true;
    });
    expect(publications.map(({ phase }) => phase)).toEqual(['optimistic', 'rollback']);
    expect(publications[1]!.before.documents.one!.revision).toBe(7);
    expect(publications[1]!.after.documents.one!.revision).toBe(7);
    expect(publications[1]!.after.documents.one!.content.rows).toEqual(sheet.content.rows);
    expect(result.current.commands.currentWorkbook()).toBe(publications[1]!.after);
    expect(result.current.workbook).toBe(publications[1]!.after);
    rerender();
    expect(publications).toHaveLength(2);
  });
  it('rejects reorders while a lifecycle transition is pending and admits them after settlement', async () => {
    const sheet = sheetDocument({ id: 'one', name: 'One', rowCount: 2, columnCount: 2 });
    const workbook = workbookWithSheets([sheet]);
    const save = deferred<Workbook>();
    const api = autosaveClient({ saveModelLifecycle: () => save.promise, loadSheet: vi.fn().mockResolvedValue(sheet) });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    let submission: ReturnType<typeof result.current.commands.addDataModel>;
    act(() => { submission = result.current.commands.addDataModel({ id: 'm', name: 'Model', columns: [] }); });
    const before = result.current.workbook;
    act(() => {
      expect(result.current.commands.shiftAxis('one', 'row', [sheet.content.rows[0]!], 1)).toMatchObject({ status: 'rejected', reason: 'pending-model-transition' });
      expect(result.current.commands.gatherAxis('one', 'column', [sheet.content.columns[0]!], 2)).toMatchObject({ status: 'rejected', reason: 'pending-model-transition' });
    });
    expect(result.current.workbook).toBe(before);
    expect(api.writeAxisOrder).not.toHaveBeenCalled();
    expect(result.current.canUndo).toBe(false);
    await act(async () => { save.resolve(result.current.workbook); await submission!.completion; });
    act(() => expect(result.current.commands.shiftAxis('one', 'row', [sheet.content.rows[0]!], 1).status).toBe('changed'));
    expect(result.current.workbook.documents.one!.content.rows).toEqual([...sheet.content.rows].reverse());
    expect(result.current.canUndo).toBe(true);
  });

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
      saveModelLifecycle: vi.fn()
        .mockReturnValueOnce(save.promise)
        .mockImplementation(async (_before: Workbook, after: Workbook) => ({
          ...after,
          documents: Object.fromEntries(Object.entries(after.documents).map(([id, sheet]) => [id,
            { ...sheet, revision: _before.documents[id] ? 7 : 0 }])),
        })),
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
    // Admission and history are held while the exact operation is unresolved.
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRetryFailedSaves).toBe(true);
    // The ambiguous failure holds admission until the exact operation settles.
    expect(result.current.commands.updateCellContent('one', 'A1', '2')).toEqual({ ok: false, reason: 'pending-model-transition' });
    expect(api.writeCells).toHaveBeenCalledTimes(1);
    act(() => result.current.commands.retryFailedSaves());
    await waitFor(() => expect(api.saveModelLifecycle).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.canRetryFailedSaves).toBe(false));
    expect(vi.mocked(api.saveModelLifecycle).mock.calls[1]![0]).toEqual(vi.mocked(api.saveModelLifecycle).mock.calls[0]![0]);
    expect(vi.mocked(api.saveModelLifecycle).mock.calls[1]![1]).toEqual(vi.mocked(api.saveModelLifecycle).mock.calls[0]![1]);
    act(() => result.current.commands.updateCellContent('one', 'A1', '2'));
    await waitFor(() => expect(api.writeCells).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.writeCells).mock.calls[1]![0]).toEqual([{ sheetId: 'one', revision: 7 }]);
  });
});
