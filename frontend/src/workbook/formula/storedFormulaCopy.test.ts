import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellIdentityAt } from '../core/cellIdentity';
import type { Workbook } from '../core/model';
import { prepareUserFormula } from './formulaPreparation';
import { decodeStoredFormula, encodeStoredFormula } from './storedFormula';
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

    expect(decodeStoredFormula(result).text).toBe(expected);
    expect(analyzeStoredFormula(result, workbook).references.every(({ live }) => live)).toBe(true);
  });

  it('copies implicit targets to the destination sheet while retaining explicit targets', () => {
    const content = prepare('=@A[1]+@Source!$B[$2]+@Other!C[1]');

    const result = copy(content, 'A1', 'B2', other);

    expect(decodeStoredFormula(result).text).toBe('=@B[2]+@Source!$B[$2]+@Other!D[2]');
    const analysis = analyzeStoredFormula(result, workbook);
    expect(analysis.references.map(({ sheet }) => sheet?.id)).toEqual(['other', 'source', 'other']);
    expect(analysis.references.every(({ live }) => live)).toBe(true);
  });

  it('uses current identity positions rather than stale source spelling', () => {
    const content = prepare('=@A[1]+@Source!A[1]');
    const changed = structuredClone(workbook);
    changed.documents.source.name = 'Renamed';
    changed.documents.source.content.columns.reverse();
    changed.documents.source.content.rows.reverse();

    const result = copy(content, 'A1', 'B2', source, changed);

    expect(projectStoredFormula(result, changed).text).toBe('=@D[4]+@Renamed!D[4]');
    expect(analyzeStoredFormula(result, changed).references.every(({ live }) => live)).toBe(true);
  });

  it('retains named endpoints where possible and falls back for an unnamed range endpoint', () => {
    const book = modeledWorkbook();
    const content = prepare("=@'Sales'' 🧮'+SUM(@'Sales'' 🧮'[1]:Cost[2])", book);

    const result = copy(content, 'A1', 'B2', source, book);

    expect(decodeStoredFormula(result).text).toBe('=@Cost[2]+SUM(@B[2]:C[3])');
    expect(analyzeStoredFormula(result, book).references.every(({ live }) => live)).toBe(true);
    expect(decodeStoredFormula(result).occurrences[0].slots.find(({ id }) => id === 'c0')?.targetIds).toEqual(['cost', source.content.columns[1]]);
  });

  it('copies named columns to unnamed columns on another sheet with anchored implicit rows', () => {
    const book = modeledWorkbook();
    const content = prepare("=@$'Sales'' 🧮'", book);

    const result = copy(content, 'A1', 'A1', other, book);

    expect(decodeStoredFormula(result).text).toBe('=@$A[1]');
    expect(analyzeStoredFormula(result, book).references[0].live).toBe(true);
  });

  it('retains destination property identities and both named range endpoints on cross-sheet copies', () => {
    const book = modeledWorkbook();
    book.documents.other = { ...other, modelId: 'model', modelColumnBindings: { revenue: other.content.columns[0], cost: other.content.columns[1] } };
    const content = prepare("=SUM(@$'Sales'' 🧮'[$1]:$Cost[2])", book);

    const result = copy(content, 'A1', 'A2', other, book);

    expect(decodeStoredFormula(result).text).toBe("=SUM(@$'Sales'' 🧮'[$1]:$Cost[3])");
    const analysis = analyzeStoredFormula(result, book);
    expect(analysis.references[0].live).toBe(true);
    expect(analysis.references[0].reference?.range).toMatchObject({ start: { columnId: other.content.columns[0], rowId: other.content.rows[0] }, end: { columnId: other.content.columns[1], rowId: other.content.rows[2] } });
  });

  it('preserves unresolved text, literals and malformed internal-looking fragments', () => {
    const content = prepare('=@A[1]+@Missing!B[2]+@foo-1[bad]+@A[0]+"=@A[1] =~F1"+');

    const result = copy(content);

    expect(decodeStoredFormula(result).text).toBe('=@B[2]+@Missing!B[2]+@foo-1[bad]+@A[0]+"=@A[1] =~F1"+');
    expect(decodeStoredFormula(result).occurrences[1].slots).toEqual(decodeStoredFormula(content).occurrences[1].slots);
  });

  it('translates independent live axes of unresolved endpoints without granting identity to their spelling', () => {
    const content = prepare('=@A[6]+@F[1]+SUM(@A[6]:B[2])');

    const result = copy(content);

    expect(decodeStoredFormula(result).text).toBe('=@B[6]+@F[2]+SUM(@B[6]:C[3])');
    const analysis = analyzeStoredFormula(result, workbook);
    expect(analysis.references.map(({ live }) => live)).toEqual([false, false, false]);
    expect(analysis.references[0].slots.find(({ slot }) => slot.kind === 'row')?.slot.status).toBe('unresolved');
    expect(analysis.references[1].slots.find(({ slot }) => slot.kind === 'column')?.slot.status).toBe('unresolved');
  });

  it.each(['column', 'row', 'sheet', 'property'])('keeps retained dead %s targets dead after replacement while translating other live axes', (kind) => {
    const book = modeledWorkbook();
    const content = prepare(kind === 'property' ? "=@'Sales'' 🧮'[1]" : '=@A[1]', book);
    const changed = structuredClone(book);
    if (kind === 'column') changed.documents.source.content.columns[0] = 'replacement';
    if (kind === 'row') changed.documents.source.content.rows[0] = 'replacement';
    if (kind === 'sheet') {
      changed.documents.source = { ...source, id: 'replacement' };
      delete changed.documents.source;
      changed.documents.replacement = { ...source, id: 'replacement' };
    }
    if (kind === 'property') changed.dataModels!.model.columns[0].id = 'replacement';
    const result = copyStoredFormula(content, cellIdentityAt(other.content, 'A1')!, cellIdentityAt(other.content, 'B2')!, changed, { sourceSheetId: other.id, destinationSheetId: other.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const analysis = analyzeStoredFormula(result.content, changed);
    const dead = decodeStoredFormula(content).occurrences[0].slots.find((slot) => slot.kind === kind)!;
    expect(analysis.formula.occurrences[0].slots.find(({ id }) => id === dead.id)).toEqual(dead);
    expect(analysis.references[0].live).toBe(false);
    if (kind === 'column' || kind === 'property') expect(analysis.references[0].slots.find(({ slot }) => slot.kind === 'row')?.index).toBe(1);
    if (kind === 'row') expect(analysis.references[0].slots.find(({ slot }) => slot.kind === 'column')?.index).toBe(1);
  });

  it('materializes a dead implicit row without rebinding it when a live property becomes positional', () => {
    const book = modeledWorkbook();
    const content = prepare("=@'Sales'' 🧮'", book);
    const changed = structuredClone(book);
    changed.documents.source.content.rows[0] = 'replacement';
    const result = copyStoredFormula(content, cellIdentityAt(other.content, 'A2')!, cellIdentityAt(source.content, 'C2')!, changed, { sourceSheetId: other.id, destinationSheetId: source.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(decodeStoredFormula(result.content).text).toBe('=@C[1]');
    expect(analyzeStoredFormula(result.content, changed).references[0].live).toBe(false);
    expect(decodeStoredFormula(result.content).occurrences[0].slots[2]).toEqual(decodeStoredFormula(content).occurrences[0].slots[2]);
  });

  it('translates a live named range endpoint without dropping its independently dead sibling', () => {
    const book = modeledWorkbook();
    book.dataModels!.model.columns = [...book.dataModels!.model.columns, { id: 'dead', name: 'Gone', kind: 'manual', type: 'float' }];
    book.documents.source.modelColumnBindings = { ...book.documents.source.modelColumnBindings, dead: source.content.columns[2] };
    const content = prepare("=SUM(@'Sales'' 🧮'[1]:Gone[2])", book);
    const changed = structuredClone(book);
    changed.dataModels!.model.columns = changed.dataModels!.model.columns.slice(0, -1);

    const result = copy(content, 'A1', 'B2', source, changed);

    expect(decodeStoredFormula(result).text).toBe('=SUM(@Cost[2]:Gone[3])');
    expect(decodeStoredFormula(result).occurrences[0].slots.find(({ id }) => id === 'c1')).toEqual(decodeStoredFormula(content).occurrences[0].slots.find(({ id }) => id === 'c1'));
    expect(analyzeStoredFormula(result, changed).references[0].slots.find(({ slot }) => slot.id === 'c0')?.live).toBe(true);
    expect(analyzeStoredFormula(result, changed).references[0].slots.find(({ slot }) => slot.id === 'c1')?.live).toBe(false);
  });

  it('rejects only an unrepresentable named-to-positional range conversion with a dead property pair', () => {
    const book = modeledWorkbook();
    const content = prepare("=SUM(@'Sales'' 🧮'[1]:Cost[2])", book);
    const changed = structuredClone(book);
    changed.dataModels!.model.columns[1].id = 'replacement';

    const result = copyStoredFormula(content, cellIdentityAt(source.content, 'A1')!, cellIdentityAt(source.content, 'C1')!, changed, { sourceSheetId: source.id, destinationSheetId: source.id });

    expect(result).toEqual({ ok: false, reason: 'unresolved-coordinate' });
    expect(decodeStoredFormula(content).text).toBe("=SUM(@'Sales'' 🧮'[1]:Cost[2])");
  });

  it('keeps identical bytes on no-op copies, including noncanonical codec whitespace', () => {
    const content = prepare('=@$A[$1]+@Missing!A[1]+@foo-1[bad]');
    const spaced = '=~F1' + JSON.stringify(JSON.parse(content.slice(4)), null, 2);

    expect(copy(spaced, 'A1', 'A1')).toBe(spaced);
    expect(copy(spaced)).toBe(spaced);
  });

  it('remaps UTF-16 offsets and duplicate-looking occurrences without touching dormant metadata', () => {
    const book = modeledWorkbook();
    const formula = decodeStoredFormula(prepare("=\"🧮\"+@'Sales'' 🧮'+@'Sales'' 🧮'+@A[1]", book));
    formula.occurrences[2].slots[1].key = 3;
    const dormant = formula.occurrences[2];
    const result = copy(encodeStoredFormula(formula), 'A1', 'B2', source, book);
    const transformed = decodeStoredFormula(result);

    expect(transformed.text).toBe('="🧮"+@Cost[2]+@Cost[2]+@A[1]');
    expect(transformed.occurrences.map(({ guard }) => transformed.text.slice(guard.start, guard.end))).toEqual(['@Cost[2]', '@Cost[2]', '@A[1]']);
    expect(transformed.occurrences[2].slots).toEqual(dormant.slots);
    expect(transformed.occurrences[2].origins.map(({ start, end, slotId }) => [slotId, transformed.text.slice(start, end)])).toEqual(dormant.origins.map(({ start, end, slotId }) => [slotId, formula.text.slice(start, end)]));
    expect(analyzeStoredFormula(result, book).dormantOccurrences.map(({ id }) => id)).toEqual([dormant.id]);
    expect(analyzeStoredFormula(result, book).references.slice(0, 2).every(({ live }) => live)).toBe(true);
  });

  it('rejects unavailable source and translated coordinates atomically', () => {
    const content = prepare('=@A[1]+@E[5]');
    const context = { sourceSheetId: source.id, destinationSheetId: source.id };

    expect(copyStoredFormula(content, cellIdentityAt(source.content, 'A1')!, cellIdentityAt(source.content, 'B2')!, workbook, context)).toEqual({ ok: false, reason: 'unresolved-coordinate' });
    expect(copyStoredFormula(content, { columnId: 'missing', rowId: 'missing' }, cellIdentityAt(source.content, 'B2')!, workbook, context)).toEqual({ ok: false, reason: 'unresolved-coordinate' });
    expect(decodeStoredFormula(content).text).toBe('=@A[1]+@E[5]');
  });

  it.each(['=@A[1]', '=~F1[]', '=~F1bad'])('rejects invalid stored content without legacy fallback: %s', (content) => {
    expect(() => copy(content)).toThrow('Invalid stored formula');
  });

  it.each(['=@foo-1[bad]+3', '=~F1["=@Source!A[1]",[]]'])('preserves literal internal-looking formulas without reinterpretation: %s', (text) => {
    const content = prepare(text);

    expect(copy(content, 'A1', 'B2', other)).toBe(content);
  });
});
