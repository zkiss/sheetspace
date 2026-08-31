import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from './test/workbookFactories';
import { findSheetByName, frameProjection, parseNamedA1Address, parseNamedA1Range, sheetsInOrder, tabularCellsByA1, tabularProjection } from './workbookQueries';
import type { SheetDocument } from './workbookModel';

function sheet(id: string, name: string): SheetDocument {
  return sheetDocument({ id, name });
}

describe('workbookQueries', () => {
  it('keeps manifest order independent from document object insertion order', () => {
    const first = sheet('sheet-1', 'Inputs');
    const second = sheet('sheet-2', 'Outputs');
    const workbook = {
      manifest: { version: 1 as const, revision: 7, sheetIds: [second.id, first.id] },
      documents: { [first.id]: first, [second.id]: second },
    };

    expect(sheetsInOrder(workbook)).toEqual([second, first]);
  });

  it('projects frame and tabular responsibilities without leaking the other state', () => {
    const document = sheetDocument({ id: 'sheet-1', name: 'Inputs', cells: { A1: '=1' } });

    const tabular = tabularProjection(document);
    expect(frameProjection(document)).toEqual({ id: 'sheet-1', name: 'Inputs', ...document.frame });
    expect(tabular).toEqual({ id: 'sheet-1', name: 'Inputs', revision: 0, ...document.content });
    expect(tabular.rows).toBe(document.content.rows);
    expect(tabular.columns).toBe(document.content.columns);
    expect(tabular.cells).toBe(document.content.cells);
    expect(frameProjection({ ...document, frame: { ...document.frame, position: { x: 9, y: 8 } } }))
      .not.toEqual(frameProjection(document));
  });

  it('derives A1 from current row and column order instead of persisting position', () => {
    const document = sheetDocument({ id: 'sheet-1', name: 'Inputs', rowCount: 2, columnCount: 2, cells: { A1: 'value' } });
    const reordered = { ...document.content, rows: [...document.content.rows].reverse(), columns: [...document.content.columns].reverse() };

    expect(tabularCellsByA1(document.content)).toEqual({ A1: 'value' });
    expect(tabularCellsByA1(reordered)).toEqual({ B2: 'value' });
  });

  it('finds sheets by current visible name', () => {
    const workbook = workbookWithSheets([sheet('sheet-1', 'Inputs')]);
    expect(findSheetByName(workbook, 'Inputs')).toEqual({ ok: true, value: workbook.documents['sheet-1'] });
    expect(findSheetByName(workbook, 'Missing')).toEqual({ ok: false, reason: 'unknown-sheet' });
  });

  it('parses same-sheet, unquoted, and quoted references over ordered bounds', () => {
    const inputs = sheet('sheet-1', 'Inputs');
    const sales = sheet('sheet-2', 'Sales Q1');
    const workbook = workbookWithSheets([inputs, sales]);

    expect(parseNamedA1Address('B2', workbook, inputs)).toEqual({ ok: true, value: { columnIndex: 1, rowIndex: 1, sheetName: undefined } });
    expect(parseNamedA1Address('Inputs!A1', workbook)).toEqual({ ok: true, value: { columnIndex: 0, rowIndex: 0, sheetName: 'Inputs' } });
    expect(parseNamedA1Range("'Sales Q1'!A1:B2", workbook)).toEqual({ ok: true, value: { sheetName: 'Sales Q1', start: { columnIndex: 0, rowIndex: 0 }, end: { columnIndex: 1, rowIndex: 1 } } });
  });

  it('rejects unknown sheets and malformed syntax', () => {
    const workbook = workbookWithSheets([sheet('sheet-1', 'Inputs')]);
    expect(parseNamedA1Address('Missing!A1', workbook)).toEqual({ ok: false, reason: 'unknown-sheet' });
    expect(parseNamedA1Address("'Missing!A1", workbook)).toEqual({ ok: false, reason: 'invalid-format' });
  });
});
