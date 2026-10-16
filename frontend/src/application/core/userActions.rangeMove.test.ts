import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import {
  prepareMoveCellWrites,
  type CellWrite,
} from '@application/core/userActions';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import type { ClipboardSourceSnapshot } from '@application/core/clipboardPayload';

type Sheet = ReturnType<typeof sheetDocument>;
const write = (sheetId: string, cell: { rowId: string; columnId: string }, raw: string): CellWrite => ({ sheetId, ...cell, raw });

describe('range move preparation', () => {
  const snapshot = (sheet: Sheet, start: string, rowCount = 1, columnCount = 1): ClipboardSourceSnapshot => {
    const origin = cellIdentityAt(sheet.content, start)!;
    const rowIndex = sheet.content.rows.indexOf(origin.rowId);
    const columnIndex = sheet.content.columns.indexOf(origin.columnId);
    const cells = Array.from({ length: rowCount }, (_, rowOffset) => Array.from({ length: columnCount }, (_, columnOffset) => {
      const identity = { rowId: sheet.content.rows[rowIndex + rowOffset]!, columnId: sheet.content.columns[columnIndex + columnOffset]! };
      return { identity, raw: sheet.content.cells[`${identity.rowId}\u0000${identity.columnId}`] ?? '' };
    }));
    return { sheetId: sheet.id, dimensions: { rowCount, columnCount }, cells };
  };

  it.each([
    ['left', { B1: 'one', C1: 'two', D1: 'three' }, 'B1', 'A1', 1, 2, ['A1', 'B1', 'C1'], ['one', 'two', '']],
    ['right', { A1: 'one', B1: 'two', C1: 'three' }, 'A1', 'B1', 1, 2, ['B1', 'C1', 'A1'], ['one', 'two', '']],
    ['up', { A2: 'one', A3: 'two', A4: 'three' }, 'A2', 'A1', 2, 1, ['A1', 'A2', 'A3'], ['one', 'two', '']],
    ['down', { A1: 'one', A2: 'two', A3: 'three' }, 'A1', 'A2', 2, 1, ['A2', 'A3', 'A1'], ['one', 'two', '']],
  ] as const)('handles %s overlap from a pre-move snapshot with unique final writes', (_direction, cells, source, destination, rowCount, columnCount, addresses, raws) => {
    const input = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 4, columnCount: 4, cells });
    const result = prepareMoveCellWrites(workbookWithSheets([input]), input.id, cellIdentityAt(input.content, destination)!, snapshot(input, source, rowCount, columnCount));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.writes).toEqual(addresses.map((address, index) => write(input.id, cellIdentityAt(input.content, address)!, raws[index]!)));
    expect(new Set(result.writes.map((item) => `${item.sheetId}:${item.rowId}:${item.columnId}`)).size).toBe(result.writes.length);
  });

  it('moves nonoverlapping ranges across sheets, retaining blanks, raw formulas, and stable identity mappings', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 3, columnCount: 3, cells: { A1: '=@source:column:2[source:row:1]', B1: '' } });
    const destination = sheetDocument({ id: 'destination', name: 'Destination', rowCount: 3, columnCount: 3, cells: { B2: 'old', C2: 'replace' } });
    const sourceSnapshot = snapshot(source, 'A1', 1, 2);
    const result = prepareMoveCellWrites(workbookWithSheets([source, destination]), destination.id, cellIdentityAt(destination.content, 'B2')!, sourceSnapshot);
    expect(result).toEqual({
      ok: true,
      writes: [
        write(destination.id, cellIdentityAt(destination.content, 'B2')!, '=@source:column:2[source:row:1]'),
        write(destination.id, cellIdentityAt(destination.content, 'C2')!, ''),
        write(source.id, cellIdentityAt(source.content, 'A1')!, ''),
        write(source.id, cellIdentityAt(source.content, 'B1')!, ''),
      ],
      mappings: [
        { source: { sheetId: source.id, cell: cellIdentityAt(source.content, 'A1')! }, destination: { sheetId: destination.id, cell: cellIdentityAt(destination.content, 'B2')! } },
        { source: { sheetId: source.id, cell: cellIdentityAt(source.content, 'B1')! }, destination: { sheetId: destination.id, cell: cellIdentityAt(destination.content, 'C2')! } },
      ],
    });
  });

  it('clears a nonoverlapping same-sheet source after writing its destination', () => {
    const input = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 4, cells: { A1: 'one', B1: 'two', C1: 'old', D1: 'old' } });
    const result = prepareMoveCellWrites(workbookWithSheets([input]), input.id, cellIdentityAt(input.content, 'C1')!, snapshot(input, 'A1', 1, 2));
    expect(result).toMatchObject({
      ok: true,
      writes: [
        write(input.id, cellIdentityAt(input.content, 'C1')!, 'one'),
        write(input.id, cellIdentityAt(input.content, 'D1')!, 'two'),
        write(input.id, cellIdentityAt(input.content, 'A1')!, ''),
        write(input.id, cellIdentityAt(input.content, 'B1')!, ''),
      ],
    });
  });

  it('reports a same-origin move as a successful no-op while retaining identity mappings', () => {
    const input = sheetDocument({ id: 'sheet', name: 'Sheet', cells: { A1: 'value' } });
    const result = prepareMoveCellWrites(workbookWithSheets([input]), input.id, cellIdentityAt(input.content, 'A1')!, snapshot(input, 'A1'));
    expect(result).toEqual({ ok: true, writes: [], mappings: [{ source: { sheetId: input.id, cell: cellIdentityAt(input.content, 'A1')! }, destination: { sheetId: input.id, cell: cellIdentityAt(input.content, 'A1')! } }] });
  });

  it('rejects malformed, stale, and unavailable inputs atomically without mutating workbook or snapshot', () => {
    const input = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 2, cells: { A1: 'original' } });
    const workbook = workbookWithSheets([input]);
    const source = snapshot(input, 'A1');
    const originalWorkbook = structuredClone(workbook);
    const originalSnapshot = structuredClone(source);
    const changedWorkbook = structuredClone(workbook);
    changedWorkbook.documents.sheet.content.cells[`${input.content.rows[0]!}\u0000${input.content.columns[0]!}`] = 'changed';
    const malformed = { ...source, dimensions: { rowCount: 2, columnCount: 1 } };
    const missingCell = { ...source, cells: [[{ identity: { rowId: 'gone', columnId: 'gone' }, raw: 'original' }]] };

    expect(prepareMoveCellWrites(workbook, 'missing', cellIdentityAt(input.content, 'A1')!, source)).toEqual({ ok: false, reason: 'invalid-destination' });
    expect(prepareMoveCellWrites(workbook, input.id, { rowId: 'gone', columnId: 'gone' }, source)).toEqual({ ok: false, reason: 'invalid-destination' });
    expect(prepareMoveCellWrites(workbook, input.id, cellIdentityAt(input.content, 'A1')!, { ...source, dimensions: { rowCount: 2, columnCount: 2 }, cells: [[source.cells[0]![0]!, source.cells[0]![0]!], [source.cells[0]![0]!, source.cells[0]![0]!]] })).toEqual({ ok: false, reason: 'invalid-move-source' });
    expect(prepareMoveCellWrites(workbook, input.id, cellIdentityAt(input.content, 'B2')!, malformed)).toEqual({ ok: false, reason: 'invalid-move-source' });
    expect(prepareMoveCellWrites(workbook, input.id, cellIdentityAt(input.content, 'B2')!, missingCell)).toEqual({ ok: false, reason: 'invalid-move-source' });
    expect(prepareMoveCellWrites(changedWorkbook, input.id, cellIdentityAt(input.content, 'B2')!, source)).toEqual({ ok: false, reason: 'stale-move-source' });
    expect(prepareMoveCellWrites(workbook, input.id, cellIdentityAt(input.content, 'B2')!, { ...source, sheetId: 'missing' })).toEqual({ ok: false, reason: 'invalid-move-source' });
    expect(workbook).toEqual(originalWorkbook);
    expect(source).toEqual(originalSnapshot);
  });

  it('rejects noncontiguous snapshots, unsafe dimensions, and destination overflows', () => {
    const input = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 3, cells: { A1: 'one', B1: 'two', C1: 'three' } });
    const workbook = workbookWithSheets([input]);
    const source = snapshot(input, 'A1', 1, 2);
    const noncontiguous = structuredClone(source);
    noncontiguous.cells[0]![1]!.identity = cellIdentityAt(input.content, 'C1')!;

    expect(prepareMoveCellWrites(workbook, input.id, cellIdentityAt(input.content, 'A2')!, noncontiguous))
      .toEqual({ ok: false, reason: 'invalid-move-source' });
    expect(prepareMoveCellWrites(workbook, input.id, cellIdentityAt(input.content, 'A2')!, {
      ...source, dimensions: { rowCount: 1.5, columnCount: 2 },
    })).toEqual({ ok: false, reason: 'invalid-move-source' });
    expect(prepareMoveCellWrites(workbook, input.id, cellIdentityAt(input.content, 'C2')!, source))
      .toEqual({ ok: false, reason: 'invalid-move-footprint' });
  });
});
