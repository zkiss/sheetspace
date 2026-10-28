import { describe, expect, it, vi } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { bindModelSheets, calculatedModelCells, calculatedProperty, declaration, freshColumns, manualProperty, modelWorkbook, storedModelCells, successfulModelMutation } from '@test-support/modelLifecycleFixtures';
import { replaceModelDeclaration } from './modelLifecycle';
import { commitCellRawContent } from '@workbook/mutations/operations';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { decodeCellTextLiteral } from '@workbook/core/cellLiteral';

const model = declaration([manualProperty('input', 'Input'), manualProperty('extra', 'Extra'), calculatedProperty('result', '=@A[1]+@B[1]', 'Result')]);
const makeSheet = (id = 'sheet', rowCount = 2) => sheetDocument({ id, name: id === 'sheet' ? 'Sheet' : 'Other', columnCount: 3, rowCount, cells: rowCount ? { A1: id === 'sheet' ? '3' : '20', B1: '7', ...(rowCount > 1 ? { A2: '4', B2: '8' } : {}) } : {} });

describe('stable-property model reconciliation', () => {
  it('atomically reorders, renames, adds and removes across independent bound instances', () => {
    const first = makeSheet();
    const second = makeSheet('other', 1);
    const unaffected = sheetDocument({ id: 'unaffected', name: 'Unaffected', rowCount: 1, columnCount: 1 });
    const createId = freshColumns();
    const bound = bindModelSheets(modelWorkbook(model, [first, second, unaffected]), ['sheet', 'other'], createId);
    const changed = declaration([model.columns[2]!, { ...model.columns[0]!, name: 'Renamed' }, manualProperty('new', 'Extra')]);

    const next = successfulModelMutation(replaceModelDeclaration(bound, changed, createId));

    for (const id of ['sheet', 'other']) {
      const before = bound.documents[id]!;
      const after = next.documents[id]!;
      expect(after.content.columns.slice(0, 2)).toEqual([before.content.columns[2], before.content.columns[0]]);
      expect(after.content.columns[2]).not.toBe(before.content.columns[1]);
      expect(after.content.rows).toBe(before.content.rows);
      expect(after.frame).toBe(before.frame);
      expect(storedModelCells(next, id).B1).toBe(id === 'sheet' ? '3' : '20');
      expect(storedModelCells(next, id).C1).toBeUndefined();
      // Unedited template B1 targeted the removed Extra, not the new same-name property.
      expect(calculatedModelCells(next)[id].A1).toMatchObject({ error: '#REF!' });
    }
    expect(next.documents.sheet!.content.columns[2]).not.toBe(next.documents.other!.content.columns[2]);
    expect(next.documents.unaffected).toBe(unaffected);
    expect(bound.dataModels!.model).toBe(model);
    expect(storedModelCells(bound).B1).toBe('7');
  });

  it('preserves A1, named and cross-sheet reference identities and unchanged template targets on reorder', () => {
    const named = declaration([manualProperty('input', 'Input'), manualProperty('extra', 'Extra'), calculatedProperty('result', "=@'Input'[1]+@B[1]", 'Result')]);
    const external = sheetDocument({ id: 'external', name: 'External', rowCount: 1, columnCount: 3, cells: { A1: '=@Sheet!A[1]', C1: '=@Sheet!C[1]' } });
    let bound = bindModelSheets(modelWorkbook(named, [makeSheet(), external]), ['sheet']);
    bound = commitCellRawContent(bound, 'external', 'B1', "=@Sheet!'Input'[1]");
    bound = commitCellRawContent(bound, 'sheet', 'B1', '=@A[1]*3');
    const changed = declaration([{ ...named.columns[2]!, name: 'Output' }, { ...named.columns[1]!, name: 'Input' }, { ...named.columns[0]!, name: 'Original' }]);

    const next = successfulModelMutation(replaceModelDeclaration(bound, changed, freshColumns()));

    expect(calculatedModelCells(next).sheet.A1).toMatchObject({ value: 12 });
    expect(calculatedModelCells(next).sheet.A2).toMatchObject({ value: 12 });
    expect(calculatedModelCells(next).sheet.B1).toMatchObject({ value: 9 });
    expect(calculatedModelCells(next).external.A1).toMatchObject({ value: 3 });
    expect(calculatedModelCells(next).external.B1).toMatchObject({ value: 3 });
    expect(calculatedModelCells(next).external.C1).toMatchObject({ value: 12 });
    expect(next.documents.sheet!.modelFormulaBindings!.result).toBe(bound.documents.sheet!.modelFormulaBindings!.result);
  });

  it('resolves edited templates against the new layout, including simultaneous cross-sheet changes', () => {
    const cross = declaration([manualProperty('input'), calculatedProperty('result', '=@A[1]*2')]);
    const first = sheetDocument({ id: 'sheet', name: 'Sheet', columnCount: 2, rowCount: 2, cells: { A1: '3', A2: '4' } });
    const second = sheetDocument({ id: 'other', name: 'Other', columnCount: 2, rowCount: 1, cells: { A1: '20' } });
    const bound = bindModelSheets(modelWorkbook(cross, [first, second]), ['sheet', 'other']);
    const changed = declaration([calculatedProperty('result', '=@Other!B[1]+@B[1]'), cross.columns[0]!]);

    const next = successfulModelMutation(replaceModelDeclaration(bound, changed, freshColumns()));

    expect(calculatedModelCells(next).sheet.A1).toMatchObject({ value: 23 });
    expect(calculatedModelCells(next).sheet.A2).toMatchObject({ error: '#REF!' });
    expect(calculatedModelCells(next).other.A1).toMatchObject({ value: 40 });
  });

  it('keeps removed A1 and named references broken through removal and later same-name reuse', () => {
    const external = sheetDocument({ id: 'external', name: 'External', columnCount: 2, rowCount: 1, cells: { A1: '=@Sheet!A[1]' } });
    const bound = commitCellRawContent(bindModelSheets(modelWorkbook(model, [makeSheet(), external]), ['sheet']), 'external', 'B1', "=@Sheet!'Input'[1]");
    const createId = freshColumns();
    const removed = successfulModelMutation(replaceModelDeclaration(bound, declaration([model.columns[1]!, model.columns[2]!]), createId));
    const reused = successfulModelMutation(replaceModelDeclaration(removed, declaration([manualProperty('fresh', 'Input'), model.columns[1]!, model.columns[2]!]), createId));

    expect(calculatedModelCells(removed).external.A1).toMatchObject({ error: '#REF!' });
    expect(calculatedModelCells(reused).external.A1).toMatchObject({ error: '#REF!' });
    expect(calculatedModelCells(reused).external.B1).toMatchObject({ error: '#REF!' });
    expect(calculatedModelCells(reused).sheet.C1).toMatchObject({ error: '#REF!' });
    expect(storedModelCells(reused).A1).toBeUndefined();
  });

  it('moves sheet-specific widths and formats with retained IDs and prunes removed data', () => {
    const base = makeSheet();
    const [a, b, c] = base.content.columns;
    const rowId = base.content.rows[0]!;
    const retainedCell = cellIdentityKey({ rowId, columnId: a! });
    const removedCell = cellIdentityKey({ rowId, columnId: b! });
    const sheet = { ...base, presentation: { rowHeights: { [rowId]: 44 }, columnWidths: { [a!]: 81, [b!]: 90, [c!]: 99 }, formatOverrides: { rows: {}, columns: { [a!]: { fontWeight: 'bold' as const }, [b!]: { fontWeight: 'bold' as const } }, cells: { [retainedCell]: { fillColor: '#123456' as const }, [removedCell]: { fontWeight: 'bold' as const } } } } };
    const bound = bindModelSheets(modelWorkbook(model, [sheet]), ['sheet']);

    const next = successfulModelMutation(replaceModelDeclaration(bound, declaration([model.columns[2]!, model.columns[0]!]), freshColumns())).documents.sheet!;

    expect(next.presentation.rowHeights).toBe(sheet.presentation.rowHeights);
    expect(next.presentation.columnWidths).toEqual({ [a!]: 81, [c!]: 99 });
    expect(next.presentation.formatOverrides).toEqual({ rows: {}, columns: { [a!]: { fontWeight: 'bold' } }, cells: { [retainedCell]: { fillColor: '#123456' } } });
    expect(next.content.cells[removedCell]).toBeUndefined();
  });
});

describe('property kind transitions and empty declarations', () => {
  it('freezes cross-sheet dependencies before any affected instance is overwritten', () => {
    const old = declaration([manualProperty('input'), calculatedProperty('result', '=@Other!A[1]+@A[1]')]);
    const first = sheetDocument({ id: 'sheet', name: 'Sheet', columnCount: 2, rowCount: 1, cells: { A1: '3' } });
    const second = sheetDocument({ id: 'other', name: 'Other', columnCount: 2, rowCount: 1, cells: { A1: '20' } });
    const bound = bindModelSheets(modelWorkbook(old, [first, second]), ['sheet', 'other']);

    const next = successfulModelMutation(replaceModelDeclaration(bound, declaration([calculatedProperty('input', '=100'), manualProperty('result')]), freshColumns()));

    expect(storedModelCells(next).B1).toBe('23');
    expect(storedModelCells(next, 'other').B1).toBe('40');
    expect(calculatedModelCells(next).sheet.A1).toMatchObject({ value: 100 });
    expect(calculatedModelCells(next).other.A1).toMatchObject({ value: 100 });
  });

  it('freezes several calculated-to-manual transitions from the complete old workbook while overwriting manual-to-calculated', () => {
    const old = declaration([manualProperty('input'), calculatedProperty('double', '=@A[1]*2'), calculatedProperty('total', '=@B[1]+@A[1]'), { ...calculatedProperty('text', '="=1+2"'), type: 'string' }]);
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', columnCount: 4, rowCount: 2, cells: { A1: '3', A2: '4' } });
    const bound = bindModelSheets(modelWorkbook(old, [sheet]), ['sheet']);
    const changed = declaration([manualProperty('total'), calculatedProperty('input', '=100'), manualProperty('double'), manualProperty('text')]);

    const next = successfulModelMutation(replaceModelDeclaration(bound, changed, freshColumns()));

    expect(storedModelCells(next).A1).toBe('9');
    expect(storedModelCells(next).A2).toBe('12');
    expect(storedModelCells(next).C1).toBe('6');
    expect(storedModelCells(next).C2).toBe('8');
    expect(decodeCellTextLiteral(storedModelCells(next).D1!)).toBe('=1+2');
    expect(calculatedModelCells(next).sheet.B1).toMatchObject({ value: 100 });
    expect(Object.keys(next.documents.sheet!.modelFormulaBindings!)).toEqual(['input']);
  });

  it('handles zero properties and zero rows, with stable template bindings ready for future rows', () => {
    const bound = bindModelSheets(modelWorkbook(model, [makeSheet(), makeSheet('other', 0)]), ['sheet', 'other']);

    const empty = successfulModelMutation(replaceModelDeclaration(bound, declaration([]), freshColumns()));
    const grown = successfulModelMutation(replaceModelDeclaration(empty, declaration([manualProperty('new'), calculatedProperty('sum', '=@A[1]+1')]), freshColumns()));

    expect(empty.documents.sheet!.content.rows).toBe(bound.documents.sheet!.content.rows);
    expect(empty.documents.sheet!.content.columns).toEqual([]);
    expect(empty.documents.sheet!.content.cells).toEqual({});
    expect(storedModelCells(grown).A1).toBeUndefined();
    expect(calculatedModelCells(grown).sheet.B1).toMatchObject({ error: '#VALUE!' });
    expect(grown.documents.other!.content.rows).toEqual([]);
    expect(grown.documents.other!.modelFormulaBindings!.sum).toBeDefined();
  });

  it('can explicitly reconcile metadata-only bindings without treating metadata storage as a transformation', () => {
    const workbook = modelWorkbook(model, [makeSheet()]);
    const sheet = workbook.documents.sheet!;
    workbook.documents.sheet = {
      ...sheet,
      modelId: model.id,
      modelColumnBindings: Object.fromEntries(model.columns.map((property, index) => [property.id, sheet.content.columns[index]!])),
    };
    const metadata = workbook;

    const next = successfulModelMutation(replaceModelDeclaration(metadata, declaration([model.columns[2]!, model.columns[0]!, model.columns[1]!]), freshColumns()));

    expect(storedModelCells(metadata).C1).toBeUndefined();
    expect(calculatedModelCells(next).sheet.A1).toMatchObject({ value: 10 });
  });

  it('creates missing associations in partially bound metadata without reusing unrelated positional columns', () => {
    const workbook = modelWorkbook(model, [makeSheet()]);
    const sheet = workbook.documents.sheet!;
    workbook.documents.sheet = { ...sheet, modelId: model.id, modelColumnBindings: { input: 'missing-column' } };

    const next = successfulModelMutation(replaceModelDeclaration(workbook, { ...model, name: 'Renamed' }, freshColumns()));

    expect(next.documents.sheet!.content.columns).toEqual(['fresh-1', 'fresh-2', 'fresh-3']);
    expect(storedModelCells(next).A1).toBeUndefined();
  });

  it('changes an unused declaration without touching any sheet', () => {
    const workbook = modelWorkbook(model, [makeSheet()]);
    const next = successfulModelMutation(replaceModelDeclaration(workbook, { ...model, name: 'Renamed' }, freshColumns()));

    expect(next.documents.sheet).toBe(workbook.documents.sheet);
    expect(next.dataModels!.model.name).toBe('Renamed');
  });

  it('rejects unknown and invalid models atomically, and leaves identical declarations as no-ops', () => {
    const workbook = bindModelSheets(modelWorkbook(model, [makeSheet()]), ['sheet']);
    const before = JSON.stringify(workbook);
    const createId = vi.fn(() => 'unused');

    expect(replaceModelDeclaration(workbook, { ...model, id: 'missing' }, createId)).toEqual({ ok: false, reason: 'unknown-model' });
    expect(replaceModelDeclaration({ ...workbook, dataModels: undefined }, model, createId)).toEqual({ ok: false, reason: 'unknown-model' });
    expect(replaceModelDeclaration(workbook, { ...model, columns: [model.columns[0]!, model.columns[0]!] }, createId)).toEqual({ ok: false, reason: 'invalid-model' });
    expect(successfulModelMutation(replaceModelDeclaration(workbook, JSON.parse(JSON.stringify(model)), createId))).toBe(workbook);
    expect(JSON.stringify(workbook)).toBe(before);
    expect(createId).not.toHaveBeenCalled();
  });
});
