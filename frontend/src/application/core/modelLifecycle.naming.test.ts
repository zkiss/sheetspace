import { expect, it, vi } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { bindModelSheets, calculatedProperty, declaration, freshColumns, manualProperty, modelWorkbook, successfulModelMutation } from '@test-support/modelLifecycleFixtures';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { replaceModelDeclaration } from './modelLifecycle';
import { bindPreparedSheet, replacePreparedDeclaration } from './preparedModelLifecycle';

it('preserves stored and prepared sheets and bindings for a property-only rename', () => {
  const model = declaration([manualProperty('input', 'Input'), calculatedProperty('result', '=@A[1]*2', 'Result')]);
  const sheets = ['one', 'two'].map((id) => sheetDocument({ id, name: id, rowCount: 1, columnCount: 2, cells: { A1: '3' } }));
  const initial = modelWorkbook(model, sheets);
  const bound = bindModelSheets(initial, ['one', 'two']);
  const preparedOne = bindPreparedSheet({ workbook: initial, bindings: {} }, 'one', model.id, freshColumns());
  if (!preparedOne.ok) throw new Error(preparedOne.reason);
  const preparedTwo = bindPreparedSheet(preparedOne.value, 'two', model.id, freshColumns());
  if (!preparedTwo.ok) throw new Error(preparedTwo.reason);
  const withExtra = (workbook: typeof bound) => ({ ...workbook, documents: Object.fromEntries(Object.entries(workbook.documents).map(([id, sheet]) => {
    const extra = `${id}-extra`;
    return [id, { ...sheet, content: { ...sheet.content, columns: [extra, ...sheet.content.columns.slice().reverse()], cells: { ...sheet.content.cells, [cellIdentityKey({ rowId: sheet.content.rows[0], columnId: extra })]: 'extra' } } }];
  })) });
  const stored = withExtra(bound);
  const prepared = { ...preparedTwo.value, workbook: withExtra(preparedTwo.value.workbook) };
  const renamedModel = { ...model, columns: [model.columns[0], { ...model.columns[1], name: 'Renamed result' }] };
  const allocate = vi.fn(() => 'unexpected');

  const renamed = successfulModelMutation(replaceModelDeclaration(stored, renamedModel, allocate));
  const preparedResult = replacePreparedDeclaration(prepared, renamedModel, allocate);

  expect(preparedResult.ok).toBe(true);
  if (!preparedResult.ok) throw new Error(preparedResult.reason);
  expect(renamed.documents).toBe(stored.documents);
  expect(preparedResult.value.workbook.documents).toBe(prepared.workbook.documents);
  expect(preparedResult.value.bindings).toBe(prepared.bindings);
  expect(renamed.dataModels?.[model.id]).toEqual(renamedModel);
  expect(preparedResult.value.workbook.dataModels?.[model.id]).toEqual(renamedModel);
  expect(allocate).not.toHaveBeenCalled();
});
