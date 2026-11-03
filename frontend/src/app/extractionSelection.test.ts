import { describe, expect, it } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import type { CellSelection } from '@grid/cellInteractionContracts';
import { extractionSelection } from './extractionSelection';

describe('extraction selection', () => {
  const sheet = sheetDocument({ id: 'source', name: 'Source' });
  const anchor = { sheetId: sheet.id, cell: { rowId: sheet.content.rows[1]!, columnId: sheet.content.columns[1]! } };
  const extent = { sheetId: sheet.id, cell: { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! } };

  it('preserves reversed endpoints for cell, row and column extraction', () => {
    expect(extractionSelection(sheet, { mode: 'cells', anchor, extent })).toEqual({ kind: 'cells', start: anchor.cell, end: extent.cell });
    expect(extractionSelection(sheet, { mode: 'rows', anchor, extent })).toEqual({ kind: 'rows', start: anchor.cell.rowId, end: extent.cell.rowId });
    expect(extractionSelection(sheet, { mode: 'columns', anchor, extent })).toEqual({ kind: 'columns', start: anchor.cell.columnId, end: extent.cell.columnId });
  });

  it('rejects missing, cross-sheet, and stale selections', () => {
    const selection: CellSelection = { mode: 'cells', anchor, extent };
    expect(extractionSelection(sheet, null)).toBeUndefined();
    expect(extractionSelection(sheet, { ...selection, extent: { ...extent, sheetId: 'other' } })).toBeUndefined();
    expect(extractionSelection(sheet, { ...selection, anchor: { ...anchor, cell: { ...anchor.cell, rowId: 'deleted' } } })).toBeUndefined();
  });
});
