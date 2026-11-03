import { describe, expect, it } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import type { CellSelection } from '@grid/cellInteractionContracts';
import { extractionSelection, mappedExtractionSelection } from './extractionSelection';
import { extractionRequest } from './extractionRequest';
import { workbookWithSheets } from '@test-support/workbookFactories';

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

  it.each(['cells', 'rows', 'columns'] as const)('maps reversed %s endpoints to the complete target axes', (mode) => {
    const selection = { mode, anchor, extent };
    let id = 0;
    const request = extractionRequest(workbookWithSheets([sheet]), sheet, selection, { x: 0, y: 0 }, undefined, () => `target-${id++}`)!;
    const mapped = mappedExtractionSelection(sheet, selection, request)!;
    expect(mapped.mode).toBe(mode);
    expect(mapped.anchor).toEqual({ sheetId: request.targetSheetId, cell: { rowId: request.targetRows[1], columnId: request.targetColumns[1] } });
    expect(mapped.extent).toEqual({ sheetId: request.targetSheetId, cell: { rowId: request.targetRows[0], columnId: request.targetColumns[0] } });
  });
});
