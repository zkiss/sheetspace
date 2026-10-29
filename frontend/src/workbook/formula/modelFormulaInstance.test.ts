import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { prepareUserFormula } from './formulaPreparation';
import { instantiateStoredModelFormula } from './modelFormulaInstance';
import { decodeStoredFormula } from './storedFormula';
import { instantiatePreparedModelFormula, modelFormulaDeclaration, prepareModelFormula, prepareModelFormulas } from './preparedModelTemplate';
import type { StoredFormulaContent } from './storedFormula';
import fixtures from '../../../../test-fixtures/stored-model-instances.json';

const sheet = sheetDocument({ id: 'sheet', name: 'Inputs', rowCount: 3, columnCount: 2 });
const workbook = workbookWithSheets([sheet]);

describe('stored model formula instantiation', () => {
  it('matches shared cross-language encoded instances', () => {
    for (const fixture of fixtures) {
      const target = fixture.rows ? { ...sheet, content: { ...sheet.content, rows: fixture.rows } } : undefined;
      const instance = instantiateStoredModelFormula(fixture.template as StoredFormulaContent, workbookWithSheets(target ? [target] : []), fixture.rowIndex);
      expect(instance, fixture.name).toBe(fixture.expected);
      const transported = JSON.parse(JSON.stringify({ content: fixture.template }));
      expect(instantiatePreparedModelFormula(transported, workbookWithSheets(target ? [target] : []), fixture.rowIndex), fixture.name).toBe(fixture.expected);
      expect(modelFormulaDeclaration(transported)).toBe('=@A[1]:B[2]+???😀');
    }
  });
  it('prepares a single-content template from fresh declaration text without trusting internal spellings', () => {
    const text = '=@A[1]+@Missing!B[1]+@foo-1[bad]+???😀';
    const template = prepareModelFormula(text, workbook, sheet.id);
    const transported = JSON.parse(JSON.stringify(template));

    expect(Object.keys(transported)).toEqual(['content']);
    expect(modelFormulaDeclaration(transported)).toBe(text);
    expect(decodeStoredFormula(transported.content).occurrences).toHaveLength(2);
    expect(decodeStoredFormula(instantiatePreparedModelFormula(transported, workbook, 1)).occurrences[0].slots.find((slot) => slot.kind === 'row')?.targetIds).toEqual([sheet.content.rows[1]]);
    expect(modelFormulaDeclaration(prepareModelFormula(template.content, workbook, sheet.id))).toBe(template.content);
    expect(() => modelFormulaDeclaration({ content: '=@A[1]' as StoredFormulaContent })).toThrow();
  });
  it('prepares empty-sheet templates before row identities exist and instantiates after append', () => {
    const empty = { ...sheet, content: { ...sheet.content, rows: [], cells: {} } };
    const template = prepareModelFormula('=@A[1]:$B[$2]', workbookWithSheets([empty]), sheet.id);

    const instance = decodeStoredFormula(instantiatePreparedModelFormula(template, workbook, 1));

    expect(instance.text).toBe('=@A[1]:$B[$2]');
    expect(instance.occurrences[0].slots.filter((slot) => slot.kind === 'row').map((slot) => slot.targetIds)).toEqual([[sheet.content.rows[1]], [sheet.content.rows[1]]]);
  });
  it('prepares only calculated declarations with stable named-property and column identities', () => {
    const bound = { ...sheet, modelId: 'model', modelColumnBindings: { input: sheet.content.columns[0], output: sheet.content.columns[1] } };
    const modeled = { ...workbookWithSheets([bound]), dataModels: { model: { id: 'model', name: 'Model', columns: [
      { id: 'input', name: 'Input', kind: 'manual' as const, type: 'float' as const },
      { id: 'output', name: 'Output', kind: 'calculated' as const, type: 'float' as const, formula: '=@Input*2+@Missing[1]' },
    ] } } };

    const templates = prepareModelFormulas(modeled, sheet.id);

    expect(Object.keys(templates)).toEqual(['output']);
    expect(modelFormulaDeclaration(templates.output)).toBe('=@Input*2+@Missing[1]');
    expect(decodeStoredFormula(templates.output.content).occurrences[0].slots.find((slot) => slot.kind === 'property')?.targetIds).toEqual(['input', sheet.content.columns[0]]);
    expect(prepareModelFormulas(modeled, 'unknown')).toEqual({});
    expect(prepareModelFormulas(workbook, sheet.id)).toEqual({});
    expect(prepareModelFormulas({ ...modeled, dataModels: {} }, sheet.id)).toEqual({});
    expect(prepareModelFormulas(workbookWithSheets([bound]), sheet.id)).toEqual({});
  });
  it('uses independent relative and anchored row recipes for range endpoints', () => {
    const text = '=@A[1]:$B[$2]+???';
    const template = prepareUserFormula(text, workbook, sheet.id);

    const instance = decodeStoredFormula(instantiateStoredModelFormula(template, workbook, 1));

    expect(instance.text).toBe(text);
    expect(instance.occurrences[0].slots.filter((slot) => slot.kind === 'row').map((slot) => slot.targetIds)).toEqual([
      [sheet.content.rows[1]], [sheet.content.rows[1]],
    ]);
    expect(decodeStoredFormula(template).occurrences[0].slots.find((slot) => slot.id === 'r0')?.targetIds).toEqual([sheet.content.rows[0]]);
  });

  it('leaves unavailable rows and unresolved sheet targets unbound', () => {
    const template = prepareUserFormula('=@A[3]+@Missing!A[1]', workbook, sheet.id);

    const instance = decodeStoredFormula(instantiateStoredModelFormula(template, workbook, 1));

    expect(instance.occurrences.map((occurrence) => occurrence.slots.find((slot) => slot.id === 'r0'))).toMatchObject([
      { status: 'unresolved', targetIds: [] }, { status: 'unresolved', targetIds: [] },
    ]);
  });

  it('does not resolve a retained deleted sheet by its old name', () => {
    const template = prepareUserFormula('=@Inputs!A[1]', workbook, sheet.id);
    const replacement = sheetDocument({ id: 'replacement', name: 'Inputs', rowCount: 1, columnCount: 1 });

    const instance = decodeStoredFormula(instantiateStoredModelFormula(template, workbookWithSheets([replacement]), 0));

    expect(instance.occurrences[0].slots.find((slot) => slot.id === 'sheet')?.targetIds).toEqual([sheet.id]);
    expect(instance.occurrences[0].slots.find((slot) => slot.id === 'r0')?.targetIds).toEqual([sheet.content.rows[0]]);
  });
});
