import { describe, expect, it } from 'vitest';
import { cellTargetAt } from '@grid/cellInteraction';
import { sheetDocument } from '@test-support/workbookFactories';
import { projectSelection } from '@workbook/read/selection';
import { rectangularSelectionAddressRange, selectionEndpointAddressRange } from './workspaceSelection';

describe('workspace selection ranges', () => {
  const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 4, columnCount: 4 });
  const first = cellTargetAt(sheet, 'A1')!;
  const last = cellTargetAt(sheet, 'C3')!;

  it.each(['rows', 'columns'] as const)('separates %s endpoint geometry, exact membership and rectangle eligibility', (mode) => {
    const axis = mode === 'rows' ? sheet.content.rows : sheet.content.columns;
    const selection = { mode, anchor: first, extent: last, members: [axis[0]!, axis[2]!, axis[3]!] };
    expect(selectionEndpointAddressRange(sheet, selection)).toEqual({
      start: { rowIndex: 0, columnIndex: 0 },
      end: mode === 'rows' ? { rowIndex: 2, columnIndex: 3 } : { rowIndex: 3, columnIndex: 2 },
    });
    expect(projectSelection(sheet, selection)?.[mode]).toEqual(selection.members);
    expect(rectangularSelectionAddressRange(sheet, selection)).toBeUndefined();
    expect(rectangularSelectionAddressRange(sheet, { ...selection, members: axis })).toEqual({
      start: { rowIndex: 0, columnIndex: 0 }, end: { rowIndex: 3, columnIndex: 3 },
    });
  });

  it('rejects invalid ownership and membership for rectangles while preserving ordinary reversed cells', () => {
    const cells = { mode: 'cells' as const, anchor: last, extent: first };
    expect(rectangularSelectionAddressRange(sheet, cells)).toEqual({
      start: { rowIndex: 0, columnIndex: 0 }, end: { rowIndex: 2, columnIndex: 2 },
    });
    expect(rectangularSelectionAddressRange(sheet, { ...cells, extent: { ...first, sheetId: 'other' } })).toBeUndefined();
    expect(rectangularSelectionAddressRange(sheet, { ...cells, mode: 'rows', members: [sheet.content.rows[0]!] })).toBeUndefined();
  });
});
