import { describe, expect, it } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { deleteRow } from './deleteRow';
import { deleteColumn } from './deleteColumn';

describe('structural deletion', () => {
  function fixture() {
    const base = sheetDocument({ id: 's', name: 'Sheet', rowCount: 2, columnCount: 2, cells: { A1: 'removed', B2: 'retained' } });
    const [r1, r2] = base.content.rows;
    const [c1, c2] = base.content.columns;
    const removed = cellIdentityKey({ rowId: r1!, columnId: c1! });
    const retained = cellIdentityKey({ rowId: r2!, columnId: c2! });
    const format = { fontWeight: 'bold' as const };
    const sheet = { ...base, columnNames: { [c1!]: 'first', [c2!]: 'second' }, presentation: {
      rowHeights: { [r1!]: 40, [r2!]: 50 }, columnWidths: { [c1!]: 80, [c2!]: 90 },
      formatOverrides: { rows: { [r1!]: format, [r2!]: format }, columns: { [c1!]: format, [c2!]: format }, cells: { [removed]: format, [retained]: format } },
    } };
    const other = sheetDocument({ id: 'other', name: 'Other' });
    return { sheet, other, book: workbookWithSheets([sheet, other]), r1: r1!, r2: r2!, c1: c1!, c2: c2!, removed, retained, format };
  }
  it('removes row data and presentation while retaining other identities', () => {
    const f = fixture(); const result = deleteRow(f.book, 's', f.r1);
    expect(result.ok).toBe(true); if (!result.ok) return;
    const sheet = result.value.documents.s;
    expect(sheet.content.rows).toEqual([f.r2]);
    expect(sheet.content.cells).toEqual({ [f.retained]: 'retained' });
    expect(sheet.presentation.rowHeights).toEqual({ [f.r2]: 50 });
    expect(sheet.presentation.formatOverrides?.rows).toEqual({ [f.r2]: f.format });
    expect(sheet.presentation.formatOverrides?.cells).toEqual({ [f.retained]: f.format });
    expect(sheet.presentation.columnWidths).toEqual(f.sheet.presentation.columnWidths);
    expect(result.value.documents.other).toBe(f.book.documents.other);
  });
  it('removes column names, data and presentation while retaining other identities', () => {
    const f = fixture(); const result = deleteColumn(f.book, 's', f.c1);
    expect(result.ok).toBe(true); if (!result.ok) return;
    const sheet = result.value.documents.s;
    expect(sheet.content.columns).toEqual([f.c2]);
    expect(sheet.content.cells).toEqual({ [f.retained]: 'retained' });
    expect(sheet.columnNames).toEqual({ [f.c2]: 'second' });
    expect(sheet.presentation.columnWidths).toEqual({ [f.c2]: 90 });
    expect(sheet.presentation.formatOverrides?.columns).toEqual({ [f.c2]: f.format });
    expect(sheet.presentation.formatOverrides?.cells).toEqual({ [f.retained]: f.format });
    expect(sheet.presentation.rowHeights).toEqual(f.sheet.presentation.rowHeights);
    expect(result.value.documents.other).toBe(f.book.documents.other);
  });
  it('removes only criteria referring to the deleted column', () => {
    const f = fixture();
    const sorting = [{ columnId: f.c1, direction: 'ascending' as const }, { columnId: f.c2, direction: 'descending' as const }];
    const book = { ...f.book, documents: { ...f.book.documents, s: { ...f.sheet, sorting } } };
    const result = deleteColumn(book, 's', f.c1);
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.value.documents.s.sorting).toEqual([sorting[1]]);
  });
  it('rejects unknown identities and bound columns while allowing bound row deletion', () => {
    const f = fixture(); const bound = { ...f.book, documents: { ...f.book.documents, s: { ...f.sheet, modelId: 'm' } } };
    expect(deleteRow(f.book, 'missing', f.r1)).toEqual({ ok: false, reason: 'unknown-row' });
    expect(deleteRow(f.book, 's', 'missing')).toEqual({ ok: false, reason: 'unknown-row' });
    expect(deleteColumn(f.book, 'missing', f.c1)).toEqual({ ok: false, reason: 'unknown-column' });
    expect(deleteColumn(f.book, 's', 'missing')).toEqual({ ok: false, reason: 'unknown-column' });
    expect(deleteColumn(bound, 's', f.c1)).toEqual({ ok: false, reason: 'bound-sheet-structure' });
    expect(deleteRow(bound, 's', f.r1).ok).toBe(true);
  });
});
