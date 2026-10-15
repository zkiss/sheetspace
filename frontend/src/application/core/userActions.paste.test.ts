import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import {
  
  
  
  preparePasteCellWrites,
  
  
  type CellWrite,
  
} from '@application/core/userActions';
import { cellIdentityAt } from '@workbook/core/cellIdentity';

const write = (sheetId: string, cell: { rowId: string; columnId: string }, raw: string): CellWrite => ({ sheetId, ...cell, raw });

describe('paste preparation', () => {
  it('materializes blanks and translates an internal canonical formula at its matching source coordinate', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', cells: { A1: '=@B[1]', B1: '4' } });
    const destination = sheetDocument({ id: 'destination', name: 'Destination', cells: { B2: 'old' } });
    const sourceWorkbook = workbookWithSheets([source, destination]);
    const result = preparePasteCellWrites(
      sourceWorkbook,
      destination.id,
      cellIdentityAt(destination.content, 'B2')!,
      {
        ok: true,
        value: {
          kind: 'internal',
          grid: { rowCount: 1, columnCount: 2, rows: [['=@B[1]', '']] },
          source: {
            sheetId: source.id,
            dimensions: { rowCount: 1, columnCount: 2 },
            cells: [[
              { identity: cellIdentityAt(source.content, 'A1')!, raw: '=@source:column:2[source:row:1]' },
              { identity: cellIdentityAt(source.content, 'B1')!, raw: '' },
            ]],
          },
        },
      },
    );

    expect(result).toEqual({
      ok: true,
      writes: [
        write(destination.id, cellIdentityAt(destination.content, 'B2')!, '=@destination:column:3[destination:row:2]'),
        write(destination.id, cellIdentityAt(destination.content, 'C2')!, ''),
      ],
    });
  });

  it('rejects an out-of-bounds footprint before generating a partial write', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 1 });
    const result = preparePasteCellWrites(workbookWithSheets([sheet]), sheet.id, cellIdentityAt(sheet.content, 'A1')!, {
      ok: true,
      value: { kind: 'external', grid: { rowCount: 1, columnCount: 2, rows: [['one', 'two']] } },
    });
    expect(result).toEqual({ ok: false, reason: 'invalid-paste-footprint' });
  });

  it('rejects malformed parser output, invalid destinations, and invalid internal source snapshots before writing', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet' });
    const workbook = workbookWithSheets([sheet]);
    const destination = cellIdentityAt(sheet.content, 'A1')!;
    const grid = { rowCount: 1, columnCount: 1, rows: [['value']] };

    expect(preparePasteCellWrites(workbook, sheet.id, destination, { ok: false, reason: 'malformed-tsv' }))
      .toEqual({ ok: false, reason: 'malformed-tsv' });
    expect(preparePasteCellWrites(workbook, 'missing', destination, { ok: true, value: { kind: 'external', grid } }))
      .toEqual({ ok: false, reason: 'invalid-destination' });
    expect(preparePasteCellWrites(workbook, sheet.id, destination, {
      ok: true, value: { kind: 'external', grid: { rowCount: 1, columnCount: 1, rows: [] } },
    })).toEqual({ ok: false, reason: 'invalid-paste-footprint' });
    expect(preparePasteCellWrites(workbook, sheet.id, destination, {
      ok: true,
      value: {
        kind: 'internal', grid,
        source: { sheetId: 'missing', dimensions: { rowCount: 1, columnCount: 1 }, cells: [[{ identity: destination, raw: 'value' }]] },
      },
    })).toEqual({ ok: false, reason: 'invalid-internal-source' });
    expect(preparePasteCellWrites(workbook, sheet.id, destination, {
      ok: true,
      value: {
        kind: 'internal', grid,
        source: { sheetId: sheet.id, dimensions: { rowCount: 2, columnCount: 1 }, cells: [[{ identity: destination, raw: 'value' }]] },
      },
    })).toEqual({ ok: false, reason: 'invalid-internal-source' });
    expect(preparePasteCellWrites(workbook, sheet.id, destination, {
      ok: true,
      value: {
        kind: 'internal', grid,
        source: {
          sheetId: sheet.id, dimensions: { rowCount: 1, columnCount: 1 },
          cells: [[{ identity: { rowId: 'missing-row', columnId: 'missing-column' }, raw: 'value' }]],
        },
      },
    })).toEqual({ ok: false, reason: 'invalid-internal-source' });
  });
});
