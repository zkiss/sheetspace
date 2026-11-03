import { describe, expect, it } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { GRID_COLUMN_HEADER_HEIGHT, GRID_ROW_HEADER_WIDTH } from '@grid/gridGeometry';
import { sheetFrameBodyGeometry } from '@workspace/workspaceGeometry';
import { extractionFramePosition } from './extractionGeometry';

describe('extraction frame placement', () => {
  it('aligns the first target cell with a scrolled, scaled selection under pan and zoom', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', position: { x: 100, y: 200 }, visualScale: 1.5,
      presentation: { rowHeights: { 'source:row:1': 40 }, columnWidths: { 'source:column:1': 150 } } });
    const scroll = { x: 30, y: 10 };
    const target = extractionFramePosition(source, { rowIndex: 1, columnIndex: 1 }, scroll);
    const body = sheetFrameBodyGeometry(source.frame.size);
    const viewport = { x: -80, y: 65, scale: 2 };
    const sourceCell = { x: source.frame.position.x + (body.left + GRID_ROW_HEADER_WIDTH + 150 - scroll.x) * 1.5,
      y: source.frame.position.y + (body.top + GRID_COLUMN_HEADER_HEIGHT + 40 - scroll.y) * 1.5 };
    const targetCell = { x: target.x + (body.left + GRID_ROW_HEADER_WIDTH) * 1.5,
      y: target.y + (body.top + GRID_COLUMN_HEADER_HEIGHT) * 1.5 };
    expect(targetCell.x * viewport.scale + viewport.x).toBeCloseTo(sourceCell.x * viewport.scale + viewport.x);
    expect(targetCell.y * viewport.scale + viewport.y).toBeCloseTo(sourceCell.y * viewport.scale + viewport.y);
  });

  it('uses a supplied presentation position rather than the saved frame position', () => {
    const source = sheetDocument({ id: 'source', name: 'Source' });
    expect(extractionFramePosition(source, { rowIndex: 0, columnIndex: 0 }, { x: 0, y: 0 }, { x: 12, y: 34 }))
      .toEqual({ x: 12, y: 34 });
  });
});
