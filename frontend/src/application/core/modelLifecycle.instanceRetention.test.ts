import { describe, expect, it } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { bindModelSheets, calculatedModelCells, calculatedProperty, declaration, freshColumns, manualProperty, modelWorkbook, successfulModelMutation } from '@test-support/modelLifecycleFixtures';
import { replaceModelDeclaration } from './modelLifecycle';
import { cellIdentityFromKey, cellIdentityKey } from '@workbook/core/cellIdentity';
import { instantiateModelFormulas, refreshDerivedInstances } from '@workbook/formula/modelTemplate';

function boundWorkbook() {
  const model = declaration([manualProperty('input', 'Input'), calculatedProperty('result', '=@A[$1]*2', 'Result')]);
  const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 2, cells: { A1: '3', A2: '7' } });
  return bindModelSheets(modelWorkbook(model, [sheet]), ['sheet']);
}

describe('retained calculated instance authority', () => {
  it('retains anchored row identities across reorder and same-position replacement', () => {
    const before = boundWorkbook();
    const sheet = before.documents.sheet;
    const reordered = { ...before, documents: { sheet: { ...sheet, content: { ...sheet.content, rows: [...sheet.content.rows].reverse() } } } };

    const refreshed = refreshDerivedInstances(reordered);
    const replaced = refreshDerivedInstances({ ...refreshed, documents: { sheet: { ...sheet, content: {
      ...sheet.content, rows: ['replacement', sheet.content.rows[1]],
      cells: { ...Object.fromEntries(Object.entries(sheet.content.cells).filter(([key]) => cellIdentityFromKey(key)!.rowId !== sheet.content.rows[0])),
        [cellIdentityKey({ rowId: 'replacement', columnId: sheet.content.columns[0] })]: '100' },
    } } } });

    expect(refreshed.documents.sheet.content.cells).toEqual(sheet.content.cells);
    expect(instantiateModelFormulas(reordered, 'sheet').content.cells).toEqual(sheet.content.cells);
    expect(calculatedModelCells(refreshed).sheet.B1).toMatchObject({ value: 6 });
    expect(calculatedModelCells(refreshed).sheet.B2).toMatchObject({ value: 6 });
    const retainedKey = cellIdentityKey({ rowId: sheet.content.rows[1], columnId: sheet.content.columns[1] });
    expect(replaced.documents.sheet.content.cells[retainedKey]).toBe(sheet.content.cells[retainedKey]);
    expect(calculatedModelCells(replaced).sheet.B2).toMatchObject({ error: '#REF!' });
    expect(calculatedModelCells(replaced).sheet.B1).toMatchObject({ value: 200 });
  });

  it('instantiates only the inserted output row against final positions', () => {
    const before = boundWorkbook();
    const sheet = before.documents.sheet;
    const newInput = cellIdentityKey({ rowId: 'inserted', columnId: sheet.content.columns[0] });
    const inserted = { ...before, documents: { sheet: { ...sheet, content: {
      ...sheet.content, rows: ['inserted', ...sheet.content.rows], cells: { ...sheet.content.cells, [newInput]: '10' },
    } } } };

    const refreshed = refreshDerivedInstances(inserted);

    for (const [key, raw] of Object.entries(sheet.content.cells)) expect(refreshed.documents.sheet.content.cells[key]).toBe(raw);
    expect(calculatedModelCells(refreshed).sheet.B1).toMatchObject({ value: 20 });
    expect(calculatedModelCells(refreshed).sheet.B2).toMatchObject({ value: 6 });
    expect(calculatedModelCells(refreshed).sheet.B3).toMatchObject({ value: 6 });
  });

  it('keeps historical instances on declaration rename and replaces them only on formula change', () => {
    const before = boundWorkbook();
    const sheet = before.documents.sheet;
    const reordered = refreshDerivedInstances({ ...before, documents: { sheet: { ...sheet, content: { ...sheet.content, rows: [...sheet.content.rows].reverse() } } } });
    const renamedModel = { ...before.dataModels!.model, name: 'Renamed' };

    const renamed = successfulModelMutation(replaceModelDeclaration(reordered, renamedModel, freshColumns()));
    const changed = successfulModelMutation(replaceModelDeclaration(renamed, { ...renamedModel, columns: [
      renamedModel.columns[0], calculatedProperty('result', '=@A[$1]*3', 'Result'),
    ] }, freshColumns()));

    expect(renamed.documents.sheet.content.cells).toEqual(sheet.content.cells);
    expect(calculatedModelCells(renamed).sheet.B1).toMatchObject({ value: 6 });
    expect(calculatedModelCells(changed).sheet.B1).toMatchObject({ value: 21 });
    expect(calculatedModelCells(changed).sheet.B2).toMatchObject({ value: 21 });
  });
});
