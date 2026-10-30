import { describe, expect, it } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { decodeStoredFormula, encodeStoredFormula } from '@workbook/formula/storedFormula';
import { analyzeStoredFormula } from '@workbook/formula/storedFormulaAnalysis';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { decodeWorkbookBundle, encodeWorkbookBundle } from './workbookApi';

describe('stored formula transport', () => {
  it('round trips formula text and retained identities in the existing cell content', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2 });
    const workbook = workbookWithSheets([sheet]);
    const content = prepareUserFormula('=@A[1]+@Missing!A[0]', workbook, sheet.id);
    const key = cellIdentityKey({ rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[1]! });
    const withFormula = { ...workbook, documents: { ...workbook.documents, [sheet.id]: { ...sheet, content: { ...sheet.content, cells: { [key]: content } } } } };

    const encoded = encodeWorkbookBundle(withFormula);
    expect(encoded.documents[0]!.content.cells[0]!.content).toBe(content);
    expect(decodeWorkbookBundle(encoded).documents[sheet.id]!.content.cells[key]).toBe(content);
  });

  it('round trips dead targets and malformed dormant provenance without rebinding replacements', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Inputs', rowCount: 2, columnCount: 2 });
    const original = workbookWithSheets([sheet]);
    const formula = decodeStoredFormula(prepareUserFormula('=@Inputs!A[1]+@Inputs!B[2]', original, sheet.id));
    formula.text = formula.text.slice(0, 20) + '?' + formula.text.slice(21);
    const content = encodeStoredFormula(formula);
    const key = cellIdentityKey({ rowId: sheet.content.rows[1]!, columnId: sheet.content.columns[1]! });
    const replacement = { ...sheet, content: { ...sheet.content, rows: ['replacement', sheet.content.rows[1]!], cells: { [key]: content } } };
    const workbook = workbookWithSheets([replacement]);

    const encoded = encodeWorkbookBundle(workbook);
    const reloaded = decodeWorkbookBundle(encoded);
    const restored = reloaded.documents[sheet.id]!.content.cells[key]!;
    expect(encoded.documents[0]!.content.cells[0]!.content).toBe(content);
    expect(restored).toBe(content);
    expect(decodeStoredFormula(restored)).toEqual(formula);
    const analysis = analyzeStoredFormula(restored, reloaded);
    expect(analysis.references[0].live).toBe(false);
    expect(analysis.dormantOccurrences.map(({ id }) => id)).toEqual([formula.occurrences[1].id]);
    expect(formula.occurrences[0].slots.find((slot) => slot.kind === 'row')?.targetIds).toEqual([sheet.content.rows[0]]);
  });
});
