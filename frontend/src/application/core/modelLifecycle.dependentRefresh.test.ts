import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { calculatedModelCells } from '@test-support/modelLifecycleFixtures';
import { bindSheetToModel, replaceModelDeclaration, unbindSheetFromModel } from '@application/core/modelLifecycle';
import { applyWorkbookOperation } from '@application/core/userActions';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import type { DataModel, Workbook } from '@workbook/core/model';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';

const sourceModel: DataModel = {
  id: 'source-model',
  name: 'Source',
  columns: [{ id: 'source-total', name: 'Total', kind: 'manual', type: 'float' }],
};

const targetModel: DataModel = {
  id: 'target-model',
  name: 'Target',
  columns: [
    { id: 'input', name: 'Input', kind: 'manual', type: 'float' },
    { id: 'total', name: 'Total', kind: 'calculated', type: 'float', formula: "=@Source!'Total'[1]" },
  ],
};

/** A workbook whose calculated property of the target sheet references a property of the source sheet. */
function crossSheetWorkbook(): Workbook {
  const source = sheetDocument({ id: 'source', name: 'Source', columnCount: 1, rowCount: 2, cells: { A1: '10', A2: '20' } });
  const target = sheetDocument({ id: 'target', name: 'Target', columnCount: 2, rowCount: 2, cells: { A1: '5' } });
  const workbook: Workbook = {
    ...workbookWithSheets([source, target]),
    dataModels: { [sourceModel.id]: sourceModel, [targetModel.id]: targetModel },
  };
  const boundSource = bindSheetToModel(workbook, 'source', sourceModel.id, () => 'unused');
  if (!boundSource.ok) throw new Error(boundSource.reason);
  const boundTarget = bindSheetToModel(boundSource.value, 'target', targetModel.id, () => 'unused');
  if (!boundTarget.ok) throw new Error(boundTarget.reason);
  return boundTarget.value;
}

function totalCells(workbook: Workbook): (string | undefined)[] {
  const sheet = workbook.documents.target!;
  const columnId = sheet.modelColumnBindings!.total!;
  return sheet.content.rows.map((rowId) => sheet.content.cells[cellIdentityKey({ rowId, columnId })]);
}

describe('dependent derived instances', () => {
  it('derives the calculated cells of the referencing sheet from the referenced property', () => {
    const workbook = crossSheetWorkbook();

    expect(totalCells(workbook).map((raw) => projectStoredFormula(raw!, workbook, 'target').text))
      .toEqual(['=@Source!Total[1]', '=@Source!Total[2]']);
  });

  it('retains the referencing instances when a referenced sheet is deleted', () => {
    const workbook = crossSheetWorkbook();

    const result = applyWorkbookOperation(workbook, { kind: 'delete-sheet', operationId: 'delete-source', sheetId: 'source' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextWorkbook.documents.source).toBeUndefined();
    expect(totalCells(result.value.nextWorkbook)).toEqual(totalCells(workbook));
    expect(calculatedModelCells(result.value.nextWorkbook).target.B1).toMatchObject({ error: '#REF!' });
  });

  it('retains the referencing instances when a referenced sheet is unbound', () => {
    const workbook = crossSheetWorkbook();

    const unbound = unbindSheetFromModel(workbook, 'source');

    expect(unbound.ok).toBe(true);
    if (!unbound.ok) return;
    expect(unbound.value.documents.source!.modelId).toBeUndefined();
    expect(totalCells(unbound.value)).toEqual(totalCells(workbook));
    expect(calculatedModelCells(unbound.value).target.B1).toMatchObject({ error: '#REF!' });
  });

  it('retains the referencing instances when a declaration drops the referenced property', () => {
    const workbook = crossSheetWorkbook();

    const changed = replaceModelDeclaration(workbook, { ...sourceModel, columns: [] }, () => 'unused');

    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(totalCells(changed.value)).toEqual(totalCells(workbook));
    expect(calculatedModelCells(changed.value).target.B1).toMatchObject({ error: '#REF!' });
  });

  it('keeps manual sheets and unbound editing untouched', () => {
    const workbook = crossSheetWorkbook();

    const result = applyWorkbookOperation(workbook, { kind: 'delete-sheet', operationId: 'delete-source', sheetId: 'source' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextWorkbook.documents.target!.content.cells[cellIdentityKey({ rowId: 'target:row:1', columnId: 'target:column:1' })]).toBe('5');
  });
});
