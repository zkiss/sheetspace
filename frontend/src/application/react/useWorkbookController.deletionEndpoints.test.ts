import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { deletionFixture, endpointContents } from '@test-support/recordDeletionFixture';
import { calculatedDeletionScenario, settle } from '@test-support/calculatedDeletionScenario';
import { useWorkbookController } from './useWorkbookController';

it.each([false, true])('restores calculated deletion-era endpoints without settling replay (persisted=%s)', async (persisted) => {
  const { initial, admissionAfter, rowId, formulaKey, formula } = calculatedDeletionScenario();
  const { api } = deletionFixture(false, initial);
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: persisted ? api : undefined }));
  const before = structuredClone(result.current.workbook);
  expect(before.documents.sheet!.content.rows).toEqual([rowId, 'sheet:row:2', 'sheet:row:1', 'later-record']);
  expect(before.documents.other!.content.rows).toEqual(['other:row:1', 'other:row:2']);
  await act(async () => expect((await result.current.commands.deleteRow('sheet', rowId).completion).ok).toBe(true));
  const deleted = structuredClone(result.current.workbook);
  expect(deleted.documents.sheet!.content.rows).toEqual(['sheet:row:1', 'later-record', 'sheet:row:2']);
  expect(deleted.documents.other!.content.rows).toEqual(['other:row:2', 'other:row:1']);
  expect(deleted.documents.sheet!.content.cells[formulaKey]).toBeUndefined();
  expect(deleted.documents.sheet!.presentation.rowHeights[rowId]).toBeUndefined();
  expect(deleted.documents.sheet!.presentation.formatOverrides!.cells[formulaKey]).toBeUndefined();
  expect(settle(deleted).documents.other!.content.rows).not.toEqual(deleted.documents.other!.content.rows);
  if (persisted) expect(await api.loadWorkbook()).toEqual(deleted);
  act(() => result.current.commands.undo());
  await waitFor(() => expect(endpointContents(result.current.workbook)).toEqual(endpointContents(before)));
  const undone = result.current.workbook;
  expect(endpointContents(undone)).not.toEqual(endpointContents(admissionAfter));
  expect(undone.documents.sheet!.content.cells[formulaKey]).toBe(formula);
  expect(undone.documents.sheet!.presentation.rowHeights[rowId]).toBe(48);
  expect(undone.documents.sheet!.presentation.formatOverrides!.cells[formulaKey]).toEqual({ fontWeight: 'bold' });
  if (persisted) await waitFor(async () => expect(await api.loadWorkbook()).toEqual(result.current.workbook));
  act(() => result.current.commands.redo());
  await waitFor(() => expect(endpointContents(result.current.workbook)).toEqual(endpointContents(deleted)));
  if (persisted) {
    await waitFor(async () => expect(await api.loadWorkbook()).toEqual(result.current.workbook));
    expect(api.deleteRecord).toHaveBeenCalledOnce();
    expect(api.replayRecordDeletion.mock.calls.map((call) => call[3].direction)).toEqual(['undo', 'redo']);
  } else expect(api.deleteRecord).not.toHaveBeenCalled();
  expect(api.admitModelLifecycle).not.toHaveBeenCalled();
  expect(api.admitRecord).not.toHaveBeenCalled();
  expect(api.writeCells).not.toHaveBeenCalled();
});

it.each([false, true])('keeps cell, configuration, deletion and semantic edit chronology (persisted=%s)', async (persisted) => {
  const { api, initial, rowId } = deletionFixture();
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: persisted ? api : undefined }));
  const endpoints = [structuredClone(initial)];
  act(() => expect(result.current.commands.updateCellContent('other', 'A1', '8').ok).toBe(true));
  await waitFor(async () => { if (persisted) expect(await api.loadWorkbook()).toEqual(result.current.workbook); });
  endpoints.push(structuredClone(result.current.workbook));
  await act(async () => expect((await result.current.commands.configureSorting('sheet', [{ columnId: initial.documents.sheet!.content.columns[0]!, direction: 'ascending' }]).completion).ok).toBe(true));
  endpoints.push(structuredClone(result.current.workbook));
  await act(async () => expect((await result.current.commands.deleteRow('sheet', rowId).completion).ok).toBe(true));
  endpoints.push(structuredClone(result.current.workbook));
  act(() => expect(result.current.commands.updateCellContent('other', 'A1', '11').ok).toBe(true));
  await waitFor(async () => { if (persisted) expect(await api.loadWorkbook()).toEqual(result.current.workbook); });
  endpoints.push(structuredClone(result.current.workbook));
  for (const [direction, indices] of [['undo', [3, 2, 1, 0]], ['redo', [1, 2, 3, 4]]] as const) {
    for (const index of indices) {
      const replayCount = api.replayRecordDeletion.mock.calls.length;
      act(() => result.current.commands[direction]());
      await waitFor(() => expect(endpointContents(result.current.workbook)).toEqual(endpointContents(endpoints[index]!)));
      if (persisted) {
        await waitFor(async () => {
          expect(api.replayRecordDeletion).toHaveBeenCalledTimes(replayCount + ((direction === 'undo' ? index === 2 : index === 3) ? 1 : 0));
          expect(await api.loadWorkbook()).toEqual(result.current.workbook);
        });
      }
    }
  }
  expect(result.current.canRedo).toBe(false);
  expect(result.current.canUndo).toBe(true);
});

it('installs the deletion replay endpoint only after its committed receipt arrives', async () => {
  const { api, initial, rowId } = deletionFixture();
  const replay = api.replayRecordDeletion.getMockImplementation()!;
  let release!: () => void;
  const receiptGate = new Promise<void>((resolve) => { release = resolve; });
  api.replayRecordDeletion.mockImplementation(async (...args) => {
    const receipt = await replay(...args);
    await receiptGate;
    return receipt;
  });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
  await act(async () => expect((await result.current.commands.deleteRow('sheet', rowId).completion).ok).toBe(true));
  act(() => result.current.commands.undo());
  await waitFor(() => expect(api.replayRecordDeletion).toHaveBeenCalledOnce());
  const stored = await api.loadWorkbook();
  expect(endpointContents(stored)).toEqual(endpointContents(initial));
  expect(endpointContents(stored)).not.toEqual(endpointContents(result.current.workbook));
  expect(stored).not.toEqual(result.current.workbook);
  await act(async () => release());
  await waitFor(async () => expect(await api.loadWorkbook()).toEqual(result.current.workbook));
  expect(api.replayRecordDeletion).toHaveBeenCalledOnce();
});

it('reconciles an optimistic cell undo with the revision from its delayed write receipt', async () => {
  const { api, initial } = deletionFixture();
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
  act(() => expect(result.current.commands.updateCellContent('other', 'A1', '8').ok).toBe(true));
  await waitFor(async () => expect(await api.loadWorkbook()).toEqual(result.current.workbook));
  const write = api.writeCells.getMockImplementation()!;
  let release!: () => void;
  const receiptGate = new Promise<void>((resolve) => { release = resolve; });
  api.writeCells.mockImplementation(async (...args) => {
    const receipt = await write(...args);
    await receiptGate;
    return receipt;
  });
  act(() => result.current.commands.undo());
  await waitFor(() => expect(api.writeCells).toHaveBeenCalledTimes(2));
  const stored = await api.loadWorkbook();
  expect(endpointContents(stored)).toEqual(endpointContents(result.current.workbook));
  expect(stored.documents.other!.revision).toBe(result.current.workbook.documents.other!.revision + 1);
  await act(async () => release());
  await waitFor(async () => expect(await api.loadWorkbook()).toEqual(result.current.workbook));
  expect(api.writeCells).toHaveBeenCalledTimes(2);
  expect(api.replayRecordDeletion).not.toHaveBeenCalled();
});

it('preflights unsorted local deletion history capacity before changing the workbook', async () => {
  const { initial, rowId } = deletionFixture();
  const large = { ...initial, documents: { ...initial.documents, sheet: { ...initial.documents.sheet!, name: 'x'.repeat(9 * 1024 * 1024) } } };
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: large }));
  await act(async () => expect((await result.current.commands.deleteRow('sheet', rowId).completion).ok).toBe(false));
  expect(result.current.commands.currentWorkbook()).toBe(large);
  expect(result.current.canUndo).toBe(false);
});
