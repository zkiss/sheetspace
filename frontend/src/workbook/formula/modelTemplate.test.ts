import { describe, expect, it } from 'vitest';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import type { DataModel, Workbook } from '../core/model';
import { cellIdentityKey } from '../core/cellIdentity';
import { calculationProjection } from '../read/calculationProjection';
import { cellRawContent } from '../read/queries';
import { bindModelFormula, bindModelFormulas, instantiateModelFormula, instantiateModelFormulas } from './modelTemplate';
import { instantiatePreparedModelFormulas, prepareModelFormulas } from './preparedModelTemplate';
import { formulaRawForDisplay, formulaRawForStorage } from './reference';

const model: DataModel = { id: 'model', name: 'Model', columns: [
  { id: 'input', name: "Owner's input", kind: 'manual', type: 'float' },
  { id: 'result', name: 'Result', kind: 'calculated', type: 'float', formula: "=@'Owner''s input'[1]*2" },
  { id: 'total', name: 'Total', kind: 'calculated', type: 'float', formula: '=SUM(@A[1]:B[1])' },
] };

function instances(rowCount = 2): Workbook {
  const sheets = ['one', 'two'].map((id, index) => ({
    ...sheetDocument({ id, name: id === 'one' ? "One's sheet" : 'Two', columnCount: 3, rowCount,
      cells: rowCount ? { A1: String(index + 1), A2: String(index + 3), B1: '=999' } : {} }),
    modelId: model.id,
    modelColumnBindings: { input: `${id}:column:1`, result: `${id}:column:2`, total: `${id}:column:3` },
  }));
  return { ...workbookWithSheets(sheets), dataModels: { [model.id]: model } };
}

function expand(workbook: Workbook): Workbook {
  return { ...workbook, documents: Object.fromEntries(workbook.manifest.sheetIds.map((id) => [id, instantiateModelFormulas(workbook, id)])) };
}

describe('model formula row templates', () => {
  it('retains prepared instance bytes by row identity and derives newly inserted rows', () => {
    const workbook = instances();
    const bindings = prepareModelFormulas(workbook, 'one');
    const initial = instantiatePreparedModelFormulas(workbook, 'one', bindings, workbook.documents.one, {});
    const [first, second] = initial.content.rows;
    const columnId = initial.modelColumnBindings!.result;
    const key = (rowId: string) => cellIdentityKey({ rowId, columnId });
    const changed = { ...initial, content: { ...initial.content, rows: [second, 'inserted', first] } };
    const next = { ...workbook, documents: { ...workbook.documents, one: changed } };
    const expanded = instantiatePreparedModelFormulas(next, 'one', bindings, initial, bindings);

    expect(expanded.content.cells[key(first)]).toBe(initial.content.cells[key(first)]);
    expect(expanded.content.cells[key(second)]).toBe(initial.content.cells[key(second)]);
    expect(expanded.content.cells[key('inserted')]).toBeDefined();
    expect(expanded.content.cells[key('inserted')]).not.toBe(initial.content.cells[key(first)]);
  });
  it('binds same-row unquoted and escaped quoted property references', () => {
    const workbook = instances();
    const unquoted = bindModelFormula('=@Result', workbook, 'one');
    const quoted = bindModelFormula("=@'Owner''s input'", workbook, 'one');

    expect(formulaRawForDisplay(instantiateModelFormula(unquoted, workbook, 1), workbook, 'one')).toBe('=@Result[2]');
    expect(formulaRawForDisplay(instantiateModelFormula(quoted, workbook, 1), workbook, 'one')).toBe("=@'Owner''s input'[2]");
  });

  it.each(['@A', "@'Owner''s input'"])('keeps oversized %s row targets serializable and broken rather than rejecting their declarations', (reference) => {
    const workbook = instances();
    const finite = bindModelFormula(`=${reference}[3000000000]`, workbook, 'one');
    expect(finite.references[0].endpoints[0]?.rowIndex).toBe(2999999999);
    expect(instantiateModelFormula(JSON.parse(JSON.stringify(finite)), workbook, 0)).toBe('=@#REF!A[1]');
  });

  it('serializes unrepresentable named row targets as broken endpoints', () => {
    const workbook = instances();
    const unrepresentable = bindModelFormula(`=@'Owner''s input'[${'9'.repeat(400)}]`, workbook, 'one');
    expect(unrepresentable.references[0].endpoints).toEqual([null]);
    expect(instantiateModelFormula(JSON.parse(JSON.stringify(unrepresentable)), workbook, 0)).toBe('=@#REF!A[1]');
  });
  it('calculates independent instances and multiple properties from declarations rather than first-row cells', () => {
    const workbook = instances();
    const expanded = expand(workbook);
    const results = new FormulaCalculation().update(calculationProjection(expanded), { kind: 'structure' });

    expect(results.one.B1).toMatchObject({ value: 2 });
    expect(results.one.B2).toMatchObject({ value: 6 });
    expect(results.one.C2).toMatchObject({ value: 9 });
    expect(results.two.B1).toMatchObject({ value: 4 });
    expect(results.two.C2).toMatchObject({ value: 12 });
    expect(cellRawContent(workbook.documents.one, 'B1')).toBe('=999');
    expect(cellRawContent(expanded.documents.one, 'A2')).toBe('3');
  });

  it('binds empty sheets without row identities and expands their first and subsequent appended rows', () => {
    const empty = instances(0);
    const bindings = JSON.parse(JSON.stringify(bindModelFormulas(empty, 'one')));
    expect(instantiateModelFormulas(empty, 'one', bindings).content.rows).toEqual([]);
    const sheet = empty.documents.one;
    const appended = { ...empty, documents: { ...empty.documents, one: {
      ...sheet, content: { ...sheet.content, rows: ['new-first', 'new-second'], cells: {
        [cellIdentityKey({ columnId: sheet.content.columns[0], rowId: 'new-first' })]: '5',
        [cellIdentityKey({ columnId: sheet.content.columns[0], rowId: 'new-second' })]: '7',
      } },
    } } };
    const expanded = instantiateModelFormulas(appended, 'one', bindings);

    expect(formulaRawForDisplay(cellRawContent(expanded, 'B1')!, appended, 'one')).toBe("=@'Owner''s input'[1]*2");
    expect(formulaRawForDisplay(cellRawContent(expanded, 'B2')!, appended, 'one')).toBe("=@'Owner''s input'[2]*2");
    expect(cellRawContent(expanded, 'B2')).toContain('006e00650077002d007300650063006f006e0064');
  });

  it('preserves mixed anchors, qualified references, ranges and source spelling with no horizontal offset', () => {
    const workbook = instances();
    const raw = "= SUM( @A[1]:$B[$1], @$A[1], @A[$1], @'One''s sheet'!A[1], @Two!$A[$1] )";
    const template = bindModelFormula(raw, workbook, 'one');
    const formula = instantiateModelFormula(template, workbook, 1);

    expect(formulaRawForDisplay(formula, workbook, 'one'))
      .toBe("= SUM( @A[2]:$B[$1], @$A[2], @A[$1], @'One''s sheet'!A[2], @Two!$A[$1] )");
  });

  it('resolves cross-sheet calculations only against the complete expanded workbook', () => {
    const workbook = instances();
    const one = instantiateModelFormulas(workbook, 'one', {
      result: bindModelFormula('=@Two!B[1]+1', workbook, 'one'),
      total: bindModelFormula("=SUM(@'Owner''s input'[1]:'Result'[1])", workbook, 'one'),
    });
    const two = instantiateModelFormulas(workbook, 'two');
    const expanded = { ...workbook, documents: { one, two } };
    const results = new FormulaCalculation().update(calculationProjection(expanded), { kind: 'structure' });

    expect(results.one.B1).toMatchObject({ value: 5 });
    expect(results.one.B2).toMatchObject({ value: 9 });
    expect(results.one.C2).toMatchObject({ value: 12 });
  });

  it('keeps future row offsets in bindings until appended rows make the reference valid', () => {
    const workbook = instances();
    const template = bindModelFormula('=@A[3]', workbook, 'one');
    expect(instantiateModelFormula(template, workbook, 0)).toBe('=@#REF!A[1]');
    const sheet = workbook.documents.one;
    const appended = { ...workbook, documents: { ...workbook.documents, one: {
      ...sheet, content: { ...sheet.content, rows: [...sheet.content.rows, 'third'] },
    } } };

    expect(formulaRawForDisplay(instantiateModelFormula(template, appended, 0), appended, 'one')).toBe('=@A[3]');
    expect(instantiateModelFormula(template, appended, 1)).toBe('=@#REF!A[1]');
  });

  it('keeps retained targets across rename and reorder, and leaves removed targets broken after name reuse', () => {
    const workbook = instances();
    const named = bindModelFormula("=@'Owner''s input'[1]", workbook, 'one');
    const positional = bindModelFormula('=@A[1]', workbook, 'one');
    const sheet = workbook.documents.one;
    const reordered = { ...workbook, dataModels: { model: { ...model, columns: [model.columns[1], { ...model.columns[0], name: 'Renamed' }, model.columns[2]] } },
      documents: { ...workbook.documents, one: { ...sheet, content: { ...sheet.content, columns: [sheet.content.columns[1], sheet.content.columns[0], sheet.content.columns[2]] } } } };

    expect(formulaRawForDisplay(instantiateModelFormula(named, reordered, 1), reordered, 'one')).toBe('=@Renamed[2]');
    expect(formulaRawForDisplay(instantiateModelFormula(positional, reordered, 1), reordered, 'one')).toBe('=@B[2]');

    const removed = { ...reordered, documents: { ...reordered.documents, one: { ...reordered.documents.one,
      modelColumnBindings: { ...sheet.modelColumnBindings, input: 'fresh' },
      content: { ...sheet.content, columns: ['fresh', ...sheet.content.columns.slice(1)] },
    } } };
    expect(instantiateModelFormula(named, removed, 0)).toBe('=@#REF!A[1]');
    expect(instantiateModelFormula(positional, removed, 0)).toBe('=@#REF!A[1]');
  });

  it('accepts existing canonical references without capturing instance row identities', () => {
    const workbook = instances();
    const canonical = formulaRawForStorage("=@A[1]+@'Owner''s input'[$1]", workbook, 'one');
    const template = bindModelFormula(canonical, workbook, 'one');

    expect(formulaRawForDisplay(instantiateModelFormula(template, workbook, 1), workbook, 'one'))
      .toBe("=@A[2]+@'Owner''s input'[$1]");
  });

  it('retains parse errors and computes missing, out-of-bounds and cyclic references through the existing evaluator', () => {
    const workbook = instances();
    for (const [raw, error] of [
      ['=1+', '#PARSE!'], ['=@Missing!A[1]', '#REF!'], ["=@'Missing'[1]", '#REF!'],
      ['=@Z[1]', '#REF!'], ['=@A[3]', '#REF!'], ['=@B[1]', '#CYCLE!'],
      ['=IF(TRUE, 7, @A[999])', undefined],
    ] as const) {
      const template = bindModelFormula(raw, workbook, 'one');
      const one = instantiateModelFormulas(workbook, 'one', { result: template });
      const updated = { ...workbook, documents: { ...workbook.documents, one } };
      const result = new FormulaCalculation().update(calculationProjection(updated), { kind: 'structure' }).one.B1;
      expect(result, raw).toMatchObject(error ? { kind: 'error', error } : { kind: 'number', value: 7 });
    }
  });

  it('handles unbound sheets, unresolved canonical targets and stale property bindings without repairing targets', () => {
    const workbook = instances();
    const sheet = workbook.documents.one;
    const ordinary = { ...workbook, documents: { ...workbook.documents, one: { ...sheet, modelId: undefined } } };
    expect(bindModelFormulas(ordinary, 'one')).toEqual({});
    expect(bindModelFormulas(ordinary, 'missing')).toEqual({});
    expect(instantiateModelFormulas(ordinary, 'one', { missing: bindModelFormula('=1', ordinary, 'one') }).content.cells).toEqual(sheet.content.cells);
    expect(instantiateModelFormula(bindModelFormula('=@#REF!A[1]', workbook, 'one'), workbook, 0)).toBe('=@#REF!A[1]');
    const canonical = formulaRawForStorage("=@'Owner''s input'[1]", workbook, 'one');
    const template = bindModelFormula(canonical, workbook, 'one');
    const noModel = { ...workbook, dataModels: {} };
    expect(instantiateModelFormula(template, noModel, 0)).toBe('=@#REF!A[1]');
    const deletedRow = { ...workbook, documents: { ...workbook.documents, one: { ...sheet, content: { ...sheet.content, rows: [] } } } };
    expect(instantiateModelFormula(bindModelFormula(canonical, deletedRow, 'one'), workbook, 0)).toBe('=@#REF!A[1]');
  });
});
