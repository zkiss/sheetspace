import { expect, it, vi } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { bindModelSheets, calculatedModelCells, calculatedProperty, declaration, freshColumns, manualProperty, modelWorkbook, successfulModelMutation } from '@test-support/modelLifecycleFixtures';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { bindSheetToModel, replaceModelDeclaration } from './modelLifecycle';
import { bindPreparedSheet, renamePreparedOrdinaryColumn, replacePreparedDeclaration } from './preparedModelLifecycle';
import { renameOrdinaryColumn } from '@workbook/mutations/renameOrdinaryColumn';
import { bindModelFormula } from '@workbook/formula/modelTemplate';
import { modelFormulaAssociations } from '@workbook/formula/modelFormulaAssociation';

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

it('rejects a shared name colliding with a local name on a bound sheet without changing either sheet', () => {
  const model = declaration([manualProperty('input', 'Input')]);
  const sheets = ['one', 'two'].map((id) => sheetDocument({ id, name: id, rowCount: 1, columnCount: 1 }));
  const bound = bindModelSheets(modelWorkbook(model, sheets), ['one', 'two']);
  const second = bound.documents.two;
  const workbook = { ...bound, documents: { ...bound.documents, two: { ...second, content: { ...second.content, columns: ['extra', ...second.content.columns] }, columnNames: { extra: 'Conflict' } } } };
  const changed = { ...model, columns: [{ ...model.columns[0], name: 'Conflict' }] };

  expect(replaceModelDeclaration(workbook, changed, freshColumns())).toEqual({ ok: false, reason: 'invalid-model' });
  expect(workbook.dataModels?.[model.id]).toEqual(model);
  expect(workbook.documents.two.columnNames).toEqual({ extra: 'Conflict' });
});

it('rejects a new property colliding with an ordinary extra on the second sheet in both lifecycles', () => {
  const model = declaration([manualProperty('input', 'Input')]);
  const sheets = ['one', 'two'].map((id) => sheetDocument({ id, name: id, rowCount: 1, columnCount: 1 }));
  const bound = bindModelSheets(modelWorkbook(model, sheets), ['one', 'two']);
  const second = bound.documents.two;
  const workbook = { ...bound, documents: { ...bound.documents, two: { ...second, content: { ...second.content, columns: [...second.content.columns, 'extra'] }, columnNames: { extra: 'Conflict' } } } };
  const changed = { ...model, columns: [...model.columns, manualProperty('new', 'Conflict')] };
  const allocate = vi.fn(() => 'fresh');
  const prepared = { workbook, bindings: {} };

  expect(replaceModelDeclaration(workbook, changed, allocate)).toEqual({ ok: false, reason: 'invalid-model' });
  expect(replacePreparedDeclaration(prepared, changed, allocate)).toEqual({ ok: false, reason: 'invalid-model' });
  expect(allocate).not.toHaveBeenCalled();
  expect(workbook.dataModels?.[model.id]).toEqual(model);
  expect(workbook.documents.two.columnNames).toEqual({ extra: 'Conflict' });
});

it('rejects binding when a property would collide with another retained local column name', () => {
  const model = declaration([manualProperty('first', 'First'), manualProperty('second', 'Second')]);
  const sheet = sheetDocument({ id: 'one', name: 'one', rowCount: 1, columnCount: 2 });
  const workbook = modelWorkbook(model, [{ ...sheet, columnNames: { [sheet.content.columns[1]]: 'First' } }]);

  expect(bindSheetToModel(workbook, 'one', model.id, freshColumns())).toEqual({ ok: false, reason: 'invalid-model' });
});

it('projects qualified references in another model before binding a new consumer', () => {
  const model = declaration([manualProperty('input', 'Input')]);
  const consumer = { id: 'consumer', name: 'Consumer', columns: [calculatedProperty('result', '=@Source!Input[1]*2', 'Result')] };
  const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '4' } });
  const destination = sheetDocument({ id: 'destination', name: 'Destination', rowCount: 1, columnCount: 1 });
  const initial = { ...modelWorkbook(model, [source, destination]), dataModels: { model, consumer } };
  const bound = successfulModelMutation(bindSheetToModel(initial, source.id, model.id, freshColumns()));
  const renamed = successfulModelMutation(replaceModelDeclaration(bound, { ...model, columns: [manualProperty('input', "Owner's cost")] }, freshColumns()));
  expect(renamed.dataModels!.consumer.columns[0].formula).toBe("=@Source!'Owner''s cost'[1]*2");
  expect(renamed.documents.source.modelColumnBindings).toEqual(bound.documents.source.modelColumnBindings);
  const attached = successfulModelMutation(bindSheetToModel(renamed, destination.id, consumer.id, freshColumns()));
  expect(calculatedModelCells(attached).destination.A1?.display).toBe('8');
});

it('binds a new consumer to a renamed ordinary column without changing existing bindings', () => {
  const consumer = declaration([calculatedProperty('result', '=@Source!Old[1]*2', 'Result')]);
  const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '7' } });
  const first = sheetDocument({ id: 'first', name: 'First', rowCount: 1, columnCount: 1 });
  const second = sheetDocument({ id: 'second', name: 'Second', rowCount: 1, columnCount: 1 });
  const initial = modelWorkbook(consumer, [{ ...source, columnNames: { [source.content.columns[0]]: 'Old' } }, first, second]);
  const bound = bindModelSheets(initial, ['first']);
  const result = renameOrdinaryColumn(bound, source.id, source.content.columns[0], 'New name');
  if (!result.ok) throw new Error(result.reason);
  expect(result.value.documents.first.modelFormulaBindings).toBe(bound.documents.first.modelFormulaBindings);
  expect(result.value.dataModels!.model.columns[0].formula).toBe("=@Source!'New name'[1]*2");
  const attached = bindModelSheets(result.value, ['second']);
  expect(calculatedModelCells(attached).first.A1?.display).toBe('14');
  expect(calculatedModelCells(attached).second.A1?.display).toBe('14');
});

it('projects unresolved templates in stored and prepared lifecycles without changing historical cells', () => {
  const model = declaration([manualProperty('input', 'Old'), calculatedProperty('result', '=@Old[1]', 'Total')]);
  const sheet = sheetDocument({ id: 'one', name: 'one', rowCount: 1, columnCount: 2 });
  const initial = modelWorkbook(model, [sheet]);
  const bound = bindModelSheets(initial, ['one']);
  const originalSheet = bound.documents.one;
  const partial = { ...bound, documents: { ...bound.documents, one: { ...originalSheet, modelColumnBindings: { result: originalSheet.modelColumnBindings!.result } } } };
  const template = bindModelFormula('=@Old[1]', partial, 'one');
  const stored = { ...partial, documents: { ...partial.documents, one: { ...partial.documents.one, modelFormulaBindings: { result: template } } } };
  const prepared = { workbook: partial, bindings: { one: { result: template } } };
  const changed = { ...model, columns: [{ ...model.columns[0], name: "Owner's cost" }, model.columns[1]] };

  const renamed = successfulModelMutation(replaceModelDeclaration(stored, changed, freshColumns()));
  const preparedResult = replacePreparedDeclaration(prepared, changed, freshColumns());
  if (!preparedResult.ok) throw new Error(preparedResult.reason);
  const declarationText = renamed.dataModels!.model.columns[1].formula!;
  expect(declarationText).toBe("=@'Owner''s cost'[1]");
  expect(modelFormulaAssociations(renamed.documents.one.modelFormulaBindings!.result.content, declarationText)).toBeDefined();
  expect(preparedResult.value.bindings.one.result).toEqual(renamed.documents.one.modelFormulaBindings!.result);
  expect(renamed.documents.one.content.cells).toBe(stored.documents.one.content.cells);
  expect(preparedResult.value.workbook.documents.one.content.cells).toBe(partial.documents.one.content.cells);
});

it.each(['', ':Missing[1]'])('projects an opaque qualified reference%s when an ordinary column is renamed', (suffix) => {
  const formula = `=@Source!Old[2]${suffix}`;
  const model = declaration([calculatedProperty('result', formula, 'Total')]);
  const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1 });
  const consumer = sheetDocument({ id: 'consumer', name: 'Consumer', rowCount: 1, columnCount: 1 });
  const initial = modelWorkbook(model, [{ ...source, columnNames: { [source.content.columns[0]]: 'Old' } }, consumer]);
  const bound = bindPreparedSheet({ workbook: initial, bindings: {} }, 'consumer', model.id, freshColumns());
  if (!bound.ok) throw new Error(bound.reason);

  const result = renamePreparedOrdinaryColumn(bound.value, 'source', source.content.columns[0], "Owner's cost");
  if (!result.ok) throw new Error(result.reason);
  const declarationText = result.value.workbook.dataModels!.model.columns[0].formula!;
  expect(declarationText).toBe(`=@Source!'Owner''s cost'[2]${suffix}`);
  expect(modelFormulaAssociations(result.value.bindings.consumer.result.content, declarationText)).toBeDefined();
  expect(result.value.workbook.documents.consumer.content.cells).toBe(bound.value.workbook.documents.consumer.content.cells);
});
