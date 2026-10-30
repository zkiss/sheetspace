import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellIdentityAt } from '../core/cellIdentity';
import type { Workbook } from '../core/model';
import { prepareUserFormula } from './formulaPreparation';
import { analyzeStoredFormula } from './storedFormulaAnalysis';
import { copyStoredFormula } from './storedFormulaCopy';
import { projectStoredFormula } from './storedFormulaProjection';

const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 5, columnCount: 5 });
const other = sheetDocument({ id: 'other', name: 'Other', rowCount: 5, columnCount: 5 });
const workbook = workbookWithSheets([source, other]);
const prepare = (text: string, book = workbook) => prepareUserFormula(text, book, source.id);
function copy(content: string, from = 'A1', to = 'B2', destination = source, book = workbook) {
  const result = copyStoredFormula(content, cellIdentityAt(source.content, from)!, cellIdentityAt(destination.content, to)!, book, { sourceSheetId: source.id, destinationSheetId: destination.id });
  if (!result.ok) throw new Error(result.reason);
  return result.content;
}
function modeledWorkbook(): Workbook {
  return { ...workbook, documents: { ...workbook.documents, source: { ...source, modelId: 'model', modelColumnBindings: { revenue: source.content.columns[0], cost: source.content.columns[1] } } }, dataModels: { model: { id: 'model', name: 'Model', columns: [
    { id: 'revenue', name: "Sales' 🧮", kind: 'manual', type: 'float' },
    { id: 'cost', name: 'Cost', kind: 'manual', type: 'float' },
  ] } } };
}

describe('stored formula copy', () => {
  it.each([
    ['=@A[1]', '=@B[2]'], ['=@$A[1]', '=@$A[2]'], ['=@A[$1]', '=@B[$1]'], ['=@$A[$1]', '=@$A[$1]'],
    ['=SUM(@$B[2]:A[$1])', '=SUM(@$B[3]:B[$1])'],
  ])('translates independently anchored axes and both range endpoints: %s', (text, expected) => {
    const result = copy(prepare(text));

    expect(projectStoredFormula(result, workbook, source.id).text).toBe(expected);
    expect(analyzeStoredFormula(result, workbook, source.id).references.every(({ live }) => live)).toBe(true);
  });

  it('copies implicit targets to the destination sheet while retaining explicit targets', () => {
    const content = prepare('=@A[1]+@Source!$B[$2]+@Other!C[1]');

    const result = copy(content, 'A1', 'B2', other);

    expect(projectStoredFormula(result, workbook, other.id).text).toBe('=@B[2]+@Source!$B[$2]+@Other!D[2]');
    const analysis = analyzeStoredFormula(result, workbook, other.id);
    expect(analysis.references.every(({ live }) => live)).toBe(true);
  });

  it('uses current identity positions rather than stale source spelling', () => {
    const content = prepare('=@A[1]+@Source!A[1]');
    const changed = structuredClone(workbook);
    changed.documents.source.name = 'Renamed';
    changed.documents.source.content.columns.reverse();
    changed.documents.source.content.rows.reverse();

    const result = copy(content, 'A1', 'B2', source, changed);

    expect(projectStoredFormula(result, changed, source.id).text).toBe('=@D[4]+@Renamed!D[4]');
    expect(analyzeStoredFormula(result, changed, source.id).references.every(({ live }) => live)).toBe(true);
  });

  it('retains named endpoints where possible and falls back for an unnamed range endpoint', () => {
    const book = modeledWorkbook();
    const content = prepare("=@'Sales'' 🧮'+SUM(@'Sales'' 🧮'[1]:Cost[2])", book);

    const result = copy(content, 'A1', 'B2', source, book);

    expect(projectStoredFormula(result, book, source.id).text).toBe('=@Cost[2]+SUM(@B[2]:C[3])');
    expect(analyzeStoredFormula(result, book, source.id).references.every(({ live }) => live)).toBe(true);
  });

  it('copies named columns to unnamed columns on another sheet with anchored implicit rows', () => {
    const book = modeledWorkbook();
    const content = prepare("=@$'Sales'' 🧮'", book);

    const result = copy(content, 'A1', 'A1', other, book);

    expect(projectStoredFormula(result, book, other.id).text).toBe('=@$A[1]');
    expect(analyzeStoredFormula(result, book, other.id).references[0].live).toBe(true);
  });

  it('retains destination property identities and both named range endpoints on cross-sheet copies', () => {
    const book = modeledWorkbook();
    book.documents.other = { ...other, modelId: 'model', modelColumnBindings: { revenue: other.content.columns[0], cost: other.content.columns[1] } };
    const content = prepare("=SUM(@$'Sales'' 🧮'[$1]:$Cost[2])", book);

    const result = copy(content, 'A1', 'A2', other, book);

    expect(projectStoredFormula(result, book, other.id).text).toBe("=SUM(@$'Sales'' 🧮'[$1]:$Cost[3])");
    const analysis = analyzeStoredFormula(result, book, other.id);
    expect(analysis.references[0].live).toBe(true);
    expect(analysis.references[0].reference?.range).toMatchObject({ start: { columnId: other.content.columns[0], rowId: other.content.rows[0] }, end: { columnId: other.content.columns[1], rowId: other.content.rows[2] } });
  });

  it('preserves unresolved text, literals and malformed internal-looking fragments', () => {
    const content = prepare('=@A[1]+@Missing!B[2]+@foo-1[bad]+@A[0]+"=@A[1] =~F1"+');

    const result = copy(content);

    expect(projectStoredFormula(result, workbook, source.id).text).toBe('=@B[2]+@Missing!B[2]+@foo-1[bad]+@A[0]+"=@A[1] =~F1"+');
  });

  it('keeps opaque unresolved references unchanged during copy', () => {
    const content = prepare('=@A[6]+@F[1]+SUM(@A[6]:B[2])');
    expect(projectStoredFormula(copy(content), workbook, source.id).text).toBe('=@A[6]+@F[1]+SUM(@A[6]:B[2])');
  });

  it('keeps identical bytes on a no-op copy', () => {
    const content = prepare('=@$A[$1]+@Missing!A[1]+@foo-1[bad]');
    expect(copy(content, 'A1', 'A1')).toBe(content);
  });

  it('copies duplicate references alongside Unicode literals', () => {
    const book = modeledWorkbook();
    const result = copy(prepare('="🧮"+@A[1]+@A[1]', book), 'A1', 'B2', source, book);
    expect(projectStoredFormula(result, book, source.id).text).toBe('="🧮"+@B[2]+@B[2]');
  });

  it('rejects unavailable source and translated coordinates atomically', () => {
    const content = prepare('=@A[1]+@E[5]');
    const context = { sourceSheetId: source.id, destinationSheetId: source.id };

    expect(copyStoredFormula(content, cellIdentityAt(source.content, 'A1')!, cellIdentityAt(source.content, 'B2')!, workbook, context)).toEqual({ ok: false, reason: 'unresolved-coordinate' });
    expect(copyStoredFormula(content, { columnId: 'missing', rowId: 'missing' }, cellIdentityAt(source.content, 'B2')!, workbook, context)).toEqual({ ok: false, reason: 'unresolved-coordinate' });
    expect(projectStoredFormula(content, workbook, source.id).text).toBe('=@A[1]+@E[5]');
  });

  it.each(['=~{', '=~{zzzz}', '=~{}'])('rejects malformed opaque storage: %s', (content) => {
    expect(() => copy(content)).toThrow('Invalid stored formula');
  });

  it.each(['=@foo-1[bad]+3', '=~F1["=@Source!A[1]",[]]'])('preserves literal internal-looking formulas without reinterpretation: %s', (text) => {
    const content = prepare(text);

    expect(copy(content, 'A1', 'B2', other)).toBe(content);
  });
});
