import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import type { CellSelection } from '@grid/cellInteractionContracts';
import { DEFAULT_COLUMN_WIDTH } from '@workbook/core/axisSizePolicy';
import { extractionRequest } from './extractionRequest';

const sheet = sheetDocument({ id: 'source', name: 'Sheet 1', rowCount: 3, columnCount: 3,
  presentation: { rowHeights: { 'source:row:2': 45 }, columnWidths: { 'source:column:2': 180 } } });
const workbook = workbookWithSheets([sheet, sheetDocument({ id: 'other', name: 'Sheet 2' })]);
const target = (row: number, column: number) => ({ sheetId: sheet.id, cell: { rowId: sheet.content.rows[row]!, columnId: sheet.content.columns[column]! } });
const ids = () => { let n = 0; return () => `fresh-${++n}`; };

describe('extraction request', () => {
  it.each(['cells', 'rows', 'columns'] as const)('creates fresh identities for the complete %s selection', (mode) => {
    const selection: CellSelection = { mode, anchor: target(2, 2), extent: target(1, 1) };
    const request = extractionRequest(workbook, sheet, selection, { x: 0, y: 0 }, undefined, ids())!;
    expect(request.targetName).toBe('Sheet 3');
    expect(request.targetRows).toHaveLength(mode === 'columns' ? 3 : 2);
    expect(request.targetColumns).toHaveLength(mode === 'rows' ? 3 : 2);
    expect(new Set([request.targetSheetId, ...request.targetRows, ...request.targetColumns]).size)
      .toBe(1 + request.targetRows.length + request.targetColumns.length);
    expect(request.selection.kind).toBe(mode);
  });

  it('sizes the frame around nonuniform axes and places it at the scrolled origin', () => {
    const request = extractionRequest(workbook, sheet, { mode: 'cells', anchor: target(1, 1), extent: target(2, 2) }, { x: 10, y: 5 }, { x: 50, y: 60 }, ids())!;
    expect(request.frame.size.width).toBe(2 + 40 + 180 + DEFAULT_COLUMN_WIDTH);
    expect(request.frame.size.height).toBeGreaterThanOrEqual(120);
    expect(request.frame.position.x).toBe(50 + DEFAULT_COLUMN_WIDTH - 10);
    expect(request.frame.position.y).toBeGreaterThan(60);
  });

  it('does not create a request for a foreign selection', () => {
    const selection: CellSelection = { mode: 'cells', anchor: target(0, 0), extent: { ...target(1, 1), sheetId: 'other' } };
    expect(extractionRequest(workbook, sheet, selection, { x: 0, y: 0 }, undefined, ids())).toBeUndefined();
  });
});
