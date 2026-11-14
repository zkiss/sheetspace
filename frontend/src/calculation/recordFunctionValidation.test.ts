import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { setCustomFunction } from './customFunctions';
import { FormulaCalculation } from './formulaCalculation';
import { validRecordValues } from './recordValidation';

describe('record validation with workbook functions', () => {
  it('uses the same bound body identity as workbook calculation after reordering', () => {
    const sheet = sheetDocument({ id: 'records', name: 'Records', cells: { A1: '3', A2: '0', B1: '=firstvalue()' } });
    sheet.modelId = 'model';
    sheet.modelColumnBindings = { value: sheet.content.columns[0] };
    const source = { ...workbookWithSheets([sheet]), dataModels: { model: { id: 'model', name: 'Model', columns: [
      { id: 'value', name: 'Value', kind: 'manual' as const, type: 'float' as const },
    ] } } };
    const admitted = setCustomFunction(source, { name: 'firstvalue', parameters: [], body: '=@A[1]' });
    if (!admitted.ok) throw new Error(admitted.error);
    const reordered = { ...sheet, content: { ...sheet.content, rows: [sheet.content.rows[1], sheet.content.rows[0], ...sheet.content.rows.slice(2)] } };
    const workbook = { ...admitted.workbook, documents: { records: reordered } };
    const result = new FormulaCalculation().update(calculationProjection(workbook), { kind: 'structure' });
    expect(result.records.B2).toMatchObject({ kind: 'number', value: 3 });
    expect(validRecordValues(workbook, sheet.id, { value: '=1/firstvalue()' })).toBe(true);
    expect(validRecordValues({ ...workbook, functions: [] }, sheet.id, { value: '=firstvalue()' })).toBe(false);
  });
});
