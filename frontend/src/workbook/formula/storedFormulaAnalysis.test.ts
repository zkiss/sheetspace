import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import type { Workbook } from '../core/model';
import { prepareUserFormula } from './formulaPreparation';
import { analyzeStoredFormula } from './storedFormulaAnalysis';

const sheet = sheetDocument({ id: 'inputs-id', name: 'Inputs', rowCount: 2, columnCount: 2 });
const workbook = workbookWithSheets([sheet]);
const prepare = (text: string) => prepareUserFormula(text, workbook, sheet.id);

describe('stored identity analysis', () => {
  it('overlays complete references independently in a mixed invalid expression', () => {
    const content = prepare('=@Inputs!A[1]+@Missing!B[2]+@A[0]+???+@B[2]');

    const analysis = analyzeStoredFormula(content, workbook, sheet.id);

    expect(analysis.references.map(({ live }) => live)).toEqual([true, true]);
    expect(analysis.references[0].reference).toMatchObject({ kind: 'canonical', sheetId: sheet.id, coordinate: { columnId: sheet.content.columns[0], rowId: sheet.content.rows[0] } });
    expect(analysis.result).toMatchObject({ kind: 'error', error: '#PARSE!' });
    expect(analysis.diagnostics.some(({ code }) => code === '#REF!')).toBe(true);
  });

  it.each(['=@foo-1[bad]+3', '=~F1["=@Inputs!A[1]",[]]', '="@Inputs!A[1]"'])('never infers identities from literal text %s', (text) => {
    const analysis = analyzeStoredFormula(prepare(text), workbook);

    expect(analysis.references).toEqual([]);
  });

  it('overlays every AST reference without changing nonreference nodes', () => {
    const analysis = analyzeStoredFormula(prepare('=SUM((@A[1]),-@B[2])+1*TRUE+"x"'), workbook, sheet.id);

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

    expect(analysis.references.map(({ live }) => live)).toEqual([]);
    expect(analysis.result).toMatchObject({ kind: 'formula', expression: { kind: 'binary', left: { kind: 'invalid-reference' }, right: { kind: 'invalid-reference' } } });
  });

  it('does not fall back from deleted sheet identities to same-name replacements', () => {
    const content = prepare('=@Inputs!A[1]');
    const replacement = sheetDocument({ id: 'new', name: 'Inputs', rowCount: 2, columnCount: 2 });

    const analysis = analyzeStoredFormula(content, workbookWithSheets([replacement]), replacement.id);

    expect(analysis.references[0]).toMatchObject({ live: false, reference: { sheetId: sheet.id } });
  });

  it('reports independently missing row and column targets without replacing identities', () => {
    const content = prepare('=@A[1]+@B[2]');
    const changed = { ...sheet, content: { ...sheet.content, columns: [sheet.content.columns[0], 'replacement-column'], rows: ['replacement-row', sheet.content.rows[1]] } };

    const analysis = analyzeStoredFormula(content, workbookWithSheets([changed]));

    expect(analysis.references.map(({ live }) => live)).toEqual([false, false]);
    expect(analysis.references.map(({ reference }) => reference?.coordinate)).toEqual([{ columnId: sheet.content.columns[0], rowId: sheet.content.rows[0] }, { columnId: sheet.content.columns[1], rowId: sheet.content.rows[1] }]);
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

});
