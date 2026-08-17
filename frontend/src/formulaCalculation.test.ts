import { describe, expect, it } from 'vitest';
import { calculationProjection } from './calculationProjection';
import { FormulaCalculation } from './formulaCalculation';
import {
  appendColumn,
  appendRow,
  commitCellRawContent,
  findSheetById,
  renameSheet,
} from './workbook';
import { sheetDocument, workbookWithSheets } from './test/workbookFactories';

function sheetWithCells(id: string, name: string, cells: Record<string, string>) {
  return sheetDocument({ id, name, cells });
}

describe('incremental formula calculation', () => {
  it('recomputes direct and transitive diamond dependents without evaluating unrelated formulas', () => {
    const calculation = new FormulaCalculation();
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '1',
      B1: '=SUM(A1)',
      C1: '=SUM(B1)',
      D1: '=SUM(A1)',
      E1: '=SUM(C1,D1)',
      H1: '10',
      I1: '=SUM(H1)',
    });
    const workbook = workbookWithSheets([inputs]);
    calculation.update(calculationProjection(workbook), { kind: 'structure' });
    const evaluated: string[] = [];

    const nextWorkbook = commitCellRawContent(workbook, 'sheet-1', 'A1', '2');
    const results = calculation.update(
      calculationProjection(nextWorkbook),
      { kind: 'cells', cells: [{ sheetId: 'sheet-1', key: 'A1' }] },
      (sheetId, key) => evaluated.push(`${sheetId}:${key}`),
    );

    expect(new Set(evaluated)).toEqual(new Set([
      'sheet-1:B1',
      'sheet-1:C1',
      'sheet-1:D1',
      'sheet-1:E1',
    ]));
    expect(results['sheet-1'].E1).toMatchObject({ kind: 'number', value: 4 });
    expect(results['sheet-1'].I1).toMatchObject({ kind: 'number', value: 10 });
  });

  it('returns the cached snapshot without evaluation when calculation has no impact', () => {
    const calculation = new FormulaCalculation();
    const workbook = workbookWithSheets([
      sheetWithCells('sheet-1', 'Inputs', { A1: '=SUM(1)' }),
    ]);
    const initial = calculation.update(calculationProjection(workbook), { kind: 'structure' });
    const evaluated: string[] = [];

    const cached = calculation.update(
      calculationProjection(workbook),
      { kind: 'none' },
      (_sheetId, key) => evaluated.push(key),
    );

    expect(cached).toBe(initial);
    expect(evaluated).toEqual([]);
  });

  it('initializes a fresh calculation even when the first reported impact is none', () => {
    const calculation = new FormulaCalculation();
    const workbook = workbookWithSheets([
      sheetWithCells('sheet-1', 'Inputs', { A1: '=SUM(2)' }),
    ]);

    expect(calculation.update(
      calculationProjection(workbook),
      { kind: 'none' },
    )['sheet-1'].A1).toMatchObject({ kind: 'number', value: 2 });
  });

  it('isolates forked cache changes until a calculation is chosen for commit', () => {
    const calculation = new FormulaCalculation();
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '1',
      B1: '=A1',
      C1: '10',
      D1: '=C1',
    });
    calculation.update(calculationProjection(workbookWithSheets([inputs])), { kind: 'structure' });

    const abandoned = calculation.fork();
    const abandonedInputs = findSheetById(
      commitCellRawContent(workbookWithSheets([inputs]), inputs.id, 'A1', '2'),
      inputs.id,
    )!;
    expect(abandoned.update(
      calculationProjection(workbookWithSheets([abandonedInputs])),
      { kind: 'cells', cells: [{ sheetId: 'sheet-1', key: 'A1' }] },
    )['sheet-1'].B1).toMatchObject({ kind: 'number', value: 2 });

    const chosen = calculation.fork();
    const chosenInputs = findSheetById(
      commitCellRawContent(workbookWithSheets([inputs]), inputs.id, 'C1', '20'),
      inputs.id,
    )!;
    const chosenResults = chosen.update(
      calculationProjection(workbookWithSheets([chosenInputs])),
      { kind: 'cells', cells: [{ sheetId: 'sheet-1', key: 'C1' }] },
    );

    expect(chosenResults['sheet-1'].B1).toMatchObject({ kind: 'number', value: 1 });
    expect(chosenResults['sheet-1'].D1).toMatchObject({ kind: 'number', value: 20 });
  });

  it('tracks dependencies nested in unary and binary arithmetic expressions', () => {
    const calculation = new FormulaCalculation();
    const inputs = sheetWithCells('sheet-inputs', 'Inputs', {
      A1: '2',
      B1: '10',
    });
    const outputs = sheetWithCells('sheet-outputs', 'Outputs', {
      A1: '=-(sheet-inputs!A1 + 3) * 2',
      B1: '=sheet-inputs!B1 + 1',
    });
    calculation.update(calculationProjection(workbookWithSheets([inputs, outputs])), { kind: 'structure' });

    const evaluated: string[] = [];
    const nextInputs = findSheetById(
      commitCellRawContent(workbookWithSheets([inputs]), inputs.id, 'A1', '4'),
      inputs.id,
    )!;
    const results = calculation.update(
      calculationProjection(workbookWithSheets([nextInputs, outputs])),
      { kind: 'cells', cells: [{ sheetId: 'sheet-inputs', key: 'A1' }] },
      (sheetId, key) => evaluated.push(`${sheetId}:${key}`),
    );

    expect(evaluated).toEqual(['sheet-outputs:A1']);
    expect(results['sheet-outputs'].A1).toMatchObject({ kind: 'number', value: -14 });
    expect(results['sheet-outputs'].B1).toMatchObject({ kind: 'number', value: 11 });
  });

  it('tracks dependencies inside comparison operands', () => {
    const calculation = new FormulaCalculation();
    const inputs = sheetWithCells('sheet-inputs', 'Inputs', { A1: '2' });
    const outputs = sheetWithCells('sheet-outputs', 'Outputs', {
      A1: '=4<=sheet-inputs!A1 + 1',
      A2: '=sheet-inputs!A1 + 1>=4',
      B1: '=10>5',
    });
    calculation.update(calculationProjection(workbookWithSheets([inputs, outputs])), { kind: 'structure' });

    const evaluated: string[] = [];
    const nextInputs = findSheetById(
      commitCellRawContent(workbookWithSheets([inputs]), inputs.id, 'A1', '3'),
      inputs.id,
    )!;
    const results = calculation.update(
      calculationProjection(workbookWithSheets([nextInputs, outputs])),
      { kind: 'cells', cells: [{ sheetId: 'sheet-inputs', key: 'A1' }] },
      (sheetId, key) => evaluated.push(`${sheetId}:${key}`),
    );

    expect(evaluated).toEqual(['sheet-outputs:A1', 'sheet-outputs:A2']);
    expect(results['sheet-outputs'].A1).toMatchObject({ kind: 'boolean', value: true });
    expect(results['sheet-outputs'].A2).toMatchObject({ kind: 'boolean', value: true });
    expect(results['sheet-outputs'].B1).toMatchObject({ kind: 'boolean', value: true });
  });

  it('tracks every function argument independently from function evaluation', () => {
    const calculation = new FormulaCalculation();
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '1',
      B1: '2',
      C1: '=FUTURE_LAZY(A1, B1)',
    });
    const workbook = workbookWithSheets([inputs]);
    calculation.update(calculationProjection(workbook), { kind: 'structure' });
    const evaluated: string[] = [];

    const nextWorkbook = commitCellRawContent(workbook, 'sheet-1', 'B1', '3');
    const results = calculation.update(
      calculationProjection(nextWorkbook),
      { kind: 'cells', cells: [{ sheetId: 'sheet-1', key: 'B1' }] },
      (_sheetId, key) => evaluated.push(key),
    );

    expect(evaluated).toEqual(['C1']);
    expect(results['sheet-1'].C1).toMatchObject({ kind: 'error', error: '#NAME!' });
  });

  it('invalidates range and cross-sheet dependency paths by stable sheet id', () => {
    const calculation = new FormulaCalculation();
    const inputs = sheetWithCells('sheet-inputs', 'Inputs', { A1: '2', A2: '3' });
    const outputs = sheetWithCells('sheet-outputs', 'Outputs', {
      A1: '=SUM(sheet-inputs!A1:A2)',
      A2: '=SUM(A1)',
      B1: '=SUM(B2)',
      B2: '9',
    });
    const workbook = workbookWithSheets([inputs, outputs]);
    calculation.update(calculationProjection(workbook), { kind: 'structure' });
    const evaluated: string[] = [];

    const nextWorkbook = commitCellRawContent(workbook, 'sheet-inputs', 'A2', '8');
    const results = calculation.update(
      calculationProjection(nextWorkbook),
      { kind: 'cells', cells: [{ sheetId: 'sheet-inputs', key: 'A2' }] },
      (_sheetId, key) => evaluated.push(key),
    );

    expect(new Set(evaluated)).toEqual(new Set(['A1', 'A2']));
    expect(results['sheet-outputs'].A2).toMatchObject({ kind: 'number', value: 10 });
    expect(results['sheet-outputs'].B1).toMatchObject({ kind: 'number', value: 9 });
  });

  it('recalculates conditional aggregates for criteria, criteria-range, and sum-range edits', () => {
    const calculation = new FormulaCalculation();
    const inputs = sheetWithCells('sheet-inputs', 'Inputs', {
      A1: 'east', A2: 'west', B1: '2', B2: '5', C1: 'east',
    });
    const outputs = sheetWithCells('sheet-outputs', 'Outputs', {
      A1: '=COUNTIF(sheet-inputs!A1:A2, sheet-inputs!C1)',
      A2: '=SUMIF(sheet-inputs!A1:A2, sheet-inputs!C1, sheet-inputs!B1:B2)',
    });
    let workbook = workbookWithSheets([inputs, outputs]);
    calculation.update(calculationProjection(workbook), { kind: 'structure' });

    workbook = commitCellRawContent(workbook, 'sheet-inputs', 'B1', '8');
    expect(calculation.update(
      calculationProjection(workbook),
      { kind: 'cells', cells: [{ sheetId: 'sheet-inputs', key: 'B1' }] },
    )['sheet-outputs'].A2).toMatchObject({ kind: 'number', value: 8 });

    workbook = commitCellRawContent(workbook, 'sheet-inputs', 'A2', 'east');
    expect(calculation.update(
      calculationProjection(workbook),
      { kind: 'cells', cells: [{ sheetId: 'sheet-inputs', key: 'A2' }] },
    )['sheet-outputs']).toMatchObject({
      A1: { kind: 'number', value: 2 },
      A2: { kind: 'number', value: 13 },
    });

    workbook = commitCellRawContent(workbook, 'sheet-inputs', 'C1', 'west');
    expect(calculation.update(
      calculationProjection(workbook),
      { kind: 'cells', cells: [{ sheetId: 'sheet-inputs', key: 'C1' }] },
    )['sheet-outputs']).toMatchObject({
      A1: { kind: 'number', value: 0 },
      A2: { kind: 'number', value: 0 },
    });
  });

  it('removes stale edges when formulas change or clear', () => {
    const calculation = new FormulaCalculation();
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '1',
      B1: '10',
      C1: '=SUM(A1)',
      D1: '=SUM(C1)',
    });
    let workbook = workbookWithSheets([inputs]);
    calculation.update(calculationProjection(workbook), { kind: 'structure' });

    workbook = commitCellRawContent(workbook, 'sheet-1', 'C1', '=SUM(B1)');
    calculation.update(
      calculationProjection(workbook),
      { kind: 'cells', cells: [{ sheetId: 'sheet-1', key: 'C1' }] },
    );
    const stalePathEvaluated: string[] = [];
    workbook = commitCellRawContent(workbook, 'sheet-1', 'A1', '2');
    calculation.update(
      calculationProjection(workbook),
      { kind: 'cells', cells: [{ sheetId: 'sheet-1', key: 'A1' }] },
      (_sheetId, key) => stalePathEvaluated.push(key),
    );
    expect(stalePathEvaluated).toEqual([]);

    const replacementPathEvaluated: string[] = [];
    workbook = commitCellRawContent(workbook, 'sheet-1', 'B1', '20');
    expect(calculation.update(
      calculationProjection(workbook),
      { kind: 'cells', cells: [{ sheetId: 'sheet-1', key: 'B1' }] },
      (_sheetId, key) => replacementPathEvaluated.push(key),
    )['sheet-1'].D1).toMatchObject({ kind: 'number', value: 20 });
    expect(new Set(replacementPathEvaluated)).toEqual(new Set(['C1', 'D1']));

    workbook = commitCellRawContent(workbook, 'sheet-1', 'C1', '');
    expect(calculation.update(
      calculationProjection(workbook),
      { kind: 'cells', cells: [{ sheetId: 'sheet-1', key: 'C1' }] },
    )['sheet-1'].D1).toMatchObject({ kind: 'number', value: 0 });
    const clearedPathEvaluated: string[] = [];
    workbook = commitCellRawContent(workbook, 'sheet-1', 'B1', '30');
    calculation.update(
      calculationProjection(workbook),
      { kind: 'cells', cells: [{ sheetId: 'sheet-1', key: 'B1' }] },
      (_sheetId, key) => clearedPathEvaluated.push(key),
    );
    expect(clearedPathEvaluated).toEqual([]);
  });

  it('recalculates formulas when ordered grid structure changes', () => {
    const calculation = new FormulaCalculation();
    const inputs = sheetDocument({
      id: 'sheet-1',
      name: 'Inputs',
      cells: {
        A1: '=SUM(A2)',
        B1: '=SUM(C1)',
      },
      rowCount: 1,
      columnCount: 2,
    });
    let workbook = workbookWithSheets([inputs]);
    const initial = calculation.update(calculationProjection(workbook), { kind: 'structure' });
    expect(initial['sheet-1'].A1).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(initial['sheet-1'].B1).toMatchObject({ kind: 'error', error: '#REF!' });

    workbook = workbookWithSheets([appendRow(findSheetById(workbook, inputs.id)!)]);
    const afterRow = calculation.update(calculationProjection(workbook), { kind: 'structure' });
    expect(afterRow['sheet-1'].A1).toMatchObject({ kind: 'number', value: 0 });
    expect(afterRow['sheet-1'].B1).toMatchObject({ kind: 'error', error: '#REF!' });

    workbook = workbookWithSheets([appendColumn(findSheetById(workbook, inputs.id)!)]);
    const afterColumn = calculation.update(calculationProjection(workbook), { kind: 'structure' });
    expect(afterColumn['sheet-1'].B1).toMatchObject({ kind: 'number', value: 0 });
  });

  it('preserves cross-sheet identity through rename and reload, then isolates deleted-target errors', () => {
    const calculation = new FormulaCalculation();
    const inputs = sheetWithCells('sheet-inputs', 'Inputs', { A1: '7' });
    const outputs = sheetWithCells('sheet-outputs', 'Outputs', {
      A1: '=SUM(sheet-inputs!A1)',
      B1: '=SUM(B2)',
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

    const { ['sheet-inputs']: _deleted, ...documents } = renamed.value.documents;
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
