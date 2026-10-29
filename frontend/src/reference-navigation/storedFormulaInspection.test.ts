import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { inspectStoredFormula } from './formulaInspection';

describe('stored formula inspection', () => {
  it('projects live identities while preserving unresolved text and diagnostics', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Inputs', rowCount: 2, columnCount: 2 });
    const content = prepareUserFormula('=@Inputs!A[1]+@Missing!B[2]', workbookWithSheets([sheet]), sheet.id);
    const renamed = { ...sheet, name: 'Renamed', content: { ...sheet.content, columns: [...sheet.content.columns].reverse() } };
    const inspection = inspectStoredFormula(content, workbookWithSheets([renamed]), renamed)!;

    expect(inspection.raw).toBe('=@Renamed!B[1]+@Missing!B[2]');
    expect(inspection.references.map(({ text, navigable }) => [text, navigable])).toEqual([
      ['@Renamed!B[1]', true], ['@Missing!B[2]', false],
    ]);
    expect(inspection.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'reference' })]));
  });

  it('does not navigate to replacement identities', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Inputs', rowCount: 1, columnCount: 1 });
    const content = prepareUserFormula('=@Inputs!A[1]', workbookWithSheets([sheet]), sheet.id);
    const replacement = { ...sheet, content: { ...sheet.content, rows: ['replacement'] } };
    const inspection = inspectStoredFormula(content, workbookWithSheets([replacement]), replacement)!;

    expect(inspection.raw).toBe('=@Inputs!A[1]');
    expect(inspection.references[0]).toMatchObject({ broken: true, navigable: false });
    expect(inspection.diagnostics[0]).toMatchObject({ kind: 'reference' });
  });
});
