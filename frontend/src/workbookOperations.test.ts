import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from './test/workbookFactories';
import { appendColumn, appendRow, commitCellRawContent, createEmptyWorkbook, moveSheetZOrder, renameSheet, validateSheetName } from './workbook/mutations/operations';
import { cellRawContent, sheetsInOrder } from './workbook/read/queries';
import type { SheetDocument } from './workbook/core/model';

function sheet(id: string, name: string): SheetDocument {
  return sheetDocument({ id, name });
}

describe('workbookOperations', () => {
  it('creates an empty manifest with no loaded documents', () => {
    expect(createEmptyWorkbook()).toEqual({ manifest: { version: 1, revision: 0, sheetIds: [] }, documents: {} });
  });

  it('rejects empty and duplicate names', () => {
    const existing = [sheet('sheet-1', 'Inputs')];
    expect(validateSheetName('   ', existing)).toEqual({ ok: false, reason: 'empty' });
    expect(validateSheetName('Inputs', existing)).toEqual({ ok: false, reason: 'duplicate' });
    expect(validateSheetName(' Inputs ', existing, 'sheet-1')).toEqual({ ok: true, name: 'Inputs' });
  });

  it('changes z-order without changing manifest membership order', () => {
    const workbook = workbookWithSheets([
      sheetDocument({ id: 'sheet-1', name: 'Inputs', zIndex: 1 }),
      sheetDocument({ id: 'sheet-2', name: 'Assumptions', zIndex: 2 }),
      sheetDocument({ id: 'sheet-3', name: 'Outputs', zIndex: 3 }),
    ]);
    const moved = moveSheetZOrder(workbook, 'sheet-1', 'up');

    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.manifest.sheetIds).toEqual(['sheet-1', 'sheet-2', 'sheet-3']);
    expect(sheetsInOrder(moved.value).map((candidate) => [candidate.id, candidate.frame.zIndex])).toEqual([
      ['sheet-1', 2], ['sheet-2', 1], ['sheet-3', 3],
    ]);
  });

  it('renames metadata without rewriting or cloning tabular content', () => {
    const original = sheetDocument({ id: 'sheet-1', name: 'Inputs', cells: { A1: " =SUM( 'Old Name'!A1 )\n" } });
    const result = renameSheet(workbookWithSheets([original]), original.id, 'Renamed');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const renamed = result.value.documents[original.id];
    expect(renamed.name).toBe('Renamed');
    expect(renamed.content).toBe(original.content);
    expect(cellRawContent(renamed, 'A1')).toBe(" =SUM( 'Old Name'!A1 )\n");
  });

  it('appends stable identities without changing content or earlier order', () => {
    const original = sheetDocument({ id: 'sheet-1', name: 'Inputs', cells: { A1: '42' } });
    const rowAdded = appendRow(original, 'row-new');
    const columnAdded = appendColumn(original, 'column-new');

    expect(rowAdded.content.rows).toEqual([...original.content.rows, 'row-new']);
    expect(columnAdded.content.columns).toEqual([...original.content.columns, 'column-new']);
    expect(rowAdded.content.cells).toBe(original.content.cells);
    expect(columnAdded.content.cells).toBe(original.content.cells);
  });

  it('commits and clears content by stable identity while preserving grid order', () => {
    const original = sheet('sheet-1', 'Inputs');
    const workbook = workbookWithSheets([original]);
    const withText = commitCellRawContent(workbook, original.id, 'A1', 'Region');
    const changed = withText.documents[original.id];

    expect(cellRawContent(changed, 'A1')).toBe('Region');
    expect(changed.content.rows).toBe(original.content.rows);
    expect(changed.content.columns).toBe(original.content.columns);
    const cleared = commitCellRawContent(withText, original.id, 'A1', '');
    expect(cellRawContent(cleared.documents[original.id], 'A1')).toBeUndefined();
  });

  it('leaves workbook unchanged for no-op or invalid cell commits', () => {
    const original = sheetDocument({ id: 'sheet-1', name: 'Inputs', cells: { A1: 'Original' } });
    const workbook = workbookWithSheets([original]);
    expect(commitCellRawContent(workbook, original.id, 'B1', '')).toBe(workbook);
    expect(commitCellRawContent(workbook, original.id, 'A1', 'Original')).toBe(workbook);
    expect(commitCellRawContent(workbook, 'missing', 'A1', 'Value')).toBe(workbook);
    expect(commitCellRawContent(workbook, original.id, 'Z999', 'Value')).toBe(workbook);
  });
});
