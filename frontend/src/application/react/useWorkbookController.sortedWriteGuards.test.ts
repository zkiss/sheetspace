import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { WorkbookApiError } from '@infrastructure/persistence/workbookApi';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import type { DataModel, Workbook } from '@workbook/core/model';
import { useWorkbookController } from './useWorkbookController';

function fixture() {
  const a = sheetDocument({ id: 'a', name: 'A', rowCount: 2, columnCount: 1, cells: { A1: '1', A2: '2' } });
  const b = sheetDocument({ id: 'b', name: 'B', rowCount: 1, columnCount: 1 });
  return { a, b, workbook: workbookWithSheets([{ ...a, sorting: [{ columnId: a.content.columns[0]!, direction: 'ascending' }] }, b]) };
}

it('blocks sorted writes while an unrelated sheet has an unsettled creation', () => {
  const { a, workbook } = fixture();
  const axis = deferred<Workbook>();
  const api = autosaveClient({ saveModelLifecycle: vi.fn(() => axis.promise) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
  act(() => result.current.commands.appendRow('b'));
  const before = result.current.commands.currentWorkbook();
  act(() => expect(result.current.commands.writeCells([{ sheetId: 'a', rowId: a.content.rows[0]!, columnId: a.content.columns[0]!, raw: '5' }])).toEqual({ ok: false, reason: 'pending-model-transition' }));
  expect(result.current.commands.currentWorkbook()).toBe(before);
  expect(api.saveModelLifecycle).toHaveBeenCalledTimes(1);
});

it('blocks sorted writes that would reorder a sheet with an unfinished entry', () => {
  const { a, workbook: original } = fixture();
  const bound = sheetDocument({ id: 'bound', name: 'Bound', rowCount: 2, columnCount: 1, cells: { A1: '2', A2: '1' } });
  const model: DataModel = { id: 'model', name: 'Model', columns: [{ id: 'input', name: 'Input', kind: 'manual', type: 'float' }] };
  const context: Workbook = { ...workbookWithSheets([original.documents.a!, bound]), dataModels: { model } };
  const binding = bindSheetToModel(context, 'bound', 'model', () => 'unused');
  if (!binding.ok) throw new Error(binding.reason);
  const sheet = binding.value.documents.bound!;
  const workbook: Workbook = { ...binding.value, documents: { ...binding.value.documents, bound: { ...sheet, sorting: [{ columnId: sheet.modelColumnBindings!.input!, direction: 'ascending' }] } } };
  const api = autosaveClient();
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
  act(() => result.current.commands.changeEntryField('bound', 'input', '5'));
  const before = result.current.commands.currentWorkbook();
  act(() => expect(result.current.commands.writeCells([{ sheetId: 'a', rowId: a.content.rows[0]!, columnId: a.content.columns[0]!, raw: '5' }])).toEqual({ ok: false, reason: 'pending-model-transition' }));
  expect(result.current.commands.currentWorkbook()).toBe(before);
  expect(api.saveModelLifecycle).not.toHaveBeenCalled();
});

it('blocks sorted writes behind a failed older persistence operation', async () => {
  const { a, workbook } = fixture();
  const api = autosaveClient({ updateSheetPosition: vi.fn().mockRejectedValue(new WorkbookApiError('offline', 500, 'offline')) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
  act(() => result.current.commands.moveSheetFrame('b', { x: 30, y: 40 }));
  await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
  const before = result.current.commands.currentWorkbook();
  act(() => expect(result.current.commands.writeCells([{ sheetId: 'a', rowId: a.content.rows[0]!, columnId: a.content.columns[0]!, raw: '5' }])).toEqual({ ok: false, reason: 'blocked-persistence-prerequisite' }));
  expect(result.current.commands.currentWorkbook()).toBe(before);
  expect(api.saveModelLifecycle).not.toHaveBeenCalled();
});
