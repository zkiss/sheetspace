import { describe, expect, it } from 'vitest';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { formulaDiagnostic } from '@calculation/formulaValue';

describe('diagnostic lifecycle', () => {
  it('retains stored model and cross-sheet identities through rename and clears them after correction', () => {
    const input = sheetDocument({ id: 'inputs', name: 'Inputs', rowCount: 1, columnCount: 2, cells: { A1: 'three' } });
    const output = sheetDocument({ id: 'summary', name: 'Summary', rowCount: 1, columnCount: 1 });
    const model = { id: 'model', name: 'Model', columns: [
      { id: 'input', name: 'Input', kind: 'manual' as const, type: 'int' as const },
      { id: 'total', name: 'Total', kind: 'calculated' as const, type: 'int' as const, formula: '=@A[1]*2' },
    ] };
    const initial = { ...workbookWithSheets([input, output]), dataModels: { model } };
    const binding = bindSheetToModel(initial, input.id, model.id, () => 'new-column');
    if (!binding.ok) throw new Error(binding.reason);
    const bound = binding.value;
    const formula = prepareUserFormula('=@Inputs!B[1]', bound, output.id);
    const target = sheetDocument({ id: 'summary', name: 'Summary', rowCount: 1, columnCount: 1, cells: { A1: formula } });
    const workbook = { ...bound, documents: { ...bound.documents, summary: target } };
    const calculation = new FormulaCalculation();
    const snapshot = calculation.updateStored(calculationProjection(workbook), workbook, { kind: 'structure' });
    const source = bound.documents.inputs!;
    expect(formulaDiagnostic(snapshot.summary.A1)).toMatchObject({
      cell: { sheetId: 'summary', rowId: target.content.rows[0], columnId: target.content.columns[0] },
      causes: [{ cell: { sheetId: 'inputs', rowId: source.content.rows[0], columnId: source.content.columns[1] }, causes: [
        { message: 'Expected int, got text "three".', cell: { sheetId: 'inputs', rowId: source.content.rows[0], columnId: source.content.columns[0] } },
      ] }],
    });
    const renamed = { ...workbook, documents: { ...workbook.documents, inputs: { ...source, name: 'Renamed' } } };
    const renamedResult = calculation.updateStored(calculationProjection(renamed), renamed, { kind: 'structure' });
    expect(formulaDiagnostic(renamedResult.summary.A1)).toEqual(formulaDiagnostic(snapshot.summary.A1));
    const movedSource = { ...source, name: 'Renamed', content: { ...source.content, rows: ['inserted-row', ...source.content.rows] } };
    const moved = { ...renamed, documents: { ...renamed.documents, inputs: movedSource } };
    const movedResult = calculation.updateStored(calculationProjection(moved), moved, { kind: 'structure' });
    expect(formulaDiagnostic(movedResult.summary.A1)).toEqual(formulaDiagnostic(snapshot.summary.A1));
    const removedSource = { ...movedSource, content: { ...movedSource.content, rows: ['inserted-row'] } };
    const removed = { ...moved, documents: { ...moved.documents, inputs: removedSource } };
    const removedResult = calculation.updateStored(calculationProjection(removed), removed, { kind: 'structure' });
    expect(removedResult.summary.A1).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(formulaDiagnostic(removedResult.summary.A1)).toMatchObject({ cell: { sheetId: 'summary' }, causes: [] });
    const inputKey = cellIdentityKey({ rowId: source.content.rows[0], columnId: source.content.columns[0] });
    const corrected = { ...renamed, documents: { ...renamed.documents, inputs: { ...source, name: 'Renamed', content: { ...source.content, cells: { ...source.content.cells, [inputKey]: '3' } } } } };
    const result = calculation.updateStored(calculationProjection(corrected), corrected, { kind: 'structure' });
    expect(result.summary.A1).toMatchObject({ kind: 'number', value: 6 });
    expect(formulaDiagnostic(result.summary.A1)).toBeUndefined();
  });
  it('preserves typed input provenance through a calculated model column and clears it after correction', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: 'three', B1: '=@A[1]*2' } });
    const projection = calculationProjection(workbookWithSheets([sheet]));
    const source = projection.sheets[0];
    const input = cellIdentityKey({ rowId: source.rows[0], columnId: source.columns[0] });
    const output = cellIdentityKey({ rowId: source.rows[0], columnId: source.columns[1] });
    const typed = { ...source, columnTypes: { [source.columns[0]]: 'int' as const, [source.columns[1]]: 'int' as const } };
    const calculation = new FormulaCalculation();
    calculation.update({ sheets: [typed] }, { kind: 'structure' });
    expect(calculation.diagnostic(sheet.id, output)).toMatchObject({
      message: 'Propagated #VALUE!',
      cell: { sheetId: sheet.id, rowId: source.rows[0], columnId: source.columns[1] },
      causes: [{ message: 'Expected int, got text "three".', cell: { sheetId: sheet.id, rowId: source.rows[0], columnId: source.columns[0] } }],
    });
    calculation.update({ sheets: [{ ...typed, cells: { ...typed.cells, [input]: '3' } }] }, { kind: 'cells', cells: [{ sheetId: sheet.id, key: 'A1' }] });
    expect(calculation.diagnostic(sheet.id, output)).toBeUndefined();
    expect(calculation.diagnostic(sheet.id, input)).toBeUndefined();
  });

  it('keeps the original stable identity when a structural insertion moves an error', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=1/0' } });
    const projection = calculationProjection(workbookWithSheets([sheet]));
    const source = projection.sheets[0];
    const key = cellIdentityKey({ rowId: source.rows[0], columnId: source.columns[0] });
    const calculation = new FormulaCalculation();
    calculation.update(projection, { kind: 'structure' });
    const snapshot = calculation.update({ sheets: [{ ...source, rows: ['inserted-row', ...source.rows] }] }, { kind: 'structure' });
    expect(snapshot.inputs.A2).toMatchObject({ kind: 'error', error: '#DIV/0!' });
    expect(calculation.diagnostic(sheet.id, key)).toMatchObject({
      message: 'Cannot divide 1 by zero.',
      cell: { sheetId: sheet.id, rowId: source.rows[0], columnId: source.columns[0] },
    });
  });
});
