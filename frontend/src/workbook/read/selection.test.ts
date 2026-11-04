import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { gatherAxis, shiftAxis } from '@workbook/mutations/reorderAxis';
import { extendAxisSelection, projectSelection, pruneAxisSelection, toggleAxisMember, type AxisSelection, type Selection } from './selection';

const sheet = sheetDocument({ id: 's', name: 'Sheet', rowCount: 8, columnCount: 8 });
const target = (row: number, column: number) => ({ sheetId: 's', cell: { rowId: `s:row:${row}`, columnId: `s:column:${column}` } });
for (const mode of ['rows', 'columns'] as const) {
  const axis = mode === 'rows' ? 'row' : 'column';
  const id = (n: number) => `s:${axis}:${n}`;
  const selection: AxisSelection = { mode, anchor: target(2, 2), extent: target(mode === 'rows' ? 6 : 2, mode === 'columns' ? 6 : 2), members: [id(2), id(4), id(6)] };
  describe(mode, () => {
    it('projects exact membership and separated runs rather than filling bounds', () => {
      const projected = projectSelection(sheet, selection)!;
      expect(projected[mode]).toEqual([id(2), id(4), id(6)]);
      expect(mode === 'rows' ? projected.rowRuns : projected.columnRuns).toEqual([{ start: 1, end: 1 }, { start: 3, end: 3 }, { start: 5, end: 5 }]);
      expect(projected.rectangular).toBe(false);
      expect(projectSelection(sheet, { ...selection, members: [id(2)], extent: selection.anchor })?.rectangular).toBe(true);
    });
    it('toggles members, repairs removed endpoints, and refuses an empty selection', () => {
      const added = toggleAxisMember(sheet, selection, id(3))!;
      expect(added.members).toEqual([id(2), id(3), id(4), id(6)]);
      const removed = toggleAxisMember(sheet, added, id(2))!;
      expect(removed.members).toEqual([id(3), id(4), id(6)]);
      expect(mode === 'rows' ? removed.anchor.cell.rowId : removed.anchor.cell.columnId).toBe(id(3));
      const removedExtent = toggleAxisMember(sheet, selection, id(6))!;
      expect(removedExtent.extent).toEqual(target(2, 2));
      expect(toggleAxisMember(sheet, { ...selection, members: [id(2)], extent: selection.anchor }, id(2))).toBeUndefined();
      expect(toggleAxisMember(sheet, selection, 'missing')).toBeUndefined();
    });
    it('extends from the stable anchor and rejects missing endpoints', () => {
      const extended = extendAxisSelection(sheet, selection, id(4))!;
      expect(extended.members).toEqual([id(2), id(3), id(4)]);
      expect(projectSelection(sheet, extended)?.rectangular).toBe(true);
      expect(extendAxisSelection(sheet, selection, 'missing')).toBeUndefined();
    });
    it('prunes deleted IDs and repairs both endpoint and orthogonal focus deterministically', () => {
      const content = { ...sheet.content, [mode]: sheet.content[mode].filter((item) => item !== id(2) && item !== id(6)), [mode === 'rows' ? 'columns' : 'rows']: sheet.content[mode === 'rows' ? 'columns' : 'rows'].filter((item) => item !== `s:${mode === 'rows' ? 'column' : 'row'}:2`) };
      const pruned = pruneAxisSelection({ ...sheet, content }, selection)!;
      expect(pruned.members).toEqual([id(4)]);
      expect(pruned.anchor).toEqual(mode === 'rows' ? target(4, 1) : target(1, 4));
      expect(pruned.extent).toEqual(mode === 'rows' ? target(4, 1) : target(1, 4));
      expect(projectSelection({ ...sheet, content }, pruned)?.rectangular).toBe(true);
      expect(pruneAxisSelection({ ...sheet, content: { ...content, [mode]: [] } }, selection)).toBeUndefined();
      expect(pruneAxisSelection({ ...sheet, content: { ...content, [mode]: content[mode].filter((x) => x !== id(4)) } }, selection)).toBeUndefined();
    });
    it('reprojects current order after spacing-preserving shift and gather', () => {
      const workbook = workbookWithSheets([sheet]);
      const shifted = shiftAxis(workbook, 's', axis, selection.members, 1);
      expect(shifted.status).toBe('changed'); if (shifted.status !== 'changed') return;
      expect(projectSelection(shifted.workbook.documents.s!, selection)?.rectangular).toBe(false);
      const gathered = gatherAxis(shifted.workbook, 's', axis, selection.members, 7);
      expect(gathered.status).toBe('changed'); if (gathered.status !== 'changed') return;
      expect(projectSelection(gathered.workbook.documents.s!, selection)).toMatchObject({ [mode]: [id(2), id(4), id(6)], rectangular: true });
    });
  });
}
describe('selection validation', () => {
  const cells: Selection = { mode: 'cells', anchor: target(2, 3), extent: target(4, 5) };
  it('keeps ordinary cell selections rectangular', () => {
    expect(projectSelection(sheet, cells)).toMatchObject({ bounds: { rowStart: 1, rowEnd: 3, columnStart: 2, columnEnd: 4 }, rectangular: true });
    expect(projectSelection(sheet, { ...cells, members: ['s:row:2'] })).toBeUndefined();
  });
  it('rejects mismatched ownership, invalid mode, missing axes, duplicates and stale identities', () => {
    const rows: AxisSelection = { ...cells, mode: 'rows', members: ['s:row:2', 's:row:4'] };
    expect(projectSelection(sheet, { ...rows, anchor: { ...rows.anchor, sheetId: 'other' } })).toBeUndefined();
    expect(projectSelection(sheet, { ...rows, mode: 'invalid' as 'rows' })).toBeUndefined();
    expect(projectSelection(sheet, { ...rows, members: [] })).toBeUndefined();
    expect(projectSelection(sheet, { ...rows, members: ['s:row:2', 's:row:2'] })).toBeUndefined();
    expect(projectSelection(sheet, { ...rows, members: ['s:row:2', 'missing'] })).toBeUndefined();
    expect(projectSelection(sheet, { ...rows, members: ['s:row:2'] })).toBeUndefined();
    expect(projectSelection(sheet, { ...cells, extent: target(9, 1) })).toBeUndefined();
    expect(projectSelection({ ...sheet, content: { ...sheet.content, rows: [] } }, cells)).toBeUndefined();
    expect(projectSelection({ ...sheet, content: { ...sheet.content, rows: ['x', 'x'] } }, cells)).toBeUndefined();
  });
});
