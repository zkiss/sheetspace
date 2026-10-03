import { describe, expect, it } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { applyFormatWrites } from '@workbook/core/numberFormat';
import type { CellAppearance } from '@workbook/core/model';
import { sheetDocument } from '@test-support/workbookFactories';
import { validateFormattingSelection } from './formattingSelection';
import { materializeFormattingWrites, selectionAppearanceWrites, selectionFormattingWrites } from './formattingWrites';

const sheet = sheetDocument({ id: 'formatting', name: 'Formatting', rowCount: 3, columnCount: 2 });
const endpoint = (row: number, column: number) => ({ sheetId: sheet.id, cell: { rowId: sheet.content.rows[row]!, columnId: sheet.content.columns[column]! } });

describe.each(['cells', 'rows', 'columns'] as const)('%s formatting selection geometry', (mode) => {
  it('normalizes reversed stable endpoints and re-resolves them after axis reordering', () => {
    const selection = { mode, anchor: endpoint(2, 1), extent: endpoint(0, 0) };
    const validated = validateFormattingSelection(sheet, selection);
    expect(validated).toMatchObject({ valid: true, rowStart: 0, rowEnd: 2, columnStart: 0, columnEnd: 1, effectiveSize: 6, writeCount: mode === 'cells' ? 6 : mode === 'rows' ? 3 : 2 });

    const reordered = { ...sheet, content: { ...sheet.content, rows: [sheet.content.rows[2]!, sheet.content.rows[1]!, sheet.content.rows[0]!] } };
    expect(validateFormattingSelection(reordered, selection)).toMatchObject({ valid: true, rowStart: 0, rowEnd: 2 });
    expect(validateFormattingSelection({ ...reordered, content: { ...reordered.content, rows: reordered.content.rows.slice(1) } }, selection)).toEqual({ valid: false });
  });

  it.each([
    ['missing anchor row', { mode, anchor: { ...endpoint(0, 0), cell: { ...endpoint(0, 0).cell, rowId: 'missing' } }, extent: endpoint(1, 1) }],
    ['missing extent row', { mode, anchor: endpoint(0, 0), extent: { ...endpoint(1, 1), cell: { ...endpoint(1, 1).cell, rowId: 'missing' } } }],
    ['missing anchor column', { mode, anchor: { ...endpoint(0, 0), cell: { ...endpoint(0, 0).cell, columnId: 'missing' } }, extent: endpoint(1, 1) }],
    ['missing extent column', { mode, anchor: endpoint(0, 0), extent: { ...endpoint(1, 1), cell: { ...endpoint(1, 1).cell, columnId: 'missing' } } }],
    ['cross-sheet anchor', { mode, anchor: { ...endpoint(0, 0), sheetId: 'other' }, extent: endpoint(1, 1) }],
    ['cross-sheet extent', { mode, anchor: endpoint(0, 0), extent: { ...endpoint(1, 1), sheetId: 'other' } }],
  ])('invalidates %s', (_, selection) => {
    expect(validateFormattingSelection(sheet, selection)).toEqual({ valid: false });
    expect(selectionFormattingWrites(sheet, selection, 'fontWeight', 'bold')).toEqual([]);
  });

  it('rejects null sheets and empty axes', () => {
    const selection = { mode, anchor: endpoint(0, 0), extent: endpoint(0, 0) };
    expect(validateFormattingSelection(sheet, null)).toEqual({ valid: false });
    expect(validateFormattingSelection(undefined, selection)).toEqual({ valid: false });
    expect(validateFormattingSelection({ ...sheet, content: { ...sheet.content, rows: [] } }, selection)).toEqual({ valid: false });
    expect(validateFormattingSelection({ ...sheet, content: { ...sheet.content, columns: [] } }, selection)).toEqual({ valid: false });
  });
});

describe('formatting writes', () => {
  it.each(['cells', 'rows', 'columns'] as const)('writes each property and reset at %s scope without expanding axis writes', (mode) => {
    const selection = { mode, anchor: endpoint(2, 1), extent: endpoint(1, 0) };
    const validated = validateFormattingSelection(sheet, selection);
    if (!validated.valid) throw new Error('expected valid selection');
    const properties: readonly [keyof CellAppearance, NonNullable<CellAppearance[keyof CellAppearance]>][] = [
      ['numberFormat', { kind: 'percent', precision: 3 }], ['fontWeight', 'bold'], ['horizontalAlignment', 'center'], ['textColor', '#abcdef'], ['fillColor', '#abcdef'],
    ];
    const count = mode === 'cells' ? 4 : 2;
    for (const [property, value] of properties) {
      const writes = materializeFormattingWrites(validated, property, value);
      expect(writes).toHaveLength(count);
      const targets = mode === 'rows' ? sheet.content.rows.slice(1) : mode === 'columns' ? sheet.content.columns : [
        cellIdentityKey(endpoint(1, 0).cell), cellIdentityKey(endpoint(1, 1).cell), cellIdentityKey(endpoint(2, 0).cell), cellIdentityKey(endpoint(2, 1).cell),
      ];
      const scope = mode === 'cells' ? 'cell' : mode === 'rows' ? 'row' : 'column';
      expect(writes).toEqual(targets.map((targetId) => ({ scope, targetId, properties: { [property]: value } })));
      expect(materializeFormattingWrites(validated, property, null)).toEqual(targets.map((targetId) => ({ scope, targetId, properties: { [property]: null } })));
    }
    if (mode === 'cells') expect(materializeFormattingWrites(validated, 'fillColor', '#abcdef').map((write) => write.targetId)).toEqual([
      cellIdentityKey(endpoint(1, 0).cell), cellIdentityKey(endpoint(1, 1).cell), cellIdentityKey(endpoint(2, 0).cell), cellIdentityKey(endpoint(2, 1).cell),
    ]);
  });

  it('rejects empty and multi-property control patches and preserves sibling overrides on reset', () => {
    const selection = { mode: 'rows' as const, anchor: endpoint(0, 0), extent: endpoint(0, 1) };
    expect(selectionAppearanceWrites(sheet, selection, {})).toEqual([]);
    expect(selectionAppearanceWrites(sheet, selection, { fontWeight: 'bold', fillColor: '#abcdef' })).toEqual([]);
    const rowId = sheet.content.rows[0]!;
    const cellKey = cellIdentityKey(endpoint(0, 1).cell);
    const initial = {
      rows: { [rowId]: { fontWeight: 'bold' as const, fillColor: '#abcdef' as const } },
      columns: {},
      cells: { [cellKey]: { fontWeight: 'normal' as const } },
    };
    expect(applyFormatWrites(initial, selectionAppearanceWrites(sheet, selection, { fontWeight: null }))).toEqual({
      rows: { [rowId]: { fillColor: '#abcdef' } }, columns: {}, cells: { [cellKey]: { fontWeight: 'normal' } },
    });
  });
});
