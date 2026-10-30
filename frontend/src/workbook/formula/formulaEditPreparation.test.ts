import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { prepareFormulaEdit, prepareUserFormula } from './formulaPreparation';
import { projectStoredFormula } from './storedFormulaProjection';

const sheet = sheetDocument({ id: 'sheet', name: 'Inputs', rowCount: 2, columnCount: 2 });
const workbook = workbookWithSheets([sheet]);

describe('formula edit preparation', () => {
  it('returns identical stored bytes for an unchanged projected draft after a rename', () => {
    const original = prepareUserFormula('=@Inputs!A[1]+3', workbook, sheet.id);
    const renamed = workbookWithSheets([{ ...sheet, name: 'Renamed' }]);
    const draft = projectStoredFormula(original, renamed, sheet.id).text;

    expect(draft).toBe('=@Renamed!A[1]+3');
    expect(prepareFormulaEdit(draft, original, renamed, sheet.id)).toBe(original);
  });

  it('resolves a newly edited reference even when another target has been deleted', () => {
    const original = prepareUserFormula('=@A[1]+@B[1]', workbook, sheet.id);
    const changed = workbookWithSheets([{ ...sheet, content: { ...sheet.content, columns: ['replacement', sheet.content.columns[1]] } }]);
    const draft = projectStoredFormula(original, changed, sheet.id).text.replace('@B[1]', '@B[2]');

    const result = prepareFormulaEdit(draft, original, changed, sheet.id);

    expect(result).toContain(sheet.content.rows[1]);
    expect(projectStoredFormula(result, changed, sheet.id).text).toContain('@B[2]');
  });

  it('preserves malformed fragments and resolves recognizable corrected references', () => {
    const original = prepareUserFormula('=@Missing!A[1]+@B[2]+???', workbook, sheet.id);
    const draft = '=@Inputs!A[1]+@B[2]+???';

    const result = prepareFormulaEdit(draft, original, workbook, sheet.id);

    expect(projectStoredFormula(result, workbook, sheet.id).text).toBe(draft);
    expect(result).toContain(sheet.id);
    expect(result).toContain(sheet.content.columns[1]);
  });

  it('recalculates an unresolved formula after correcting its reference', () => {
    const source = sheetDocument({ id: 'source', name: 'Inputs', rowCount: 1, columnCount: 1, cells: { A1: '4' } });
    const output = sheetDocument({ id: 'output', name: 'Output', rowCount: 1, columnCount: 1 });
    const initial = workbookWithSheets([source, output]);
    const original = prepareUserFormula('=@Missing!A[1]+3', initial, output.id);
    const target = sheetDocument({ id: 'output', name: 'Output', rowCount: 1, columnCount: 1, cells: { A1: original } });
    const before = workbookWithSheets([source, target]);
    const calculation = new FormulaCalculation();
    expect(calculation.updateStored(calculationProjection(before), before, { kind: 'structure' }).output.A1).toMatchObject({ display: '#REF!' });

    const corrected = prepareFormulaEdit('=@Inputs!A[1]+3', original, before, output.id);
    const key = Object.keys(target.content.cells)[0];
    const after = workbookWithSheets([source, { ...target, content: { ...target.content, cells: { [key]: corrected } } }]);

    expect(calculation.updateStored(calculationProjection(after), after, { kind: 'cells', cells: [{ sheetId: output.id, key: 'A1' }] }).output.A1).toMatchObject({ value: 7 });
  });
});
