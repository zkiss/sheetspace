import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellIdentityAt, cellIdentityKey } from '../core/cellIdentity';
import { prepareUserFormula } from '../formula/formulaPreparation';
import { commitStoredCellContent } from './operations';

describe('trusted cell content admission', () => {
  it('preserves stored formula bytes on repeated writes and clears them', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 1 });
    const workbook = workbookWithSheets([sheet]);
    const content = prepareUserFormula('=@A[1]+@Missing!A[0]', workbook, sheet.id);
    const written = commitStoredCellContent(workbook, sheet.id, 'A1', content);
    const key = cellIdentityKey(cellIdentityAt(sheet.content, 'A1')!);
    expect(written.documents[sheet.id]!.content.cells[key]).toBe(content);
    expect(commitStoredCellContent(written, sheet.id, 'A1', content)).toBe(written);
    expect(commitStoredCellContent(written, sheet.id, 'A1', '').documents[sheet.id]!.content.cells[key]).toBeUndefined();
  });

  it('ignores missing sheets and invalid cell addresses', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 1 });
    const workbook = workbookWithSheets([sheet]);
    expect(commitStoredCellContent(workbook, 'missing', 'A1', '1')).toBe(workbook);
    expect(commitStoredCellContent(workbook, sheet.id, 'B1', '1')).toBe(workbook);
  });
});
