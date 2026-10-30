import { describe, expect, it } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';
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

  it('round trips mixed resolved and invalid text without passive rebinding', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Inputs', rowCount: 2, columnCount: 2 });
    const original = workbookWithSheets([sheet]);
    const draft = '=SUM(@Inputs!A[1], @Missing!B[2], ???)';
    const content = prepareUserFormula(draft, original, sheet.id);
    const key = cellIdentityKey({ rowId: sheet.content.rows[1]!, columnId: sheet.content.columns[1]! });
    const replacement = { ...sheet, content: { ...sheet.content, cells: { [key]: content } } };
    const workbook = workbookWithSheets([replacement, sheetDocument({ id: 'missing', name: 'Missing', rowCount: 2, columnCount: 2 })]);

    const encoded = encodeWorkbookBundle(workbook);
    const reloaded = decodeWorkbookBundle(encoded);
    const restored = reloaded.documents[sheet.id]!.content.cells[key]!;
    expect(encoded.documents[0]!.content.cells[0]!.content).toBe(content);
    expect(restored).toBe(content);
    expect(projectStoredFormula(restored, reloaded, sheet.id).text).toBe(draft);
    expect(restored).toContain('~{');
  });
});
