import { describe, expect, it } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { applyStoredCellWrites } from './userActions';

describe('trusted stored cell writes', () => {
  it('preserves formula content and metadata across repeated writes and inverse writes', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2 });
    const workbook = workbookWithSheets([sheet]);
    const content = prepareUserFormula('=@A[1]+@Missing!A[0]', workbook, sheet.id);
    const cell = { sheetId: sheet.id, rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[1]! };
    const write = { ...cell, raw: content };
    const first = applyStoredCellWrites(workbook, [write]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const saved = first.value.nextWorkbook;
    expect(saved.documents[sheet.id]!.content.cells[cellIdentityKey(cell)]).toBe(content);
    const repeated = applyStoredCellWrites(saved, [write]);
    expect(repeated.ok && repeated.value.changed).toBe(false);
    const cleared = applyStoredCellWrites(saved, [{ ...cell, raw: '' }]);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok || cleared.value.inverse?.kind !== 'write-cells') throw new Error('missing inverse');
    const restored = applyStoredCellWrites(cleared.value.nextWorkbook, cleared.value.inverse.writes);
    expect(restored.ok && restored.value.nextWorkbook.documents[sheet.id]!.content.cells[cellIdentityKey(cell)]).toBe(content);
  });
});
