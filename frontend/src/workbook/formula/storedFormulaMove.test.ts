import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellIdentityAt } from '../core/cellIdentity';
import { prepareUserFormula } from './formulaPreparation';
import { analyzeStoredFormula } from './storedFormulaAnalysis';
import { moveStoredFormula } from './storedFormulaMove';
import { projectStoredFormula } from './storedFormulaProjection';

const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 5, columnCount: 5 });
const other = sheetDocument({ id: 'other', name: "Other' 🧮", rowCount: 5, columnCount: 5 });
const workbook = workbookWithSheets([source, other]);
const prepare = (text: string) => prepareUserFormula(text, workbook, source.id);
const mapping = (from: string, to: string, destination = source) => ({ source: { sheetId: source.id, cell: cellIdentityAt(source.content, from)! }, destination: { sheetId: destination.id, cell: cellIdentityAt(destination.content, to)! } });
function move(content: string, mappings: ReturnType<typeof mapping>[] = [], destination = source.id, book = workbook) {
  const result = moveStoredFormula(content, book, source.id, destination, mappings);
  if (!result.ok) throw new Error(result.reason);
  return result.content;
}

describe('stored formula move', () => {
  it('maps targets once, retaining anchors and unrelated text', () => {
    const content = prepare('=SUM(@$A[$1], @B[1], @C[1], "@A[1]")');

    const result = move(content, [mapping('A1', 'B1'), mapping('B1', 'C1')]);

    expect(projectStoredFormula(result, workbook, source.id).text).toBe('=SUM(@$B[$1], @C[1], @C[1], "@A[1]")');
    expect(analyzeStoredFormula(result, workbook, source.id).references.every(({ live }) => live)).toBe(true);
  });

  it('qualifies unmoved dependencies when a formula moves across sheets and maps moved targets', () => {
    const content = prepare('=@A[1]+@B[1]+@Source!C[1]');

    const result = move(content, [mapping('A1', 'A2', other)], other.id);

    expect(projectStoredFormula(result, workbook, other.id).text).toBe('=@A[2]+@Source!B[1]+@Source!C[1]');
    expect(analyzeStoredFormula(result, workbook, other.id).references.every(({ live }) => live)).toBe(true);
  });

  it('updates explicit and newly inserted quoted qualifiers on external dependants', () => {
    const content = prepare('=@Source!A[1]+@A[1]+@A[1]');

    const result = move(content, [mapping('A1', 'B2', other)]);
    const transformed = projectStoredFormula(result, workbook, source.id);

    expect(transformed.text).toBe("=@'Other'' 🧮'!B[2]+@'Other'' 🧮'!B[2]+@'Other'' 🧮'!B[2]");
    expect(analyzeStoredFormula(result, workbook, source.id).references.every(({ live }) => live)).toBe(true);
    expect(projectStoredFormula(result, workbook).text).toBe(transformed.text);
  });

  it('maps a dependant located on a different sheet without adopting that caller context for its targets', () => {
    const content = prepareUserFormula('=@Source!A[1]+@A[1]', workbook, other.id);

    const result = moveStoredFormula(content, workbook, other.id, other.id, [mapping('A1', 'B2', other)]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(projectStoredFormula(result.content, workbook, other.id).text).toBe("=@'Other'' 🧮'!B[2]+@A[1]");
    const analysis = analyzeStoredFormula(result.content, workbook, other.id);
    expect(analysis.references.every(({ live }) => live)).toBe(true);
    expect(analysis.references.map(({ reference }) => reference?.coordinate)).toEqual([cellIdentityAt(other.content, 'B2'), cellIdentityAt(other.content, 'A1')]);
  });

  it.each([
    ['=SUM(@B[2]:A[1])', [['A1', 'A2'], ['B1', 'B2'], ['A2', 'A3'], ['B2', 'B3']], '=SUM(@B[3]:A[2])'],
    ['=SUM(@A[1]:B[1])', [['A1', 'C1']], '=SUM(@B[1]:C[1])'],
    ['=SUM(@A[1]:B[1])', [['A1', 'B1']], '=SUM(@B[1]:B[1])'],
  ] as const)('preserves exact rectangular membership and endpoint direction: %s', (text, moves, expected) => {
    const result = move(prepare(text), moves.map(([from, to]) => mapping(from, to)));

    expect(projectStoredFormula(result, workbook, source.id).text).toBe(expected);
    expect(analyzeStoredFormula(result, workbook, source.id).references.every(({ live }) => live)).toBe(true);
  });

  it('maps both endpoints and sheet identity when an entire range moves across sheets', () => {
    const content = prepare('=SUM(@$B[$1]:A[1])');

    const result = move(content, [mapping('A1', 'B2', other), mapping('B1', 'C2', other)]);

    expect(projectStoredFormula(result, workbook, source.id).text).toBe("=SUM(@'Other'' 🧮'!$C[$2]:B[2])");
    expect(analyzeStoredFormula(result, workbook, source.id).references[0].live).toBe(true);
  });

  it.each([
    ['=SUM(@A[1]:C[1])+@A[1]', [mapping('B1', 'E1')]],
    ['=@A[1]+SUM(@A[1]:B[1])', [mapping('A1', 'A1', other)]],
  ] as const)('rejects holes and split-sheet ranges atomically: %s', (text, mappings) => {
    const content = prepare(text);

    expect(moveStoredFormula(content, workbook, source.id, source.id, mappings)).toEqual({ ok: false, reason: 'unrepresentable-range' });
    expect(projectStoredFormula(content, workbook, source.id).text).toBe(text);
  });

  it('retains named identity or uses positional endpoints when mapped columns are unnamed', () => {
    const book = { ...workbook, documents: { ...workbook.documents, source: { ...source, modelId: 'model', modelColumnBindings: { revenue: source.content.columns[0], cost: source.content.columns[1] } } }, dataModels: { model: { id: 'model', name: 'Model', columns: [
      { id: 'revenue', name: 'Revenue', kind: 'manual' as const, type: 'float' as const },
      { id: 'cost', name: 'Cost', kind: 'manual' as const, type: 'float' as const },
    ] } } };
    for (const [text, mappings, expected] of [
      ['=@Revenue', [mapping('A1', 'B1')], '=@Cost[1]'],
      ['=@Revenue', [mapping('A1', 'C1')], '=@C[1]'],
      ['=SUM(@Revenue[1]:Cost[1])', [mapping('A1', 'B1'), mapping('B1', 'C1')], '=SUM(@B[1]:C[1])'],
    ] as const) {
      const content = prepareUserFormula(text, book, source.id);
      const result = move(content, [...mappings], source.id, book);

      expect(projectStoredFormula(result, book, source.id).text).toBe(expected);
      expect(analyzeStoredFormula(result, book, source.id).references.every(({ live }) => live)).toBe(true);
    }
  });

  it('preserves mixed invalid and malformed fragments while mapping live references', () => {
    const content = prepare('=@A[1]+@Missing!A[1]+@foo-1[bad]+@A[0]+"=~F1"+');

    const result = move(content, [mapping('A1', 'B2')]);

    expect(projectStoredFormula(result, workbook, source.id).text).toBe('=@B[2]+@Missing!A[1]+@foo-1[bad]+@A[0]+"=~F1"+');
  });

  it.each(['column', 'row', 'sheet'])('does not redirect retained dead %s identities onto replacements', (kind) => {
    const content = prepare('=@Source!A[1]');
    const changed = structuredClone(workbook);
    if (kind === 'column') changed.documents.source.content.columns[0] = 'replacement';
    if (kind === 'row') changed.documents.source.content.rows[0] = 'replacement';
    if (kind === 'sheet') {
      delete changed.documents.source;
      changed.documents.replacement = { ...source, id: 'replacement' };
    }

    const result = move(content, [mapping('A1', 'B2')], other.id, changed);

    expect(result).toBe(content);
    expect(analyzeStoredFormula(result, changed).references[0].live).toBe(false);
  });

  it('returns byte-identical content for no-op moves and unchanged identity mappings', () => {
    const content = prepare('=@A[1]+@Missing!A[1]');
    const spaced = content;

    expect(move(spaced)).toBe(spaced);
    expect(move(spaced, [mapping('A1', 'A1')])).toBe(spaced);
    expect(move(spaced, [mapping('E5', 'D5')])).toBe(spaced);
  });

  it.each(['=@foo-1[bad]+3', '=~F1["=@Source!A[1]",[]]'])('preserves literal internal-looking formulas without reinterpretation: %s', (text) => {
    const content = prepare(text);

    expect(move(content, [mapping('A1', 'B2')], other.id)).toBe(content);
  });

});
