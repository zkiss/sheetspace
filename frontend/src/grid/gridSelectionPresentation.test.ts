import { describe, expect, it } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { tabularProjection } from '@workbook/read/queries';
import type { CellSelection } from './cellInteractionContracts';
import { gridSelectionPresentation } from './gridSelectionPresentation';

describe('grid selection projection', () => {
  it.each(['rows', 'columns'] as const)('reprojects %s membership without changing endpoints', (mode) => {
    const document = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 4, columnCount: 4 });
    const sheet = tabularProjection(document);
    const target = (i: number) => ({ sheetId: sheet.id, cell: { rowId: sheet.rows[mode === 'rows' ? i : 0]!, columnId: sheet.columns[mode === 'columns' ? i : 0]! } });
    const selection: CellSelection = { mode, anchor: target(0), extent: target(3), members: [sheet[mode][0]!, sheet[mode][3]!] };
    expect([...gridSelectionPresentation(sheet, selection)[mode]]).toEqual([0, 3]);
    expect([...gridSelectionPresentation(sheet, { ...selection, members: [sheet[mode][0]!, sheet[mode][1]!, sheet[mode][3]!] })[mode]]).toEqual([0, 1, 3]);
    const reordered = { ...sheet, [mode]: [sheet[mode][1]!, sheet[mode][0]!, sheet[mode][3]!, sheet[mode][2]!] };
    expect([...gridSelectionPresentation(reordered, selection)[mode]]).toEqual([1, 2]);
    const deleted = { ...sheet, [mode]: sheet[mode].slice(0, 3) };
    expect([...gridSelectionPresentation(deleted, selection)[mode]]).toEqual([]);
  });

  it('uses rectangle geometry only when no logical selection was supplied', () => {
    const sheet = tabularProjection(sheetDocument({ id: 's', name: 'Sheet', rowCount: 3, columnCount: 3 }));
    const range = { start: { rowIndex: 0, columnIndex: 1 }, end: { rowIndex: 1, columnIndex: 2 } };
    expect([...gridSelectionPresentation(sheet, undefined, range).rows]).toEqual([0, 1]);
    expect([...gridSelectionPresentation(sheet, undefined, range).columns]).toEqual([1, 2]);
    expect(gridSelectionPresentation(sheet, null, range).rows.size).toBe(0);
    const cell = { sheetId: sheet.id, cell: { rowId: sheet.rows[1]!, columnId: sheet.columns[1]! } };
    expect([...gridSelectionPresentation(sheet, { mode: 'cells', anchor: cell, extent: cell }, range).rows]).toEqual([1]);
  });
});
