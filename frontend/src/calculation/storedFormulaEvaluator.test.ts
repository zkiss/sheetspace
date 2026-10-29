import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { analyzeStoredFormula } from '@workbook/formula/storedFormulaAnalysis';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';
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
    expect([...buildFormulaDependencyGraph(calculationProjection(workbook), storedFormulaParser(workbook)).dependencies.values()].map((edges) => [...edges])).toEqual([[]]);
    expect(Object.values(target.content.cells)).toContain(formula);
  });

  it('evaluates nested anchored ranges and tracks every retained cell', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 2, columnCount: 2, cells: { A1: '1', A2: '2', B1: '3', B2: '4' } });
    const output = sheetDocument({ id: 'output', name: 'Output', rowCount: 1, columnCount: 1 });
    const formula = prepareUserFormula('=SUM(SUM(@Source!$A[$1]:$B[$2]),2)', workbookWithSheets([source, output]), output.id);
    const target = sheetDocument({ id: 'output', name: 'Output', rowCount: 1, columnCount: 1, cells: { A1: formula } });
    const workbook = workbookWithSheets([source, target]);

    expect(evaluateStoredFormulaCells(calculationProjection(workbook), workbook).output.A1).toMatchObject({ value: 12 });
    expect([...buildFormulaDependencyGraph(calculationProjection(workbook), storedFormulaParser(workbook)).dependencies.values()][0]?.size).toBe(4);
  });

  it('detects cycles through retained identities', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2 });
    const initial = workbookWithSheets([sheet]);
    const target = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2, cells: {
      A1: prepareUserFormula('=@B[1]', initial, sheet.id),
      B1: prepareUserFormula('=@A[1]', initial, sheet.id),
    } });
    const workbook = workbookWithSheets([target]);
    const result = new FormulaCalculation().updateStored(calculationProjection(workbook), workbook, { kind: 'structure' });

    expect(result.sheet.A1).toMatchObject({ display: '#CYCLE!' });
    expect(result.sheet.B1).toMatchObject({ display: '#CYCLE!' });
    expect([...buildFormulaDependencyGraph(calculationProjection(workbook), storedFormulaParser(workbook)).dependencies.values()].map((edges) => edges.size)).toEqual([1, 1]);
  });

  it('does not depend on replacement rows or columns', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '4' } });
    const output = sheetDocument({ id: 'output', name: 'Output', rowCount: 1, columnCount: 1 });
    const formula = prepareUserFormula('=@Source!A[1]', workbookWithSheets([source, output]), output.id);
    const target = sheetDocument({ id: 'output', name: 'Output', rowCount: 1, columnCount: 1, cells: { A1: formula } });
    for (const content of [
      { ...source.content, rows: ['new-row'] },
      { ...source.content, columns: ['new-column'] },
    ]) {
      const workbook = workbookWithSheets([{ ...source, content }, target]);
      expect(evaluateStoredFormulaCells(calculationProjection(workbook), workbook).output.A1).toMatchObject({ display: '#REF!' });
      expect([...buildFormulaDependencyGraph(calculationProjection(workbook), storedFormulaParser(workbook)).dependencies.values()].map((edges) => edges.size)).toEqual([0]);
    }
  });

  it('evaluates named properties and rejects a replacement property', () => {
    const sheet = { ...sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2, cells: { A1: '4' } }), modelId: 'model', modelColumnBindings: { revenue: 'sheet:column:1' } };
    const model = { id: 'model', name: 'Model', columns: [{ id: 'revenue', name: 'Revenue', kind: 'manual' as const, type: 'float' as const }] };
    const initial = { ...workbookWithSheets([sheet]), dataModels: { model } };
    const formula = prepareUserFormula("=@'Revenue'[1]+1", initial, sheet.id);
    const target = { ...sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2, cells: { A1: '4', B1: formula } }), modelId: 'model', modelColumnBindings: sheet.modelColumnBindings };
    const workbook = { ...initial, documents: { ...initial.documents, sheet: target } };

    expect(evaluateStoredFormulaCells(calculationProjection(workbook), workbook).sheet.B1).toMatchObject({ value: 5 });
    expect([...buildFormulaDependencyGraph(calculationProjection(workbook), storedFormulaParser(workbook)).dependencies.values()][0]?.size).toBe(1);
    const replacement = { ...workbook, dataModels: { model: { ...model, columns: [{ ...model.columns[0]!, id: 'replacement' }] } } };
    expect(evaluateStoredFormulaCells(calculationProjection(replacement), replacement).sheet.B1).toMatchObject({ display: '#REF!' });
    expect([...buildFormulaDependencyGraph(calculationProjection(replacement), storedFormulaParser(replacement)).dependencies.values()][0]?.size).toBe(0);
  });

  it('does not resolve an unqualified reference prepared without sheet context on read', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2, cells: { A1: '4' } });
    const initial = workbookWithSheets([sheet]);
    const formula = prepareUserFormula('=@A[1]', initial);
    const target = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2, cells: { A1: '4', B1: formula } });
    const workbook = workbookWithSheets([target]);
    expect(evaluateStoredFormulaCells(calculationProjection(workbook), workbook).sheet.B1).toMatchObject({ display: '#REF!' });
    expect([...buildFormulaDependencyGraph(calculationProjection(workbook), storedFormulaParser(workbook)).dependencies.values()][0]?.size).toBe(0);
  });

  it('preserves literal internal-looking user formula text without decoding it', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 1 });
    const workbook = workbookWithSheets([sheet]);
    for (const raw of ['=@foo-1[bad]+3', '=~F1["text",[]]']) {
      const formula = prepareUserFormula(raw, workbook, sheet.id);
      expect(projectStoredFormula(formula, workbook, sheet.id).text).toBe(raw);
      expect(analyzeStoredFormula(formula, workbook, sheet.id).result.kind).toBe('error');
    }
  });
});
