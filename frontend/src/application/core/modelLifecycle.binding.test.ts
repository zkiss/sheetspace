import { describe, expect, it, vi } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { bindModelSheets, calculatedModelCells, calculatedProperty, declaration, freshColumns, manualProperty, modelWorkbook, storedModelCells, successfulModelMutation } from '@test-support/modelLifecycleFixtures';
import { bindSheetToModel, unbindSheetFromModel } from './modelLifecycle';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { decodeCellTextLiteral } from '@workbook/core/cellLiteral';
import { classifyCellValue } from '@calculation/formulaValue';
import type { DataModel } from '@workbook/core/model';
import { commitCellRawContent, commitStoredCellContent, renameSheet } from '@workbook/mutations/operations';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import type { Workbook } from '@workbook/core/model';

const writeFormula = (workbook: Workbook, sheetId: string, key: string, formula: string) =>
  commitStoredCellContent(workbook, sheetId, key, prepareUserFormula(formula, workbook, sheetId));

const model = declaration([manualProperty('input'), calculatedProperty('result', '=@A[1]*2')]);
const makeSheet = (columnCount = 2, rowCount = 2) => sheetDocument({ id: 'sheet', name: 'Sheet', columnCount, rowCount, cells: rowCount && columnCount ? { A1: '3', ...(columnCount > 1 ? { B1: 'overwritten' } : {}) } : {} });

describe('explicit positional binding', () => {
  it('removes unused rows and their presentation while retaining populated row identity', () => {
    const base = makeSheet();
    const [first, second] = base.content.rows;
    const sheet = { ...base, presentation: { ...base.presentation, rowHeights: { [second!]: 42 } } };
    const bound = bindModelSheets(modelWorkbook(model, [sheet]), ['sheet']).documents.sheet!;

    expect(bound.content.rows).toEqual([first]);
    expect(bound.presentation.rowHeights).toEqual({});
    expect(bound.content.columns).toHaveLength(2);
  });
  it.each([0, 1, 2, 4])('reconciles width %i to the declaration and retains populated rows', (width) => {
    const sheet = makeSheet(width);
    const workbook = modelWorkbook(model, [sheet]);

    const bound = bindModelSheets(workbook, ['sheet']);
    const next = bound.documents.sheet!;

    expect(next.content.columns).toHaveLength(2);
    expect(next.content.columns.slice(0, Math.min(width, 2))).toEqual(sheet.content.columns.slice(0, 2));
    expect(next.content.rows).toEqual(width ? [sheet.content.rows[0]] : []);
    expect(next.modelColumnBindings).toEqual({ input: next.content.columns[0], result: next.content.columns[1] });
    expect(projectStoredFormula(next.modelFormulaBindings!.result.content, bound, 'sheet').text).toBe('=@A[1]*2');
    expect(storedModelCells(bound).A1).toBe(width ? '3' : undefined);
    if (width) expect(calculatedModelCells(bound).sheet.B1).toMatchObject({ kind: 'number', value: 6 });
    else expect(calculatedModelCells(bound).sheet.B1).toBeUndefined();
    expect(calculatedModelCells(bound).sheet.B2).toBeUndefined();
    expect(workbook.documents.sheet).toBe(sheet);
    expect(sheet.modelId).toBeUndefined();
  });

  it('preserves manual formulas and ordinary inputs while calculating each independent sheet instance', () => {
    const first = sheetDocument({ id: 'first', name: 'First', columnCount: 2, rowCount: 2, cells: { A2: '4' } });
    const second = sheetDocument({ id: 'second', name: 'Second', columnCount: 2, rowCount: 1, cells: { A1: '11' } });
    const workbook = modelWorkbook(model, [first, second]);
    const bound = bindModelSheets(writeFormula(workbook, 'first', 'A1', '=1+2'), ['first', 'second']);

    expect(storedModelCells(bound, 'first').A1).toBe('=1+2');
    expect(storedModelCells(bound, 'first').A2).toBe('4');
    expect(calculatedModelCells(bound).first.B1).toMatchObject({ value: 6 });
    expect(calculatedModelCells(bound).first.B2).toMatchObject({ value: 8 });
    expect(calculatedModelCells(bound).second.B1).toMatchObject({ value: 22 });
  });

  it('prunes extra column data and presentation while retaining surviving presentation', () => {
    const base = makeSheet(3);
    const [a, b, c] = base.content.columns;
    const row = base.content.rows[0]!;
    const firstCell = cellIdentityKey({ rowId: row, columnId: a! });
    const removedCell = cellIdentityKey({ rowId: row, columnId: c! });
    const sheet = { ...base, presentation: { rowHeights: { [row]: 44 }, columnWidths: { [a!]: 81, [b!]: 99, [c!]: 105 }, formatOverrides: {
      rows: { [row]: { fontWeight: 'bold' as const } }, columns: { [a!]: { fillColor: '#123456' as const }, [c!]: { fontWeight: 'bold' as const } }, cells: { [firstCell]: { horizontalAlignment: 'right' as const }, [removedCell]: { fontWeight: 'bold' as const } },
    } }, content: { ...base.content, cells: { ...base.content.cells, [removedCell]: 'discard' } } };

    const next = bindModelSheets(modelWorkbook(model, [sheet]), ['sheet']).documents.sheet!;

    expect(next.frame).toBe(sheet.frame);
    expect(next.presentation.rowHeights).toEqual(sheet.presentation.rowHeights);
    expect(next.presentation.columnWidths).toEqual({ [a!]: 81, [b!]: 99 });
    expect(next.presentation.formatOverrides).toEqual({ rows: sheet.presentation.formatOverrides.rows, columns: { [a!]: { fillColor: '#123456' } }, cells: { [firstCell]: { horizontalAlignment: 'right' } } });
    expect(next.content.cells[removedCell]).toBeUndefined();
  });

  it('allows empty sheets and zero properties without retaining unused allocation', () => {
    const emptyRows = bindModelSheets(modelWorkbook(model, [makeSheet(1, 0)]), ['sheet']);
    const sheet = makeSheet(2);
    const emptyProperties = bindModelSheets(modelWorkbook(declaration([]), [sheet]), ['sheet']);

    expect(emptyRows.documents.sheet!.content.rows).toEqual([]);
    expect(emptyRows.documents.sheet!.content.cells).toEqual({});
    expect(emptyRows.documents.sheet!.modelFormulaBindings?.result).toBeDefined();
    expect(emptyProperties.documents.sheet!.content).toEqual({ kind: 'tabular', rows: [], columns: [], cells: {} });
  });

  it('preserves parseable broken manual references without damaging valid conditional branches', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', columnCount: 2, rowCount: 2 });

    const workbook = writeFormula(modelWorkbook(model, [sheet]), 'sheet', 'A1', '=@Missing!A[1]');
    const bound = bindModelSheets(writeFormula(workbook, 'sheet', 'A2', '=IF(TRUE,7,@Missing!A[1])'), ['sheet']);
    const unbound = successfulModelMutation(unbindSheetFromModel(bound, 'sheet'));

    expect(calculatedModelCells(bound).sheet.A1).toMatchObject({ error: '#REF!' });
    expect(calculatedModelCells(bound).sheet.A2).toMatchObject({ value: 7 });
    expect(calculatedModelCells(bound).sheet.B2).toMatchObject({ value: 14 });
    expect(decodeCellTextLiteral(storedModelCells(unbound).B1!)).toBe('#REF!');
    expect(storedModelCells(unbound).B2).toBe('14');
  });
});

describe('explicit unbinding and model switching', () => {
  it.each([
    ['=1/3', { kind: 'number', value: 1 / 3 }],
    ['=TRUE', { kind: 'boolean', value: true }],
    ['="=1+2"', { kind: 'text', value: '=1+2' }],
    ['="001"', { kind: 'text', value: '001' }],
    ['=1/0', { kind: 'text', value: '#DIV/0!' }],
    ['=unfinished(', { kind: 'text', value: '#PARSE!' }],
    ['=@Missing!A[1]', { kind: 'text', value: '#REF!' }],
    ['=@B[1]', { kind: 'text', value: '#CYCLE!' }],
    ['=@A[1]', { kind: 'blank' }],
  ] as const)('freezes %s as a non-executable underlying value', (formula, expected) => {
    const blankInput = sheetDocument({ id: 'sheet', name: 'Sheet', columnCount: 2, rowCount: 1, cells: { B1: 'existing' } });
    const type = expected.kind === 'boolean' ? 'boolean' : expected.kind === 'text' && !expected.value.startsWith('#') ? 'string' : 'float';
    const bound = bindModelSheets(modelWorkbook(declaration([manualProperty('input'), { ...calculatedProperty('result', formula), type }]), [blankInput]), ['sheet']);

    const unbound = successfulModelMutation(unbindSheetFromModel(bound, 'sheet'));
    const raw = storedModelCells(unbound).B1 ?? '';

    expect(classifyCellValue(raw)).toEqual(expected);
    expect(raw.startsWith('=')).toBe(false);
    expect(unbound.documents.sheet!.modelId).toBeUndefined();
    expect(unbound.documents.sheet!.modelColumnBindings).toBeUndefined();
    expect(unbound.documents.sheet!.modelFormulaBindings).toBeUndefined();
    expect(unbound.documents.sheet!.content.rows).toBe(bound.documents.sheet!.content.rows);
    expect(unbound.documents.sheet!.content.columns).toBe(bound.documents.sheet!.content.columns);
    expect(unbound.documents.sheet!.presentation).toBe(bound.documents.sheet!.presentation);
    expect(unbound.documents.sheet!.frame).toBe(bound.documents.sheet!.frame);
    expect(storedModelCells(JSON.parse(JSON.stringify(unbound))).B1).toBe(storedModelCells(unbound).B1);
  });

  it('freezes from the complete old workbook and retains manual formulas and downstream calculations', () => {
    const other = sheetDocument({ id: 'other', name: 'Other', columnCount: 1, rowCount: 1 });
    const workbook = writeFormula(modelWorkbook(model, [makeSheet(), other]), 'other', 'A1', '=@Sheet!B[1]+1');
    let bound = bindModelSheets(workbook, ['sheet']);
    bound = writeFormula(bound, 'sheet', 'A1', '=2+3');

    const unbound = successfulModelMutation(unbindSheetFromModel(bound, 'sheet'));

    expect(storedModelCells(unbound).A1).toBe('=2+3');
    expect(storedModelCells(unbound).B1).toBe('10');
    expect(calculatedModelCells(unbound).other.A1).toMatchObject({ value: 11 });
    expect(calculatedModelCells(commitCellRawContent(unbound, 'sheet', 'A1', '20')).other.A1).toMatchObject({ value: 11 });
  });

  it('keeps external references to bound calculated properties after the sheet is renamed', () => {
    const consumer = sheetDocument({ id: 'consumer', name: 'Consumer', columnCount: 1, rowCount: 1 });
    const bound = bindModelSheets(modelWorkbook(model, [makeSheet(), consumer]), ['sheet']);
    const withReference = writeFormula(bound, 'consumer', 'A1', '=@Sheet!B[1]');
    const renamed = renameSheet(withReference, 'sheet', 'Renamed sheet');

    expect(renamed).toMatchObject({ ok: true });
    if (!renamed.ok) return;
    expect(projectStoredFormula(storedModelCells(withReference, 'consumer').A1!, renamed.value, 'consumer').text).toBe("=@'Renamed sheet'!B[1]");
    expect(calculatedModelCells(withReference).consumer.A1).toMatchObject({ value: 6 });
    expect(renamed.value.documents.sheet!.name).toBe('Renamed sheet');
    expect(calculatedModelCells(renamed.value).consumer.A1).toMatchObject({ value: 6 });
  });

  it('materializes before a positional switch rather than preserving executable old calculations', () => {
    const old = declaration([manualProperty('input'), { ...calculatedProperty('result', '="=old"'), type: 'string' }]);
    const second = { id: 'second', name: 'Second', columns: [calculatedProperty('new', '=7'), manualProperty('frozen')] };
    const workbook = modelWorkbook(old, [makeSheet()]);
    workbook.dataModels = { ...workbook.dataModels, second };
    const bound = bindModelSheets(workbook, ['sheet']);

    const switched = successfulModelMutation(bindSheetToModel(bound, 'sheet', 'second', freshColumns()));

    expect(switched.documents.sheet!.content.columns).toEqual(bound.documents.sheet!.content.columns);
    expect(decodeCellTextLiteral(storedModelCells(switched).B1!)).toBe('=old');
    expect(calculatedModelCells(switched).sheet.A1).toMatchObject({ value: 7 });
  });

  it('refuses an ordinary replacement in a calculated cell and materializes the derived value when unbinding', () => {
    const bound = bindModelSheets(modelWorkbook(model, [makeSheet()]), ['sheet']);
    const edited = commitCellRawContent(bound, 'sheet', 'B1', '42');
    const unbound = successfulModelMutation(unbindSheetFromModel(edited, 'sheet'));

    expect(edited).toBe(bound);
    expect(storedModelCells(unbound).B1).toBe('6');
  });
});

describe('lifecycle rejection and no-op boundaries', () => {
  it('returns identical state for same-model rebinding and already-unbound sheets', () => {
    const workbook = modelWorkbook(model, [makeSheet()]);
    const bound = bindModelSheets(workbook, ['sheet']);
    const createId = vi.fn(() => 'unused');

    expect(successfulModelMutation(bindSheetToModel(bound, 'sheet', model.id, createId))).toBe(bound);
    expect(successfulModelMutation(unbindSheetFromModel(workbook, 'sheet'))).toBe(workbook);
    expect(createId).not.toHaveBeenCalled();
  });

  it('rejects unknown sheets/models and invalid declarations before changing any content', () => {
    const workbook = modelWorkbook(model, [makeSheet()]);
    const before = JSON.stringify(workbook);
    const createId = vi.fn(() => 'unused');

    expect(bindSheetToModel(workbook, 'missing', model.id, createId)).toEqual({ ok: false, reason: 'unknown-sheet' });
    expect(unbindSheetFromModel(workbook, 'missing')).toEqual({ ok: false, reason: 'unknown-sheet' });
    expect(bindSheetToModel(workbook, 'sheet', 'missing', createId)).toEqual({ ok: false, reason: 'unknown-model' });
    expect(bindSheetToModel({ ...workbook, dataModels: undefined }, 'sheet', model.id, createId)).toEqual({ ok: false, reason: 'unknown-model' });
    expect(bindSheetToModel({ ...workbook, dataModels: { model: { ...model, columns: [{ ...model.columns[0], kind: 'invalid' }] } as unknown as DataModel } }, 'sheet', model.id, createId)).toEqual({ ok: false, reason: 'invalid-model' });
    expect(JSON.stringify(workbook)).toBe(before);
    expect(createId).not.toHaveBeenCalled();
  });
});
