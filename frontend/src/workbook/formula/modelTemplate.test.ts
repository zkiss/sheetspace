import { describe, expect, it } from 'vitest';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import type { DataModel, Workbook } from '../core/model';
import { cellIdentityKey } from '../core/cellIdentity';
import { calculationProjection } from '../read/calculationProjection';
import { cellRawContent } from '../read/queries';
import { bindModelFormula, bindModelFormulas, instantiateModelFormula, instantiateModelFormulas } from './modelTemplate';
import { projectStoredFormula } from './storedFormulaProjection';

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

function withDeclarations(workbook: Workbook, declarations: Record<string, string>): Workbook {
  return { ...workbook, dataModels: { ...workbook.dataModels, [model.id]: { ...model, columns: model.columns.map((column) =>
    column.kind === 'calculated' && declarations[column.id] ? { ...column, formula: declarations[column.id] } : column) } } };
}

function calculate(workbook: Workbook) {
  return new FormulaCalculation().updateStored(calculationProjection(workbook), workbook, { kind: 'structure' });
}

describe('single-content model templates', () => {
  it('instantiates implicit rows for unquoted and escaped property names', () => {
    const workbook = instances();
    for (const [raw, expected] of [['=@Result', '=@Result[2]'], ["=@'Owner''s input'", "=@'Owner''s input'[2]"]] as const) {
      const instance = instantiateModelFormula(bindModelFormula(raw, workbook, 'one'), workbook, 1, raw, 'one');
      expect(projectStoredFormula(instance, workbook, 'one').text).toBe(expected);
    }
  });

  it('leaves unbound sheets unchanged and does not repair a missing model target', () => {
    const workbook = instances();
    const sheet = workbook.documents.one;
    const ordinary = { ...workbook, documents: { ...workbook.documents, one: { ...sheet, modelId: undefined } } };
    expect(bindModelFormulas(ordinary, 'one')).toEqual({});
    expect(bindModelFormulas(ordinary, 'missing')).toEqual({});
    expect(instantiateModelFormulas(ordinary, 'one', { missing: bindModelFormula('=1', ordinary, 'one') }).content.cells).toEqual(sheet.content.cells);
    const template = bindModelFormula("=@'Owner''s input'[1]", workbook, 'one');
    const noModel = { ...workbook, dataModels: {} };
    const instance = instantiateModelFormula(template, noModel, 0, "=@'Owner''s input'[1]", 'one');
    expect(instance).toBe(template.content);
    const output = instantiateModelFormulas(noModel, 'one', { result: template });
    expect(output.content.cells).toEqual(sheet.content.cells);
  });
  it('serializes one expression and derives independent instances from declarations, not first-row cells', () => {
    const workbook = instances();
    const bindings = JSON.parse(JSON.stringify(bindModelFormulas(workbook, 'one')));
    const expanded = { ...workbook, documents: Object.fromEntries(workbook.manifest.sheetIds.map((id) => [id, instantiateModelFormulas(workbook, id)])) };

    expect(Object.keys(bindings.result)).toEqual(['content']);
    expect(projectStoredFormula(bindings.result.content, workbook, 'one').text).toBe(model.columns[1].kind === 'calculated' ? model.columns[1].formula : '');
    expect(calculate(expanded).one.B2).toMatchObject({ value: 6 });
    expect(calculate(expanded).one.C2).toMatchObject({ value: 9 });
    expect(calculate(expanded).two.C2).toMatchObject({ value: 12 });
    expect(cellRawContent(workbook.documents.one, 'B1')).toBe('=999');
  });

  it('retains instances by output row identity and derives only newly inserted rows', () => {
    const workbook = instances();
    const bindings = bindModelFormulas(workbook, 'one');
    const initial = { ...instantiateModelFormulas(workbook, 'one', bindings), modelFormulaBindings: bindings };
    const [first, second] = initial.content.rows;
    const key = (rowId: string) => cellIdentityKey({ rowId, columnId: initial.modelColumnBindings!.result });
    const changed = { ...initial, content: { ...initial.content, rows: [second, 'inserted', first] } };
    const next = { ...workbook, documents: { ...workbook.documents, one: changed } };
    const expanded = instantiateModelFormulas(next, 'one', bindings, initial);

    expect(expanded.content.cells[key(first)]).toBe(initial.content.cells[key(first)]);
    expect(expanded.content.cells[key(second)]).toBe(initial.content.cells[key(second)]);
    expect(expanded.content.cells[key('inserted')]).toBe(instantiateModelFormula(bindings.result, next, 1, "=@'Owner''s input'[1]*2", 'one'));
  });

  it('binds empty sheets before rows exist and instantiates after append', () => {
    const empty = instances(0);
    const bindings = JSON.parse(JSON.stringify(bindModelFormulas(empty, 'one')));
    const sheet = empty.documents.one;
    const appended = { ...empty, documents: { ...empty.documents, one: { ...sheet, content: { ...sheet.content, rows: ['first', 'second'] } } } };
    const expanded = instantiateModelFormulas(appended, 'one', bindings);

    expect(instantiateModelFormulas(empty, 'one', bindings).content.rows).toEqual([]);
    expect(projectStoredFormula(cellRawContent(expanded, 'B2')!, appended, 'one').text).toBe("=@'Owner''s input'[2]*2");
  });

  it('preserves mixed anchors, qualifiers, ranges and source spelling', () => {
    const workbook = instances();
    const raw = "= SUM( @A[1]:$B[$1], @$A[1], @A[$1], @'One''s sheet'!A[1], @Two!$A[$1] )";
    const formula = instantiateModelFormula(bindModelFormula(raw, workbook, 'one'), workbook, 1, raw, 'one');

    expect(projectStoredFormula(formula, workbook, 'one').text).toBe("= SUM( @A[2]:$B[$1], @$A[2], @A[$1], @'One''s sheet'!A[2], @Two!$A[$1] )");
  });

  it('calculates cross-sheet dependencies against the complete expanded workbook', () => {
    const workbook = instances();
    const one = instantiateModelFormulas(withDeclarations(workbook, { result: '=@Two!B[1]+1', total: "=SUM(@'Owner''s input'[1]:'Result'[1])" }), 'one', {
      result: bindModelFormula('=@Two!B[1]+1', workbook, 'one'),
      total: bindModelFormula("=SUM(@'Owner''s input'[1]:'Result'[1])", workbook, 'one'),
    });
    const two = instantiateModelFormulas(workbook, 'two');
    const expanded = { ...workbook, documents: { one, two } };
    const results = calculate(expanded);

    expect(projectStoredFormula(cellRawContent(one, 'B2')!, expanded, 'one').text).toBe('=@Two!B[2]+1');
    expect(results.one.B1).toMatchObject({ value: 5 });
    expect(results.one.B2).toMatchObject({ value: 9 });
    expect(results.one.C2).toMatchObject({ value: 12 });
  });

  it('resolves a future row recipe after append and leaves the next offset out of bounds', () => {
    const workbook = instances();
    const template = JSON.parse(JSON.stringify(bindModelFormula('=@A[3]', workbook, 'one')));
    const sheet = workbook.documents.one;
    const beforeAppend = instantiateModelFormulas(withDeclarations(workbook, { result: '=@A[3]' }), 'one', { result: template });
    const appended = { ...workbook, documents: { ...workbook.documents, one: {
      ...sheet, content: { ...sheet.content, rows: [...sheet.content.rows, 'third'], cells: {
        ...sheet.content.cells, [cellIdentityKey({ columnId: sheet.content.columns[0], rowId: 'third' })]: '11',
      } },
    } } };
    const first = instantiateModelFormula(template, appended, 0, '=@A[3]', 'one');
    const second = instantiateModelFormula(template, appended, 1, '=@A[3]', 'one');
    const expanded = instantiateModelFormulas(withDeclarations(appended, { result: '=@A[3]' }), 'one', { result: template });
    const results = calculate({ ...appended, documents: { ...appended.documents, one: expanded } });

    expect(calculate({ ...workbook, documents: { ...workbook.documents, one: beforeAppend } }).one.B1).toMatchObject({ error: '#REF!' });
    expect(projectStoredFormula(first, appended, 'one').text).toBe('=@A[3]');
    expect(results.one.B1).toMatchObject({ value: 11 });
    expect(results.one.B2).toMatchObject({ error: '#REF!' });
    expect(projectStoredFormula(second, appended, 'one').text).toBe('=@A[3]');
  });

  it.each([ `=@'Owner''s input'[${'9'.repeat(400)}]`, '=@Missing!A[1]', '=@A[bad]', '=1+', '=@Z[1]'])('retains invalid declaration %s through serialization and derivation', (raw) => {
    const workbook = instances();
    const template = JSON.parse(JSON.stringify(bindModelFormula(raw, workbook, 'one')));
    const instance = instantiateModelFormula(template, workbook, 0, raw, 'one');

    expect(projectStoredFormula(template.content, workbook, 'one').text).toBe(raw);
    expect(projectStoredFormula(instance, workbook, 'one').text).toBe(raw);
  });

  it('keeps dead property and column identities broken rather than binding replacements', () => {
    const workbook = instances();
    const template = bindModelFormula("=@'Owner''s input'[1]", workbook, 'one');
    const sheet = workbook.documents.one;
    const removed = { ...workbook, documents: { ...workbook.documents, one: { ...sheet,
      modelColumnBindings: { ...sheet.modelColumnBindings, input: 'replacement' },
      content: { ...sheet.content, columns: ['replacement', ...sheet.content.columns.slice(1)] },
    } } };
    const instance = instantiateModelFormula(template, removed, 0, "=@'Owner''s input'[1]", 'one');
    const output = instantiateModelFormulas(withDeclarations(removed, { result: "=@'Owner''s input'[1]" }), 'one', { result: template });

    expect(instance).toBe(template.content);
    expect(calculate({ ...removed, documents: { ...removed.documents, one: output } }).one.B1).toMatchObject({ error: '#REF!' });
  });

  it('retains named and positional targets through property rename and column reorder', () => {
    const workbook = instances();
    const named = bindModelFormula("=@'Owner''s input'[1]", workbook, 'one');
    const positional = bindModelFormula('=@A[1]', workbook, 'one');
    const sheet = workbook.documents.one;
    const renamedModel = { ...model, columns: model.columns.map((column) => column.id === 'input' ? { ...column, name: 'Renamed' } : column) };
    const changed = { ...workbook, dataModels: { [model.id]: renamedModel }, documents: { ...workbook.documents, one: {
      ...sheet, content: { ...sheet.content, columns: [sheet.content.columns[1], sheet.content.columns[0], sheet.content.columns[2]] },
    } } };
    const namedInstance = instantiateModelFormula(named, changed, 0, "=@'Owner''s input'[1]", 'one');
    const positionalInstance = instantiateModelFormula(positional, changed, 0, '=@A[1]', 'one');
    const output = instantiateModelFormulas(withDeclarations(changed, { result: "=@'Owner''s input'[1]", total: '=@A[1]' }), 'one', { result: named, total: positional });
    const results = calculate({ ...changed, documents: { ...changed.documents, one: output } });

    expect(projectStoredFormula(namedInstance, changed, 'one').text).toBe('=@Renamed[1]');
    expect(projectStoredFormula(positionalInstance, changed, 'one').text).toBe('=@B[1]');
    expect(results.one.A1).toMatchObject({ value: 1 });
    expect(results.one.C1).toMatchObject({ value: 1 });
  });

  it('evaluates errors and conditional branches without destructively replacing invalid text', () => {
    const workbook = instances();
    for (const [raw, error] of [['=1+', '#PARSE!'], ['=@Missing!A[1]', '#REF!'], ["=@'Missing'[1]", '#REF!'], ['=@Z[1]', '#REF!'], ['=@A[3]', '#REF!'], ['=@B[1]', '#CYCLE!'], ['=IF(TRUE, 7, @A[999])', undefined]] as const) {
      const one = instantiateModelFormulas(withDeclarations(workbook, { result: raw }), 'one', { result: bindModelFormula(raw, workbook, 'one') });
      const updated = { ...workbook, documents: { ...workbook.documents, one } };

      expect(calculate(updated).one.B1, raw).toMatchObject(error ? { error } : { value: 7 });
      expect(projectStoredFormula(cellRawContent(one, 'B1')!, updated, 'one').text).toBe(raw);
    }
  });
});
