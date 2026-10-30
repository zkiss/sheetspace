import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import type { Workbook } from '../core/model';
import { prepareUserFormula } from './formulaPreparation';
import { analyzeStoredFormula } from './storedFormulaAnalysis';
import { decodeStoredFormula, encodeStoredFormula, type StoredFormula } from './storedFormula';

const sheet = sheetDocument({ id: 'inputs-id', name: 'Inputs', rowCount: 2, columnCount: 2 });
const workbook = workbookWithSheets([sheet]);
const prepare = (text: string) => prepareUserFormula(text, workbook, sheet.id);
const analyze = (formula: StoredFormula) => analyzeStoredFormula(encodeStoredFormula(formula), workbook);

describe('stored identity analysis', () => {
  it('overlays complete references independently in a mixed invalid expression', () => {
    const content = prepare('=@Inputs!A[1]+@Missing!B[2]+@A[0]+???+@B[2]');

    const analysis = analyzeStoredFormula(content, workbook);

    expect(analysis.references.map(({ live }) => live)).toEqual([true, false, true]);
    expect(analysis.references[0].reference).toMatchObject({ kind: 'canonical', sheetId: sheet.id, coordinate: { columnId: sheet.content.columns[0], rowId: sheet.content.rows[0] } });
    expect(analysis.references[1].reference).toBeUndefined();
    expect(analysis.result).toMatchObject({ kind: 'error', error: '#PARSE!' });
    expect(analysis.diagnostics.some(({ code }) => code === '#REF!')).toBe(true);
    expect(analysis.formula.text).toBe(decodeStoredFormula(content).text);
  });

  it.each(['=@foo-1[bad]+3', '=~F1["=@Inputs!A[1]",[]]', '="@Inputs!A[1]"'])('never infers identities from literal text %s', (text) => {
    const analysis = analyzeStoredFormula(prepare(text), workbook);

    expect(analysis.references).toEqual([]);
    expect(analysis.formula).toEqual({ text, occurrences: [] });
  });

  it('overlays every AST reference without changing nonreference nodes', () => {
    const analysis = analyzeStoredFormula(prepare('=SUM((@A[1]),-@B[2])+1*TRUE+"x"'), workbook);

    expect(analysis.result.kind).toBe('formula');
    expect(JSON.stringify(analysis.result)).toContain('"kind":"canonical"');
    expect(JSON.stringify(analysis.result)).not.toContain('"kind":"cell"');
    expect(analysis.references.every(({ live }) => live)).toBe(true);
    expect(analysis.diagnostics).toEqual([]);
  });

  it('retains original range endpoint order and property identities in the overlay', () => {
    const modeled: Workbook = { ...workbook, documents: { [sheet.id]: { ...sheet, modelId: 'model', modelColumnBindings: { cost: sheet.content.columns[1] } } }, dataModels: { model: { id: 'model', name: 'Model', columns: [{ id: 'cost', name: 'Cost', kind: 'manual', type: 'float' }] } } };
    const content = prepareUserFormula('=@Cost[2]:Cost[1]+@B[2]:A[1]', modeled, sheet.id);

    const analysis = analyzeStoredFormula(content, modeled);

    expect(analysis.references[0].reference).toMatchObject({ propertyId: 'cost', range: { startPropertyId: 'cost', endPropertyId: 'cost', start: { columnId: sheet.content.columns[1], rowId: sheet.content.rows[1] }, end: { columnId: sheet.content.columns[1], rowId: sheet.content.rows[0] } } });
    expect(analysis.references[1].reference?.range).toEqual({ start: { columnId: sheet.content.columns[1], rowId: sheet.content.rows[1] }, end: { columnId: sheet.content.columns[0], rowId: sheet.content.rows[0] } });
  });

  it('never retries unresolved slots or supplies missing sheet context on read', () => {
    const content = prepareUserFormula('=@A[1]+@Missing!B[2]', workbook);
    const replacement = sheetDocument({ id: 'new', name: 'Missing', rowCount: 2, columnCount: 2 });
    const changed = workbookWithSheets([sheet, replacement]);

    const analysis = analyzeStoredFormula(content, changed, sheet.id);

    expect(analysis.references.map(({ live }) => live)).toEqual([false, false]);
    expect(analysis.formula).toEqual(decodeStoredFormula(content));
    expect(analysis.result).toMatchObject({ kind: 'formula', expression: { kind: 'binary', left: { kind: 'invalid-reference' }, right: { kind: 'invalid-reference' } } });
  });

  it('does not fall back from deleted sheet identities to same-name replacements', () => {
    const content = prepare('=@Inputs!A[1]');
    const replacement = sheetDocument({ id: 'new', name: 'Inputs', rowCount: 2, columnCount: 2 });

    const analysis = analyzeStoredFormula(content, workbookWithSheets([replacement]), replacement.id);

    expect(analysis.references[0]).toMatchObject({ live: false, reference: { sheetId: sheet.id } });
    expect(analysis.references[0].slots.map(({ live }) => live)).toEqual([false, false, false]);
  });

  it('reports independently missing row and column targets without replacing identities', () => {
    const content = prepare('=@A[1]+@B[2]');
    const changed = { ...sheet, content: { ...sheet.content, columns: [sheet.content.columns[0], 'replacement-column'], rows: ['replacement-row', sheet.content.rows[1]] } };

    const analysis = analyzeStoredFormula(content, workbookWithSheets([changed]));

    expect(analysis.references.map(({ slots }) => slots.map(({ live }) => live))).toEqual([[true, true, false], [true, false, true]]);
    expect(analysis.references.map(({ reference }) => reference?.coordinate)).toEqual([{ columnId: sheet.content.columns[0], rowId: sheet.content.rows[0] }, { columnId: sheet.content.columns[1], rowId: sheet.content.rows[1] }]);
  });

  it('does not interpret references without provenance as fresh input', () => {
    const analysis = analyze({ text: '=@A[1]', occurrences: [] });

    expect(analysis.references[0]).toMatchObject({ live: false, slots: [] });
    expect(analysis.result).toMatchObject({ kind: 'formula', expression: { kind: 'invalid-reference' } });
  });

  it('classifies identical column and property spellings by occurrence origins rather than global names', () => {
    const modeled = sheetDocument({ id: 'modeled', name: 'Modeled', rowCount: 2, columnCount: 2 });
    const mixed: Workbook = { ...workbookWithSheets([sheet, { ...modeled, modelId: 'model', modelColumnBindings: { property: modeled.content.columns[1] } }]), dataModels: { model: { id: 'model', name: 'Model', columns: [{ id: 'property', name: 'A', kind: 'manual', type: 'float' }] } } };
    const content = prepareUserFormula('=@Inputs!A[1]+@Modeled!A[1]', mixed, sheet.id);

    const analysis = analyzeStoredFormula(content, mixed);

    expect(analysis.references.map(({ live }) => live)).toEqual([true, true]);
    expect(analysis.references[0].reference).not.toHaveProperty('propertyId');
    expect(analysis.references[1].reference).toMatchObject({ propertyId: 'property', coordinate: { columnId: modeled.content.columns[1] } });
  });

  it('accepts contiguous split origins and keeps zero-width dormant markers explicit', () => {
    const formula = decodeStoredFormula(prepare('=@Inputs!A[1]'));
    const occurrence = formula.occurrences[0];
    const index = occurrence.origins.findIndex(({ slotId }) => slotId === 'sheet');
    const origin = occurrence.origins[index];
    occurrence.origins.splice(index, 1, { ...origin, end: origin.start + 2 }, { ...origin, start: origin.start + 2 });

    const analysis = analyze(formula);

    expect(analysis.references[0].live).toBe(true);
    expect(analysis.dormantOccurrences).toEqual([]);
  });

  it.each(['guard', 'key', 'kind', 'origins', 'extra-slot', 'endpoints', 'sheet-origin', 'missing-at-origin'])('keeps incompatible %s metadata dormant instead of guessing', (scenario) => {
    const formula = decodeStoredFormula(prepare('=@Inputs!A[1] + 1'));
    const occurrence = formula.occurrences[0];
    if (scenario === 'guard') occurrence.guard.end += 1;
    if (scenario === 'key') occurrence.slots[1].key = 1;
    if (scenario === 'kind') { occurrence.slots[1].kind = 'property'; occurrence.slots[1].key = 'Other'; occurrence.slots[1].targetIds = ['property', sheet.content.columns[0]]; }
    if (scenario === 'origins') occurrence.origins.find(({ slotId }) => slotId === 'c0')!.start += 1;
    if (scenario === 'extra-slot') occurrence.slots.push({ id: 'unused', kind: 'row', key: null, status: 'unresolved', targetIds: [] });
    if (scenario === 'endpoints') occurrence.endpoints = [];
    if (scenario === 'sheet-origin') occurrence.origins.find(({ slotId }) => slotId === 'sheet')!.end -= 1;
    if (scenario === 'missing-at-origin') occurrence.origins = occurrence.origins.filter(({ start, slotId }) => start !== occurrence.guard.start || slotId !== null);

    const analysis = analyze(formula);

    expect(analysis.dormantOccurrences).toHaveLength(1);
    expect(analysis.references.every(({ live }) => !live)).toBe(true);
    expect(analysis.result).toMatchObject({ kind: 'error', error: '#PARSE!' });
  });

  it('round trips dormant malformed guards while recognizing a separate complete candidate', () => {
    const formula = decodeStoredFormula(prepare('=@Inputs!A[1]+@B[2]'));
    // Equal-length punctuation destruction retains all UTF-16 origin offsets.
    formula.text = formula.text.replace('!', '?');
    const content = encodeStoredFormula(formula);

    const first = analyzeStoredFormula(content, workbook);
    const second = analyzeStoredFormula(content, workbook);

    expect(first.dormantOccurrences.map(({ id }) => id)).toEqual(['f0']);
    expect(first.references.filter(({ live }) => live).map(({ occurrence }) => occurrence?.id)).toEqual(['f1']);
    expect(second).toEqual(first);
    expect(encodeStoredFormula(first.formula)).toBe(content);
  });

  it('rejects invalid serialized input rather than invoking a user-input fallback', () => {
    expect(() => analyzeStoredFormula('=@A[1]', workbook)).toThrow('Invalid stored formula');
  });
});
