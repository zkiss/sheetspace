import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { prepareUserFormula } from './formulaPreparation';
import { instantiateStoredModelFormula } from './modelFormulaInstance';
import { decodeStoredFormula } from './storedFormula';

const sheet = sheetDocument({ id: 'sheet', name: 'Inputs', rowCount: 3, columnCount: 2 });
const workbook = workbookWithSheets([sheet]);

describe('stored model formula instantiation', () => {
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
