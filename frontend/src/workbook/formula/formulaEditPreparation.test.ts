import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { prepareFormulaEdit, prepareUserFormula } from './formulaPreparation';
import { decodeStoredFormula } from './storedFormula';
import { projectStoredFormula } from './storedFormulaProjection';

const sheet = sheetDocument({ id: 'sheet', name: 'Inputs', rowCount: 2, columnCount: 2 });
const workbook = workbookWithSheets([sheet]);

describe('formula edit preparation', () => {
  it('returns identical stored bytes for an unchanged projected draft after a rename', () => {
    const original = prepareUserFormula('=@Inputs!A[1]+3', workbook, sheet.id);
    const renamed = workbookWithSheets([{ ...sheet, name: 'Renamed' }]);
    const draft = projectStoredFormula(original, renamed, sheet.id).text;

    expect(draft).toBe('=@Renamed!A[1]+3');
    expect(prepareFormulaEdit(draft, original, renamed, sheet.id)).toBe(original);
  });

  it('retains an unchanged dead reference while resolving a newly edited reference', () => {
    const original = prepareUserFormula('=@A[1]+@B[1]', workbook, sheet.id);
    const changed = workbookWithSheets([{ ...sheet, content: { ...sheet.content, columns: ['replacement', sheet.content.columns[1]] } }]);
    const draft = projectStoredFormula(original, changed, sheet.id).text.replace('@B[1]', '@B[2]');

    const result = decodeStoredFormula(prepareFormulaEdit(draft, original, changed, sheet.id));

    expect(result.occurrences[0].slots[1].targetIds).toEqual([sheet.content.columns[0]]);
    expect(result.occurrences[1].slots[2].targetIds).toEqual([sheet.content.rows[1]]);
  });

  it('preserves malformed fragments and resolves recognizable corrected references', () => {
    const original = prepareUserFormula('=@Missing!A[1]+@B[2]+???', workbook, sheet.id);
    const draft = '=@Inputs!A[1]+@B[2]+???';

    const result = decodeStoredFormula(prepareFormulaEdit(draft, original, workbook, sheet.id));

    expect(result.text).toBe(draft);
    expect(result.occurrences[0].slots[0].targetIds).toEqual([sheet.id]);
    expect(result.occurrences[1].slots[1].targetIds).toEqual([sheet.content.columns[1]]);
  });
});
