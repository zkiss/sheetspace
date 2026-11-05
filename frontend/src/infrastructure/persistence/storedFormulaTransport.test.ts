import { describe, expect, it } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { decodeWorkbookBundle, encodeWorkbookBundle } from './workbookApi';

describe('stored formula transport', () => {
  it('retains positional anchors and absent rows across bundle reload and reorder', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 2, columnCount: 1 });
    const output = sheetDocument({ id: 'output', name: 'Output', rowCount: 1, columnCount: 1 });
    const original = workbookWithSheets([source, output]);
    const content = prepareUserFormula('=@Source!A[1]+@Source!A[#$1]+@Source!A[#9]', original, output.id);
    const key = cellIdentityKey({ rowId: output.content.rows[0]!, columnId: output.content.columns[0]! });
    const workbook = workbookWithSheets([source, { ...output, content: { ...output.content, cells: { [key]: content } } }]);
    const loaded = decodeWorkbookBundle(encodeWorkbookBundle(workbook));
    const reordered = { ...loaded.documents.source!, content: { ...loaded.documents.source!.content, rows: [...source.content.rows].reverse() } };
    const updated = { ...loaded, documents: { ...loaded.documents, source: reordered } };
    const restored = loaded.documents.output!.content.cells[key]!;
    expect(restored).toBe(content);
    expect(projectStoredFormula(restored, updated, output.id).text).toBe('=@Source!A[2]+@Source!A[#$1]+@Source!A[#9]');
    expect(decodeWorkbookBundle(encodeWorkbookBundle(updated)).documents.output!.content.cells[key]).toBe(content);
  });
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
