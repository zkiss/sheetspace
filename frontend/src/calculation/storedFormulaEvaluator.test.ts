import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { evaluateStoredFormulaCells } from './formulaEvaluator';
import { FormulaCalculation } from './formulaCalculation';
import { buildFormulaDependencyGraph, storedFormulaParser } from './formulaDependencies';

describe('stored formula evaluation', () => {
  it('evaluates retained identities after rename and reports unresolved targets', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '4' } });
    const output = sheetDocument({ id: 'output', name: 'Output', rowCount: 1, columnCount: 2 });
    const original = workbookWithSheets([source, output]);
    const live = prepareUserFormula('=SUM(@Source!A[1],2)', original, output.id);
    const missing = prepareUserFormula('=@Missing!A[1]', original, output.id);
    const changedOutput = sheetDocument({ id: 'output', name: 'Output', rowCount: 1, columnCount: 2, cells: { A1: live, B1: missing } });
    const changed = workbookWithSheets([{ ...source, name: 'Renamed' }, changedOutput]);

    const result = evaluateStoredFormulaCells(calculationProjection(changed), changed);

    expect(result.output.A1).toMatchObject({ kind: 'number', display: '6' });
    expect(result.output.B1).toMatchObject({ kind: 'error', display: '#REF!' });
  });

  it('recalculates stored dependents after a source value changes', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '4' } });
    const output = sheetDocument({ id: 'output', name: 'Output', rowCount: 1, columnCount: 1 });
    const formula = prepareUserFormula('=@Source!A[1]+2', workbookWithSheets([source, output]), output.id);
    const target = sheetDocument({ id: 'output', name: 'Output', rowCount: 1, columnCount: 1, cells: { A1: formula } });
    const initial = workbookWithSheets([source, target]);
    const calculation = new FormulaCalculation();
    expect(calculation.updateStored(calculationProjection(initial), initial, { kind: 'structure' }).output.A1).toMatchObject({ value: 6 });

    const changed = workbookWithSheets([{ ...source, content: { ...source.content, cells: { ...source.content.cells, [Object.keys(source.content.cells)[0]]: '8' } } }, target]);
    const result = calculation.updateStored(calculationProjection(changed), changed, { kind: 'cells', cells: [{ sheetId: source.id, key: 'A1' }] });

    expect(result.output.A1).toMatchObject({ value: 10 });
  });

  it('does not rebind a deleted sheet to a replacement with the same name', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '4' } });
    const output = sheetDocument({ id: 'output', name: 'Output', rowCount: 1, columnCount: 1 });
    const formula = prepareUserFormula('=@Source!A[1]+2', workbookWithSheets([source, output]), output.id);
    const target = sheetDocument({ id: 'output', name: 'Output', rowCount: 1, columnCount: 1, cells: { A1: formula } });
    const replacement = sheetDocument({ id: 'replacement', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '8' } });
    const changed = workbookWithSheets([replacement, target]);

    const graph = buildFormulaDependencyGraph(calculationProjection(changed), storedFormulaParser(changed));
    expect([...graph.dependencies.values()].map((dependencies) => [...dependencies])).toEqual([[]]);
    const calculation = new FormulaCalculation();
    expect(calculation.updateStored(calculationProjection(changed), changed, { kind: 'structure' }).output.A1).toMatchObject({ display: '#REF!' });
    expect(calculation.updateStored(calculationProjection(changed), changed, { kind: 'cells', cells: [{ sheetId: replacement.id, key: 'A1' }] }).output.A1).toMatchObject({ display: '#REF!' });
  });

  it('reports mixed invalid syntax without altering the stored content', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2, cells: { A1: '4' } });
    const formula = prepareUserFormula('=@Sheet!A[1]+@Missing!A[1]+', workbookWithSheets([sheet]), sheet.id);
    const target = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2, cells: { A1: '4', B1: formula } });
    const workbook = workbookWithSheets([target]);

    expect(evaluateStoredFormulaCells(calculationProjection(workbook), workbook).sheet.B1).toMatchObject({ display: '#PARSE!' });
    expect(Object.values(target.content.cells)).toContain(formula);
  });
});
