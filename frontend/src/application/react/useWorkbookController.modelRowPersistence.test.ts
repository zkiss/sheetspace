import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DataModel, Workbook } from '@workbook/core/model';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import { replaceDataModel, setSheetModelId } from '@workbook/mutations/dataModel';
import { decodeWorkbookBundle, encodeWorkbookBundle, WorkbookApiError } from '@infrastructure/persistence/workbookApi';
import { persistedWorkbookClient } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';

const model: DataModel = { id: 'model', name: 'Model', columns: [
  { id: 'input', name: 'Input', kind: 'manual', type: 'float' },
  { id: 'output', name: 'Output', kind: 'calculated', type: 'float', formula: '=SUM(@A[1])' },
] };

/** A sheet bound by metadata alone, or one whose template bindings a formula change pruned. */
function metadataWorkbook(pruned: boolean): Workbook {
  const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: pruned ? 1 : 0, columnCount: 2, cells: pruned ? { A1: '3' } : {} });
  const workbook: Workbook = { ...workbookWithSheets([sheet]), dataModels: { model } };
  const bound = pruned ? bindSheetToModel(workbook, sheet.id, model.id, () => 'unused') : setSheetModelId(workbook, sheet.id, model.id);
  if (!bound.ok) throw new Error(bound.reason);
  if (!pruned) return bound.value;
  const changed = replaceDataModel(bound.value, { ...model, columns: [model.columns[0]!, { ...model.columns[1]!, kind: 'calculated' as const, formula: '=SUM(@A[1])+1' }] });
  if (!changed.ok) throw new Error(changed.reason);
  expect(changed.value.documents.sheet!.content).toBe(bound.value.documents.sheet!.content);
  expect(changed.value.documents.sheet!.modelFormulaBindings).toEqual({});
  return changed.value;
}

function lastCall(mock: { mock: { calls: unknown[][] } }) { return mock.mock.calls[mock.mock.calls.length - 1]; }

describe('calculated row metadata persistence', () => {
  it.each([false, true])('saves missing/pruned template targets atomically with cells, reloads and unbinds without self-conflict (pruned=%s)', async (pruned) => {
    const workbook = metadataWorkbook(pruned);
    const api = persistedWorkbookClient(workbook);
    const save = api.saveModelLifecycle.getMockImplementation()!;
    api.saveModelLifecycle.mockImplementation(async (before: Workbook, after: Workbook) => {
      expect(before).toEqual(await api.loadWorkbook());
      return save(before, after);
    });
    const first = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    // Ordinary editing history survives append, unlike an explicit lifecycle boundary.
    if (pruned) {
      act(() => first.result.current.commands.updateCellContent('sheet', 'A1', '5'));
      await waitFor(() => expect(first.result.current.saveStatus).toBe('saved'));
    }
    act(() => { first.result.current.commands.appendRow('sheet'); });
    await waitFor(() => expect(first.result.current.saveStatus).toBe('saved'));
    expect(first.result.current.canUndo).toBe(pruned);
    const local = first.result.current.workbook;
    const reloaded = decodeWorkbookBundle(JSON.parse(JSON.stringify(encodeWorkbookBundle(await api.loadWorkbook()))));
    expect(reloaded).toEqual(local);
    const bindings = reloaded.documents.sheet!.modelFormulaBindings!;
    expect(bindings.output.references[0].endpoints[0]?.columnId).toBe(reloaded.documents.sheet!.content.columns[0]);
    expect(lastCall(api.writeCells)[2]).toEqual([{ sheetId: 'sheet', bindings }]);
    act(() => first.result.current.commands.unbindSheetFromModel('sheet'));
    await waitFor(() => expect(first.result.current.saveStatus).toBe('saved'));
    expect(api.saveModelLifecycle).toHaveBeenCalledTimes(1);
    first.unmount();

    // Reload the bound snapshot to prove another append uses exactly the persisted targets.
    const reloadedApi = persistedWorkbookClient(reloaded);
    const second = renderHook(() => useWorkbookController({ initialWorkbook: reloaded, apiClient: reloadedApi }));
    act(() => { second.result.current.commands.appendRow('sheet'); });
    await waitFor(() => expect(second.result.current.saveStatus).toBe('saved'));
    expect(second.result.current.workbook.documents.sheet!.modelFormulaBindings).toEqual(bindings);
    expect(second.result.current.formulaResults.sheet[pruned ? 'B3' : 'B2']?.display).toBe(pruned ? '1' : '0');
    expect(await reloadedApi.loadWorkbook()).toEqual(second.result.current.workbook);
  });

  it('keeps calculated cells and bindings unsaved together on rejection and preserves editing history on retry', async () => {
    const workbook = metadataWorkbook(true);
    const api = persistedWorkbookClient(workbook);
    const write = api.writeCells.getMockImplementation()!;
    const first = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    act(() => first.result.current.commands.updateCellContent('sheet', 'A1', '8'));
    await waitFor(() => expect(first.result.current.saveStatus).toBe('saved'));
    const before = await api.loadWorkbook();
    api.writeCells.mockRejectedValueOnce(new WorkbookApiError('invalid', 400, 'invalid-model-lifecycle')).mockImplementation(write);
    act(() => { first.result.current.commands.appendRow('sheet'); });
    await waitFor(() => expect(first.result.current.canRetryFailedSaves).toBe(true));
    expect(first.result.current.canUndo).toBe(true);
    const durable = await api.loadWorkbook();
    expect(durable.documents.sheet!.modelFormulaBindings).toEqual(before.documents.sheet!.modelFormulaBindings);
    expect(durable.documents.sheet!.content.cells).toEqual(before.documents.sheet!.content.cells);
    expect(first.result.current.workbook.documents.sheet!.modelFormulaBindings?.output).toBeDefined();
    act(() => first.result.current.commands.retryFailedSaves());
    await waitFor(() => expect(first.result.current.saveStatus).toBe('saved'));
    expect(first.result.current.canUndo).toBe(true);
    expect(await api.loadWorkbook()).toEqual(first.result.current.workbook);
    expect(vi.mocked(api.writeCells).mock.calls).toHaveLength(3);
    expect(lastCall(api.writeCells)).toEqual(api.writeCells.mock.calls[api.writeCells.mock.calls.length - 2]);
  });
});
