import { describe, expect, it } from 'vitest';
import { rangeFitsSheetViewport, sheetContentOffsetForCell } from '@grid/gridGeometry';
import { positionedSheet } from '@test-support/workbookFactories';

describe('gridGeometry', () => {
  it('converts a cell address into its sheet-content offset', () => {
    expect(sheetContentOffsetForCell({ columnIndex: 9, rowIndex: 19 }, positionedSheet('sheet-data', 'Data', { x: 0, y: 0 })))
      .toEqual({ x: 684, y: 502 });
  });

  it('distinguishes ranges that fit the sheet viewport from internally clipped ranges', () => {
    const sheet = positionedSheet('sheet-data', 'Data', { x: 0, y: 0 });

    expect(rangeFitsSheetViewport({
      start: { columnIndex: 1, rowIndex: 1 },
      end: { columnIndex: 2, rowIndex: 2 },
    }, sheet)).toBe(true);
    expect(rangeFitsSheetViewport({
      start: { columnIndex: 0, rowIndex: 0 },
      end: { columnIndex: 9, rowIndex: 19 },
    }, sheet)).toBe(false);
  });

  it('uses a resized frame viewport when deciding whether a range can be fully shown', () => {
    const sheet = {
      ...positionedSheet('sheet-data', 'Data', { x: 0, y: 0 }),
      frame: {
        ...positionedSheet('sheet-data', 'Data', { x: 0, y: 0 }).frame,
        size: { width: 900, height: 600 },
      },
    };

    expect(rangeFitsSheetViewport({
      start: { columnIndex: 0, rowIndex: 0 },
      end: { columnIndex: 9, rowIndex: 19 },
    }, sheet)).toBe(true);
  });
  it('uses mixed durable dimensions for content offsets and clipped ranges', () => {
    const sheet = positionedSheet('mixed', 'Mixed', { x: 0, y: 0 });
    sheet.presentation = { rowHeights: { [sheet.content.rows[0]]: 80 }, columnWidths: { [sheet.content.columns[0]]: 160 } };
    expect(sheetContentOffsetForCell({ rowIndex: 2, columnIndex: 2 }, sheet)).toEqual({ x: 236, y: 106 });
    expect(rangeFitsSheetViewport({ start: { rowIndex: 0, columnIndex: 0 }, end: { rowIndex: 1, columnIndex: 1 } }, sheet)).toBe(false);
    expect(rangeFitsSheetViewport({ start: { rowIndex: 2, columnIndex: 2 }, end: { rowIndex: 3, columnIndex: 3 } }, sheet)).toBe(true);
  });

});
