import { describe, expect, it } from 'vitest';
import { cellRawContent } from './workbookQueries';
import { evaluateFormulaCells } from './formulaEvaluator';
import { calculationProjection } from './calculationProjection';
import { sheetDocument, workbookWithSheets } from './test/workbookFactories';

describe('formula references, errors, and cycles', () => {
  function sheetWithCells(id: string, name: string, cells: Record<string, string>) {
    return sheetDocument({ id, name, cells });
  }

  it('evaluates persisted sheet references by uuid after the target is renamed', () => {
    const inputs = sheetWithCells('sheet-1', 'Renamed Inputs', {
      A1: '7',
    });
    const outputs = sheetWithCells('sheet-2', 'Outputs', {
      A1: '=SUM(sheet-1!A1)',
    });
    const workbook = workbookWithSheets([inputs, outputs]);

    expect(evaluateFormulaCells(calculationProjection(workbook))['sheet-2'].A1).toMatchObject({
      kind: 'number',
      value: 7,
      display: '7',
    });
  });

  it('does not rebind persisted references when a deleted target placeholder name is reused', () => {
    const replacementInputs = sheetWithCells('sheet-replacement', '__sheetspace_missing_sheet_deleted', {
      A1: '99',
    });
    const outputs = sheetWithCells('sheet-2', 'Outputs', {
      A1: '=SUM(sheet-deleted!A1)',
    });
    const workbook = workbookWithSheets([replacementInputs, outputs]);

    expect(evaluateFormulaCells(calculationProjection(workbook))['sheet-2'].A1).toMatchObject({
      kind: 'error',
      error: '#REF!',
      display: '#REF!',
    });
  });

  it('classifies referenced cells using shared Phase 2 scalar semantics', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '  10 ',
      A2: '-2.25',
      A3: '=SUM(A1:A2)',
      B1: '=SUM(C1)',
      B2: '=SUM(C2)',
      B3: '=SUM(C3)',
      C1: '+1',
      C2: '1.',
      C3: '1e2',
    });
    const workbook = workbookWithSheets([inputs]);

    const results = evaluateFormulaCells(calculationProjection(workbook))['sheet-1'];
    expect(results.A3).toMatchObject({ kind: 'number', value: 7.75, display: '7.75' });
    expect(results.B1).toMatchObject({ kind: 'number', value: 0, display: '0' });
    expect(results.B2).toMatchObject({ kind: 'number', value: 1, display: '1' });
    expect(results.B3).toMatchObject({ kind: 'number', value: 100, display: '100' });
  });

  it('keeps parse, name, ref, and value failures isolated to cell-level results', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '=SUM(A1,)',
      A2: '=NOPE(B1)',
      A3: '=SUM(Missing!A1)',
      A4: '=SUM(B1)',
      A5: '=SUM(C1)',
      A6: '=SUM(K1)',
      A7: '=SUM(A1:K1)',
      A8: '=SUM(A1:)',
      B1: 'text',
      C1: '8',
    });
    const workbook = workbookWithSheets([inputs]);

    const results = evaluateFormulaCells(calculationProjection(workbook))['sheet-1'];
    expect(results.A1).toMatchObject({ kind: 'error', error: '#PARSE!' });
    expect(results.A2).toMatchObject({ kind: 'error', error: '#NAME!' });
    expect(results.A3).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(results.A4).toMatchObject({ kind: 'number', value: 0 });
    expect(results.A5).toMatchObject({ kind: 'number', value: 8 });
    expect(results.A6).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(results.A7).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(results.A8).toMatchObject({ kind: 'error', error: '#PARSE!' });
  });

  it('detects direct, indirect, and cross-sheet cycles without replacing raw formulas', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '=SUM(A1)',
      A2: '=SUM(A3)',
      A3: '=SUM(A2)',
      B1: '=SUM(sheet-2!B1)',
    });
    const outputs = sheetWithCells('sheet-2', 'Outputs', {
      B1: '=SUM(sheet-1!B1)',
    });
    const workbook = workbookWithSheets([inputs, outputs]);

    const results = evaluateFormulaCells(calculationProjection(workbook));
    expect(results['sheet-1'].A1).toMatchObject({ kind: 'error', error: '#CYCLE!' });
    expect(results['sheet-1'].A2).toMatchObject({ kind: 'error', error: '#CYCLE!' });
    expect(results['sheet-1'].A3).toMatchObject({ kind: 'error', error: '#CYCLE!' });
    expect(results['sheet-1'].B1).toMatchObject({ kind: 'error', error: '#CYCLE!' });
    expect(results['sheet-2'].B1).toMatchObject({ kind: 'error', error: '#CYCLE!' });
    expect(cellRawContent(inputs, 'A1')).toBe('=SUM(A1)');
  });
});
