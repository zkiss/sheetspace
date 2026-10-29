import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellIdentityAt } from '../core/cellIdentity';
import { prepareUserFormula } from './formulaPreparation';
import { decodeStoredFormula, encodeStoredFormula } from './storedFormula';
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

    expect(decodeStoredFormula(result).text).toBe('=SUM(@$B[$1], @C[1], @C[1], "@A[1]")');
    expect(analyzeStoredFormula(result, workbook).references.every(({ live }) => live)).toBe(true);
  });

  it('qualifies unmoved dependencies when a formula moves across sheets and maps moved targets', () => {
    const content = prepare('=@A[1]+@B[1]+@Source!C[1]');

    const result = move(content, [mapping('A1', 'A2', other)], other.id);

    expect(decodeStoredFormula(result).text).toBe('=@A[2]+@Source!B[1]+@Source!C[1]');
    expect(analyzeStoredFormula(result, workbook).references.map(({ sheet }) => sheet?.id)).toEqual(['other', 'source', 'source']);
    expect(analyzeStoredFormula(result, workbook).references.every(({ live }) => live)).toBe(true);
  });

  it('updates explicit and newly inserted quoted qualifiers on external dependants', () => {
    const content = prepare('=@Source!A[1]+@A[1]+@A[1]');

    const result = move(content, [mapping('A1', 'B2', other)]);
    const transformed = decodeStoredFormula(result);

    expect(transformed.text).toBe("=@'Other'' 🧮'!B[2]+@'Other'' 🧮'!B[2]+@'Other'' 🧮'!B[2]");
    expect(transformed.occurrences.map(({ guard }) => transformed.text.slice(guard.start, guard.end))).toEqual(Array(3).fill("@'Other'' 🧮'!B[2]"));
    expect(analyzeStoredFormula(result, workbook).references.every(({ live }) => live)).toBe(true);
    expect(projectStoredFormula(result, workbook).text).toBe(transformed.text);
  });

  it('maps a dependant located on a different sheet without adopting that caller context for its targets', () => {
    const content = prepareUserFormula('=@Source!A[1]+@A[1]', workbook, other.id);

    const result = moveStoredFormula(content, workbook, other.id, other.id, [mapping('A1', 'B2', other)]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(decodeStoredFormula(result.content).text).toBe("=@'Other'' 🧮'!B[2]+@A[1]");
    const analysis = analyzeStoredFormula(result.content, workbook);
    expect(analysis.references.every(({ live }) => live)).toBe(true);
    expect(analysis.references.map(({ reference }) => reference?.coordinate)).toEqual([cellIdentityAt(other.content, 'B2'), cellIdentityAt(other.content, 'A1')]);
  });

  it.each([
    ['=SUM(@B[2]:A[1])', [['A1', 'A2'], ['B1', 'B2'], ['A2', 'A3'], ['B2', 'B3']], '=SUM(@B[3]:A[2])'],
    ['=SUM(@A[1]:B[1])', [['A1', 'C1']], '=SUM(@B[1]:C[1])'],
    ['=SUM(@A[1]:B[1])', [['A1', 'B1']], '=SUM(@B[1]:B[1])'],
  ] as const)('preserves exact rectangular membership and endpoint direction: %s', (text, moves, expected) => {
    const result = move(prepare(text), moves.map(([from, to]) => mapping(from, to)));

    expect(decodeStoredFormula(result).text).toBe(expected);
    expect(analyzeStoredFormula(result, workbook).references.every(({ live }) => live)).toBe(true);
  });

  it('maps both endpoints and sheet identity when an entire range moves across sheets', () => {
    const content = prepare('=SUM(@$B[$1]:A[1])');

    const result = move(content, [mapping('A1', 'B2', other), mapping('B1', 'C2', other)]);

    expect(decodeStoredFormula(result).text).toBe("=SUM(@'Other'' 🧮'!$C[$2]:B[2])");
    expect(analyzeStoredFormula(result, workbook).references[0].live).toBe(true);
  });

  it.each([
    ['=SUM(@A[1]:C[1])+@A[1]', [mapping('B1', 'E1')]],
    ['=@A[1]+SUM(@A[1]:B[1])', [mapping('A1', 'A1', other)]],
  ] as const)('rejects holes and split-sheet ranges atomically: %s', (text, mappings) => {
    const content = prepare(text);

    expect(moveStoredFormula(content, workbook, source.id, source.id, mappings)).toEqual({ ok: false, reason: 'unrepresentable-range' });
    expect(decodeStoredFormula(content).text).toBe(text);
  });

  it('retains named identity or uses positional endpoints when mapped columns are unnamed', () => {
    const book = { ...workbook, documents: { ...workbook.documents, source: { ...source, modelId: 'model', modelColumnBindings: { revenue: source.content.columns[0], cost: source.content.columns[1] } } }, dataModels: { model: { id: 'model', name: 'Model', columns: [
      { id: 'revenue', name: 'Revenue', kind: 'manual' as const, type: 'float' as const },
      { id: 'cost', name: 'Cost', kind: 'manual' as const, type: 'float' as const },
    ] } } };
    for (const [text, mappings, expected] of [
      ['=@Revenue', [mapping('A1', 'B1')], '=@Cost'],
      ['=@Revenue', [mapping('A1', 'C1')], '=@C[1]'],
      ['=SUM(@Revenue[1]:Cost[1])', [mapping('A1', 'B1'), mapping('B1', 'C1')], '=SUM(@B[1]:C[1])'],
    ] as const) {
      const content = prepareUserFormula(text, book, source.id);
      const result = move(content, [...mappings], source.id, book);

      expect(decodeStoredFormula(result).text).toBe(expected);
      expect(analyzeStoredFormula(result, book).references.every(({ live }) => live)).toBe(true);
    }
  });

  it('preserves mixed invalid and malformed fragments while mapping live references', () => {
    const content = prepare('=@A[1]+@Missing!A[1]+@foo-1[bad]+@A[0]+"=~F1"+');

    const result = move(content, [mapping('A1', 'B2')]);

    expect(decodeStoredFormula(result).text).toBe('=@B[2]+@Missing!A[1]+@foo-1[bad]+@A[0]+"=~F1"+');
    expect(decodeStoredFormula(result).occurrences[1].slots).toEqual(decodeStoredFormula(content).occurrences[1].slots);
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

  it('qualifies a partially dead implicit reference without modifying its independent identity slots', () => {
    const content = prepare('=@A[1]');
    const changed = structuredClone(workbook);
    changed.documents.source.content.rows[0] = 'replacement';

    const result = move(content, [], other.id, changed);

    expect(decodeStoredFormula(result).text).toBe('=@Source!A[1]');
    expect(decodeStoredFormula(result).occurrences[0].slots.slice(1)).toEqual(decodeStoredFormula(content).occurrences[0].slots.slice(1));
    expect(analyzeStoredFormula(result, changed).references[0].live).toBe(false);
  });

  it('moves an independently live row while retaining the dead property pair at a locatable cell', () => {
    const bound = { ...source, modelId: 'model', modelColumnBindings: { lost: source.content.columns[0] } };
    const original = { ...workbookWithSheets([bound, other]), dataModels: { model: { id: 'model', name: 'Model', columns: [{ id: 'lost', name: 'Lost', kind: 'manual' as const, type: 'float' as const }] } } };
    const content = prepareUserFormula('=@Lost[1]', original, source.id);
    const changed = structuredClone(original);
    changed.dataModels.model.columns[0].id = 'replacement';

    const result = move(content, [mapping('A1', 'B2')], source.id, changed);

    expect(decodeStoredFormula(result).text).toBe('=@Lost[2]');
    expect(decodeStoredFormula(result).occurrences[0].slots[1]).toEqual(decodeStoredFormula(content).occurrences[0].slots[1]);
    expect(analyzeStoredFormula(result, changed).references[0].slots.find(({ slot }) => slot.kind === 'row')?.index).toBe(1);
    expect(analyzeStoredFormula(result, changed).references[0].live).toBe(false);
  });

  it('preserves a dead range property pair while mapping its live sibling and rows', () => {
    const bound = { ...source, modelId: 'model', modelColumnBindings: { first: source.content.columns[0], next: source.content.columns[1], lost: source.content.columns[2] } };
    const original = { ...workbookWithSheets([bound, other]), dataModels: { model: { id: 'model', name: 'Model', columns: ['First', 'Next', 'Lost'].map((name) => ({ id: name.toLowerCase(), name, kind: 'manual' as const, type: 'float' as const })) } } };
    const content = prepareUserFormula('=SUM(@First[1]:Lost[1])', original, source.id);
    const changed = structuredClone(original);
    changed.dataModels.model.columns.pop();

    const result = move(content, [mapping('A1', 'B2'), mapping('B1', 'C2'), mapping('C1', 'D2')], source.id, changed);

    expect(decodeStoredFormula(result).text).toBe('=SUM(@Next[2]:Lost[2])');
    expect(decodeStoredFormula(result).occurrences[0].slots.find(({ id }) => id === 'c1')).toEqual(decodeStoredFormula(content).occurrences[0].slots.find(({ id }) => id === 'c1'));
    expect(analyzeStoredFormula(result, changed).references[0].slots.find(({ slot }) => slot.id === 'c0')?.live).toBe(true);
    expect(analyzeStoredFormula(result, changed).references[0].live).toBe(false);
    expect(moveStoredFormula(content, changed, source.id, source.id, [mapping('A1', 'C2'), mapping('B1', 'D2'), mapping('C1', 'E2')])).toEqual({ ok: false, reason: 'unrepresentable-range' });
  });

  it('maps dormant UTF-16 guards and zero-width markers past earlier inserted qualifiers', () => {
    const formula = decodeStoredFormula(prepare('="🧮"+@A[1]+@A[1]'));
    formula.occurrences[1].slots[1].key = 2;
    const dormant = formula.occurrences[1];

    const result = move(encodeStoredFormula(formula), [], other.id);
    const transformed = decodeStoredFormula(result);

    expect(transformed.text).toBe('="🧮"+@Source!A[1]+@A[1]');
    expect(transformed.occurrences[1].slots).toEqual(dormant.slots);
    expect(transformed.occurrences[1].origins.map(({ start, end, slotId }) => [slotId, transformed.text.slice(start, end)])).toEqual(dormant.origins.map(({ start, end, slotId }) => [slotId, formula.text.slice(start, end)]));
    expect(analyzeStoredFormula(result, workbook).dormantOccurrences.map(({ id }) => id)).toEqual([dormant.id]);
  });

  it('keeps an adjacent preceding dormant guard and end marker outside a newly inserted qualifier', () => {
    const formula = decodeStoredFormula(prepare('=@B[2]+@A[1]'));
    const dormant = formula.occurrences[0];
    dormant.guard.end = formula.occurrences[1].guard.start;
    dormant.origins.push({ start: dormant.guard.end, end: dormant.guard.end, slotId: 'r0' });

    const result = move(encodeStoredFormula(formula), [], other.id);
    const transformed = decodeStoredFormula(result);

    expect(transformed.text).toBe('=@B[2]+@Source!A[1]');
    expect(transformed.occurrences[0]).toEqual(dormant);
    expect(transformed.occurrences[0].guard.end).toBe(transformed.occurrences[1].guard.start);
    expect(analyzeStoredFormula(result, workbook).dormantOccurrences.map(({ id }) => id)).toEqual([dormant.id]);
    expect(analyzeStoredFormula(result, workbook).references[1].live).toBe(true);
  });

  it('returns byte-identical content for no-op moves and unchanged identity mappings', () => {
    const content = prepare('=@A[1]+@Missing!A[1]');
    const spaced = '=~F1' + JSON.stringify(JSON.parse(content.slice(4)), null, 2);

    expect(move(spaced)).toBe(spaced);
    expect(move(spaced, [mapping('A1', 'A1')])).toBe(spaced);
    expect(move(spaced, [mapping('E5', 'D5')])).toBe(spaced);
  });

  it.each(['=@foo-1[bad]+3', '=~F1["=@Source!A[1]",[]]'])('preserves literal internal-looking formulas without reinterpretation: %s', (text) => {
    const content = prepare(text);

    expect(move(content, [mapping('A1', 'B2')], other.id)).toBe(content);
  });

  it.each(['=@A[1]', '=~F1[]', '=~F1bad'])('rejects invalid stored content without fallback: %s', (content) => {
    expect(() => move(content)).toThrow('Invalid stored formula');
  });
});
