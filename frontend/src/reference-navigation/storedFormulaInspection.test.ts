import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { analyzeStoredFormula } from '@workbook/formula/storedFormulaAnalysis';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';
import { inspectFormula, inspectStoredFormula, navigableReferencesAtCaret } from './formulaInspection';

describe('stored formula inspection', () => {
  it('navigates local and qualified ordinary named cells and ranges after renaming', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 2, columnCount: 2 });
    const named = { ...source, columnNames: { [source.content.columns[0]!]: 'First', [source.content.columns[1]!]: 'Second' } };
    const other = sheetDocument({ id: 'other', name: 'Other', rowCount: 2, columnCount: 2 });
    const workbook = workbookWithSheets([named, other]);
    const local = prepareUserFormula("=@'First'[1] + SUM(@'First'[1]:'Second'[2])", workbook, named.id);
    const qualified = prepareUserFormula("=@Source!'First'[1] + SUM(@Source!'First'[1]:'Second'[2])", workbook, other.id);
    const renamed = { ...named, columnNames: { [source.content.columns[0]!]: 'New First', [source.content.columns[1]!]: 'New Second' } };
    const updated = workbookWithSheets([renamed, other]);

    for (const [content, current] of [[local, renamed], [qualified, other]] as const) {
      for (const inspection of [inspectStoredFormula(content, updated, current), inspectFormula(content, updated, current)]) {
        expect(inspection?.references).toHaveLength(2);
        expect(navigableReferencesAtCaret(inspection, undefined)).toMatchObject([
          { broken: false, target: { kind: 'cell', sheetId: source.id, identity: { columnId: source.content.columns[0], rowId: source.content.rows[0] } } },
          { broken: false, target: { kind: 'range', sheetId: source.id, range: { start: { columnId: source.content.columns[0], rowId: source.content.rows[0] }, end: { columnId: source.content.columns[1], rowId: source.content.rows[1] } } } },
        ]);
        expect(inspection?.raw).toContain('New First');
        expect(inspection?.raw).toContain('New Second');
      }
    }
  });

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
