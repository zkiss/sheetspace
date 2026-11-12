import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Workbook } from '@workbook/core/model';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import { useWorkbookController } from './useWorkbookController';

it('prunes a deleted sort column and replays the structure, criteria and preceding rename exactly', async () => {
  const sheet = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 2, cells: { A1: '2', A2: '1' } });
  const criteria = [{ columnId: sheet.content.columns[0]!, direction: 'ascending' as const }];
  const workbook = workbookWithSheets([{ ...sheet, sorting: criteria }]);
  const api = autosaveClient({ saveModelLifecycle: vi.fn().mockImplementation(async (_before: Workbook, after: Workbook) => after) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
  await act(async () => { await result.current.commands.renameColumn('s', criteria[0]!.columnId, 'Price').completion; });
  expect(result.current.workbook.documents.s!.sorting).toEqual(criteria);
  const renamed = result.current.workbook.documents.s!;
  expect(renamed.content.rows).toEqual([...sheet.content.rows].reverse());
  const publication = vi.fn();
  await act(async () => { await result.current.commands.deleteColumn('s', criteria[0]!.columnId, publication).completion; });
  const deleted = result.current.workbook.documents.s!;
  expect(deleted.sorting ?? []).toEqual([]);
  expect(deleted.content.columns).not.toContain(criteria[0]!.columnId);
  expect(publication).toHaveBeenCalledTimes(1);
  act(() => result.current.commands.undo());
  await waitFor(() => expect(result.current.canRedo).toBe(true));
  expect(result.current.workbook.documents.s!.content).toEqual(renamed.content);
  expect(result.current.workbook.documents.s!.sorting).toEqual(criteria);
  act(() => result.current.commands.undo());
  await waitFor(() => expect(result.current.workbook.documents.s!.content.rows).toEqual(sheet.content.rows));
  act(() => result.current.commands.redo());
  await waitFor(() => expect(result.current.workbook.documents.s!.content.rows).toEqual(renamed.content.rows));
  act(() => result.current.commands.redo());
  await waitFor(() => expect(result.current.workbook.documents.s!.content.columns).toEqual(deleted.content.columns));
});

it('returns a sorted rename admission failure without publication or history', async () => {
  const sheet = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 1 });
  const workbook = workbookWithSheets([{ ...sheet, sorting: [{ columnId: sheet.content.columns[0]!, direction: 'ascending' }] }]);
  const pending = deferred<Workbook>();
  const api = autosaveClient({ saveModelLifecycle: vi.fn().mockReturnValue(pending.promise) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
  let rename: ReturnType<typeof result.current.commands.renameSheet>;
  act(() => {
    result.current.commands.deleteRow('s', sheet.content.rows[0]!);
    rename = result.current.commands.renameSheet('s', 'New');
  });
  expect(rename!).toEqual({ ok: false, reason: 'pending-model-transition' });
  expect(result.current.commands.currentWorkbook().documents.s!.name).toBe('S');
  expect(api.saveModelLifecycle).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve(result.current.commands.currentWorkbook()); await pending.promise; });
});

it('settles changed model formula keys once and publishes the final calculation', async () => {
  const model = { id: 'm', name: 'M', columns: [
    { id: 'input', name: 'Input', kind: 'manual' as const, type: 'float' as const },
    { id: 'output', name: 'Output', kind: 'calculated' as const, type: 'float' as const, formula: '=@A[1]*2' },
  ] as const };
  const sheet = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 2, cells: { A1: '1', A2: '2' } });
  const initial = { ...workbookWithSheets([sheet]), dataModels: { m: model } };
  const bound = bindSheetToModel(initial, 's', 'm', () => 'new-column');
  if (!bound.ok) throw new Error(bound.reason);
  const document = bound.value.documents.s!;
  const workbook = { ...bound.value, documents: { ...bound.value.documents, s: { ...document, sorting: [{ columnId: document.content.columns[1]!, direction: 'ascending' as const }] } } };
  const api = autosaveClient({ saveModelLifecycle: vi.fn().mockImplementation(async (_before: Workbook, after: Workbook) => after) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
  await act(async () => { await result.current.commands.replaceModelDeclaration({ ...model, columns: [model.columns[0]!, { ...model.columns[1]!, formula: '=-@A[1]' }] }).completion; });
  expect(api.saveModelLifecycle).toHaveBeenCalledTimes(1);
  expect(result.current.workbook.documents.s!.content.rows).toEqual([...sheet.content.rows].reverse());
  expect(result.current.formulaResults.s!.B1.display).toBe('-2');
  expect(result.current.formulaResults.s!.B2.display).toBe('-1');
  act(() => result.current.commands.undo());
  await waitFor(() => expect(result.current.canRedo).toBe(true));
  expect(result.current.workbook.documents.s!.content.rows).toEqual(sheet.content.rows);
});

it('settles a semantic sheet rename and preserves its criterion for exact undo', async () => {
  const sheet = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 1, cells: { A1: '2', A2: '1' } });
  const criteria = [{ columnId: sheet.content.columns[0]!, direction: 'ascending' as const }];
  const workbook = workbookWithSheets([{ ...sheet, sorting: criteria }]);
  const api = autosaveClient({ saveModelLifecycle: vi.fn().mockImplementation(async (_before: Workbook, after: Workbook) => after) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
  act(() => { expect(result.current.commands.renameSheet('s', 'Renamed').ok).toBe(true); });
  await waitFor(() => expect(result.current.canUndo).toBe(true));
  expect(result.current.workbook.documents.s!.sorting).toEqual(criteria);
  expect(result.current.workbook.documents.s!.content.rows).toEqual([...sheet.content.rows].reverse());
  act(() => result.current.commands.undo());
  await waitFor(() => expect(result.current.canRedo).toBe(true));
  expect(result.current.workbook.documents.s!.name).toBe('S');
  expect(result.current.workbook.documents.s!.content.rows).toEqual(sheet.content.rows);
});

it('preserves oversized sorted rename rejection without saving or publishing', () => {
  const sheet = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 1 });
  const workbook = workbookWithSheets([{ ...sheet, name: 'x'.repeat(18 * 1024 * 1024), sorting: [{ columnId: sheet.content.columns[0]!, direction: 'ascending' }] }]);
  const api = autosaveClient();
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
  act(() => { expect(result.current.commands.renameSheet('s', 'New')).toEqual({ ok: false, reason: 'sorting-history-too-large' }); });
  expect(result.current.commands.currentWorkbook()).toBe(workbook);
  expect(result.current.canUndo).toBe(false);
  expect(api.saveModelLifecycle).not.toHaveBeenCalled();
});
