import { describe, expect, it } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import type { FormatWrite } from '@workbook/core/model';
import { applyWorkbookOperation, type WorkbookOperation } from './userActions';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

const sheet = sheetDocument({ id: 'formats', name: 'Formats' });
const workbook = workbookWithSheets([sheet]);
const row = sheet.content.rows[0], column = sheet.content.columns[0];
const cell = cellIdentityKey({ rowId: row, columnId: column });
const writes: FormatWrite[] = [
  { scope: 'row', targetId: row, numberFormat: { kind: 'percent', precision: 1 } },
  { scope: 'column', targetId: column, numberFormat: { kind: 'number', precision: 2 } },
  { scope: 'cell', targetId: cell, numberFormat: { kind: 'general' } },
];
const apply = (values: readonly FormatWrite[], source = workbook, sheetId = sheet.id) =>
  applyWorkbookOperation(source, { kind: 'write-number-formats', operationId: 'format-op', sheetId, writes: values });

describe('number format operations', () => {
  it('applies scoped sparse writes with persistence and inverse data', () => {
    const result = apply(writes);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('failed');
    expect(result.value.nextWorkbook.documents[sheet.id].presentation.formatOverrides).toEqual({
      rows: { [row]: { numberFormat: { kind: 'percent', precision: 1 } } },
      columns: { [column]: { numberFormat: { kind: 'number', precision: 2 } } },
      cells: { [cell]: { numberFormat: { kind: 'general' } } },
    });
    expect(result.value.persistence).toEqual({ kind: 'write-number-formats', sheetId: sheet.id, writes });
    expect(result.value.inverse).toEqual({ kind: 'write-number-formats', sheetId: sheet.id, writes: writes.map((write) => ({ ...write, numberFormat: null })) });
    const undone = applyWorkbookOperation(result.value.nextWorkbook, { ...result.value.inverse, operationId: 'undo' } as WorkbookOperation);
    expect(undone.ok && undone.value.nextWorkbook.documents[sheet.id].presentation.formatOverrides).toEqual({ rows: {}, columns: {}, cells: {} });
  });

  it('filters no-ops and rejects unknown sheets and invalid atomic batches', () => {
    const first = apply(writes);
    if (!first.ok) throw new Error('failed');
    const unchanged = apply(writes, first.value.nextWorkbook);
    expect(unchanged.ok && unchanged.value.changed).toBe(false);
    expect(apply(writes, workbook, 'missing')).toEqual({ ok: false, reason: 'unknown-sheet' });
    expect(apply([])).toEqual({ ok: false, reason: 'invalid-number-format' });
    expect(apply([{ scope: 'row', targetId: row, numberFormat: { kind: 'general' } }, { scope: 'row', targetId: row, numberFormat: null }])).toEqual({ ok: false, reason: 'invalid-number-format' });
  });
});
