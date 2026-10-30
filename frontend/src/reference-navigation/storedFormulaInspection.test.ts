import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { analyzeStoredFormula } from '@workbook/formula/storedFormulaAnalysis';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';
import { inspectStoredFormula } from './formulaInspection';

describe('stored formula inspection', () => {
  it('projects live identities while preserving unresolved text and diagnostics', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Inputs', rowCount: 2, columnCount: 2 });
    const content = prepareUserFormula('=@Inputs!A[1]+@Missing!B[2]', workbookWithSheets([sheet]), sheet.id);
    const renamed = { ...sheet, name: 'Renamed', content: { ...sheet.content, columns: [...sheet.content.columns].reverse() } };
    const inspection = inspectStoredFormula(content, workbookWithSheets([renamed]), renamed)!;

    expect(inspection.raw).toBe('=@Renamed!B[1]+@Missing!B[2]');
    expect(inspection.references.map(({ text, navigable }) => [text, navigable])).toEqual([
      ['@Renamed!B[1]', true],
    ]);
    expect(inspection.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'reference' })]));
    for (const reference of inspection.references) {
      expect(inspection.raw.slice(reference.displaySpan.start, reference.displaySpan.end)).toBe(reference.text);
    }
    const diagnostic = inspection.diagnostics.find(({ kind }) => kind === 'reference')!;
    expect(inspection.raw.slice(diagnostic.sourceSpan.start, diagnostic.sourceSpan.end)).toBe('@Missing!B[2]');
  });

  it('does not navigate to replacement identities', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Inputs', rowCount: 1, columnCount: 1 });
    const content = prepareUserFormula('=@Inputs!A[1]', workbookWithSheets([sheet]), sheet.id);
    const replacement = { ...sheet, content: { ...sheet.content, rows: ['replacement'] } };
    const inspection = inspectStoredFormula(content, workbookWithSheets([replacement]), replacement)!;

    expect(inspection.raw).toBe('=#REF!');
    expect(inspection.references[0]).toMatchObject({ broken: true, navigable: false });
    expect(inspection.diagnostics[0]).toMatchObject({ kind: 'reference' });
  });

  it('preserves syntax errors without references at the display and diagnostic boundary', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Inputs', rowCount: 1, columnCount: 1 });
    const workbook = workbookWithSheets([sheet]);
    const content = prepareUserFormula('=1+', workbook, sheet.id);

    expect(inspectStoredFormula(content, workbook, sheet)).toBeUndefined();
    expect(projectStoredFormula(content, workbook, sheet.id).text).toBe('=1+');
    expect(analyzeStoredFormula(content, workbook, sheet.id).result).toMatchObject({ kind: 'error', error: '#PARSE!' });
  });
});
