import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import { workbookApi } from '@infrastructure/persistence/workbookApi';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import type { DataModel } from '@workbook/core/model';
import { useWorkbookController } from './useWorkbookController';

it('replays local admissions through controller history without any API call', async () => {
  const model: DataModel = { id: 'model', name: 'Model', columns: [
    { id: 'input', name: 'Input', kind: 'manual', type: 'float' },
    { id: 'output', name: 'Output', kind: 'calculated', type: 'float', formula: '=SUM(@A[1])' },
  ] };
  const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2, cells: { A1: '3' } });
  const initial = { ...workbookWithSheets([sheet]), dataModels: { model } };
  const bound = bindSheetToModel(initial, 'sheet', 'model', () => 'unused');
  if (!bound.ok) throw new Error(bound.reason);
  const before = bound.value.documents.sheet!.content;
  const requests = Object.values(workbookApi).filter((value) => typeof value === 'function').map((value) => vi.spyOn(workbookApi, Object.keys(workbookApi).find((key) => workbookApi[key as keyof typeof workbookApi] === value) as keyof typeof workbookApi));
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: bound.value }));
  act(() => result.current.commands.changeEntryField('sheet', 'input', '1'));
  await act(async () => { await result.current.commands.submitEntryDraft('sheet'); });
  const after = structuredClone(result.current.workbook.documents.sheet!.content);
  act(() => result.current.commands.undo());
  await waitFor(() => expect(result.current.canRedo).toBe(true));
  expect(result.current.workbook.documents.sheet!.content).toEqual(before);
  act(() => result.current.commands.redo());
  await waitFor(() => expect(result.current.canUndo).toBe(true));
  expect(result.current.workbook.documents.sheet!.content).toEqual(after);
  act(() => result.current.commands.undo());
  await waitFor(() => expect(result.current.canRedo).toBe(true));
  expect(result.current.workbook.documents.sheet!.content).toEqual(before);
  for (const request of requests) expect(request).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

it('records local admission before an intervening edit even when submission is not awaited', async () => {
  const model: DataModel = { id: 'model', name: 'Model', columns: [
    { id: 'input', name: 'Input', kind: 'manual', type: 'float' },
  ] };
  const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 1 });
  const other = sheetDocument({ id: 'other', name: 'Other', rowCount: 1, columnCount: 1, cells: { A1: '2' } });
  const initial = { ...workbookWithSheets([sheet, other]), dataModels: { model } };
  const bound = bindSheetToModel(initial, 'sheet', 'model', () => 'unused');
  if (!bound.ok) throw new Error(bound.reason);
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: bound.value }));
  act(() => result.current.commands.changeEntryField('sheet', 'input', '1'));
  let submission!: ReturnType<typeof result.current.commands.submitEntryDraft>;
  act(() => {
    submission = result.current.commands.submitEntryDraft('sheet');
    expect(result.current.commands.updateCellContent('other', 'A1', '7')).toMatchObject({ ok: true });
  });
  await act(async () => { await submission; });
  const admittedRows = structuredClone(result.current.workbook.documents.sheet!.content.rows);
  expect(admittedRows).toHaveLength(bound.value.documents.sheet!.content.rows.length + 1);
  act(() => result.current.commands.undo());
  expect(result.current.workbook.documents.other!.content).toEqual(bound.value.documents.other!.content);
  expect(result.current.workbook.documents.sheet!.content.rows).toEqual(admittedRows);
  act(() => result.current.commands.undo());
  await waitFor(() => expect(result.current.workbook.documents.sheet!.content.rows).toEqual(bound.value.documents.sheet!.content.rows));
});
