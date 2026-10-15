import { describe, expect, it } from 'vitest';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { appendColumn, appendRow, renameSheet } from '@workbook/mutations/operations';
import { findSheetById } from '@workbook/read/queries';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

function sheetWithCells(id: string, name: string, cells: Record<string, string>) {
  return sheetDocument({ id, name, cells });
}

describe('incremental formula calculation', () => {
  it('recalculates formulas when ordered grid structure changes', () => {
    const calculation = new FormulaCalculation();
    const inputs = sheetDocument({
      id: 'sheet-1',
      name: 'Inputs',
      cells: {
        A1: '=SUM(@A[2])',
        B1: '=SUM(@C[1])',
      },
      rowCount: 1,
      columnCount: 2,
    });
    let workbook = workbookWithSheets([inputs]);
    const initial = calculation.update(calculationProjection(workbook), { kind: 'structure' });
    expect(initial['sheet-1'].A1).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(initial['sheet-1'].B1).toMatchObject({ kind: 'error', error: '#REF!' });

    workbook = workbookWithSheets([appendRow(findSheetById(workbook, inputs.id)!, 'sheet-1:row:2')]);
    const afterRow = calculation.update(calculationProjection(workbook), { kind: 'structure' });
    expect(afterRow['sheet-1'].A1).toMatchObject({ kind: 'number', value: 0 });
    expect(afterRow['sheet-1'].B1).toMatchObject({ kind: 'error', error: '#REF!' });

    workbook = workbookWithSheets([appendColumn(findSheetById(workbook, inputs.id)!, 'sheet-1:column:3')]);
    const afterColumn = calculation.update(calculationProjection(workbook), { kind: 'structure' });
    expect(afterColumn['sheet-1'].B1).toMatchObject({ kind: 'number', value: 0 });
  });

  it('preserves cross-sheet identity through rename and reload, then isolates deleted-target errors', () => {
    const calculation = new FormulaCalculation();
    const inputs = sheetWithCells('sheet-inputs', 'Inputs', { A1: '7' });
    const outputs = sheetWithCells('sheet-outputs', 'Outputs', {
      A1: '=SUM(@sheet-inputs!A[1])',
      B1: '=SUM(@B[2])',
      B2: '4',
    });
    const workbook = workbookWithSheets([inputs, outputs]);
    calculation.update(calculationProjection(workbook), { kind: 'structure' });
    const renamed = renameSheet(workbook, 'sheet-inputs', 'Renamed Inputs');
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) {
      return;
    }
    const renamedEvaluations: string[] = [];
    expect(calculation.update(
      calculationProjection(renamed.value),
      { kind: 'none' },
      (_sheetId, key) => renamedEvaluations.push(key),
    )['sheet-outputs'].A1).toMatchObject({ kind: 'number', value: 7 });
    expect(renamedEvaluations).toEqual([]);

    const reloaded = new FormulaCalculation().update(
      calculationProjection(renamed.value),
      { kind: 'structure' },
    );
    expect(reloaded['sheet-outputs'].A1).toMatchObject({ kind: 'number', value: 7 });

    const { ['sheet-inputs']: deletedDocument, ...documents } = renamed.value.documents;
    void deletedDocument;
    const deleted = {
      ...renamed.value,
      manifest: { ...renamed.value.manifest, sheetIds: ['sheet-outputs'] },
      documents,
    };
    const deletedResults = calculation.update(
      calculationProjection(deleted),
      { kind: 'structure' },
    );
    expect(deletedResults['sheet-outputs'].A1).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(deletedResults['sheet-outputs'].B1).toMatchObject({ kind: 'number', value: 4 });
  });
});
