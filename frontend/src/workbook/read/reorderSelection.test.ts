import { describe, expect, it } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import type { Selection } from './selection';
import { reorderSelection } from './reorderSelection';

const sheet = sheetDocument({ id: 's', name: 'Sheet', rowCount: 6, columnCount: 6 });
const target = (row: number, column: number) => ({ sheetId: 's', cell: { rowId: `s:row:${row}`, columnId: `s:column:${column}` } });

describe('reorder selection', () => {
  it('resolves focused cells and both axes of rectangular ranges', () => {
    const range: Selection = { mode: 'cells', anchor: target(2, 2), extent: target(4, 3) };
    expect(reorderSelection(sheet, null, target(3, 3), 'row')).toEqual(['s:row:3']);
    expect(reorderSelection(sheet, range, target(3, 3), 'row')).toEqual(['s:row:2', 's:row:3', 's:row:4']);
    expect(reorderSelection(sheet, range, target(3, 3), 'column')).toEqual(['s:column:2', 's:column:3']);
  });
  it('uses exact axis members and focused identity for the opposite axis', () => {
    const rows: Selection = { mode: 'rows', anchor: target(2, 2), extent: target(4, 2), members: ['s:row:4', 's:row:2'] };
    const columns: Selection = { mode: 'columns', anchor: target(2, 2), extent: target(2, 4), members: ['s:column:4', 's:column:2'] };
    expect(reorderSelection(sheet, rows, target(2, 2), 'row')).toEqual(['s:row:2', 's:row:4']);
    expect(reorderSelection(sheet, rows, target(2, 2), 'column')).toEqual(['s:column:2']);
    expect(reorderSelection(sheet, columns, target(2, 2), 'column')).toEqual(['s:column:2', 's:column:4']);
    expect(reorderSelection(sheet, columns, target(2, 2), 'row')).toEqual(['s:row:2']);
  });
  it('rejects stale or foreign focus and selection and model-owned columns', () => {
    const selection: Selection = { mode: 'cells', anchor: target(1, 1), extent: target(2, 2) };
    expect(reorderSelection(sheet, null, null, 'row')).toEqual([]);
    expect(reorderSelection(sheet, null, { ...target(1, 1), sheetId: 'other' }, 'row')).toEqual([]);
    expect(reorderSelection(sheet, null, target(7, 1), 'row')).toEqual([]);
    expect(reorderSelection(sheet, { ...selection, extent: target(7, 1) }, target(1, 1), 'row')).toEqual([]);
    expect(reorderSelection({ ...sheet, modelId: 'model' }, selection, target(1, 1), 'column')).toEqual([]);
    expect(reorderSelection({ ...sheet, modelId: 'model' }, null, target(1, 1), 'row')).toEqual(['s:row:1']);
  });
});
