import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import {
  preparePasteCellWrites,
  prepareStoredPasteCellWrites,
  type CellWrite,
} from '@application/core/userActions';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import { decodeCellTextLiteral, encodeCellTextLiteral } from '@workbook/core/cellLiteral';
import { classifyCellValue } from '@calculation/formulaValue';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';

const write = (sheetId: string, cell: { rowId: string; columnId: string }, raw: string): CellWrite => ({ sheetId, ...cell, raw });

describe('paste preparation', () => {
  it('preserves a stored snapshot and translates its retained references on copy', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet' });
    const workbook = workbookWithSheets([sheet]);
    const identity = cellIdentityAt(sheet.content, 'A1')!;
    const raw = prepareUserFormula('=@A[1]+@Missing!A[0]', workbook, sheet.id);
    const clipboard = { ok: true as const, value: {
      kind: 'internal' as const, grid: { rowCount: 1, columnCount: 1, rows: [['display']] },
      source: { sheetId: sheet.id, dimensions: { rowCount: 1, columnCount: 1 }, cells: [[{ identity, raw }]] },
    } };
    expect(prepareStoredPasteCellWrites(workbook, sheet.id, identity, clipboard)).toEqual({ ok: true, writes: [write(sheet.id, identity, raw)] });
    const copied = prepareStoredPasteCellWrites(workbook, sheet.id, cellIdentityAt(sheet.content, 'B1')!, clipboard);
    expect(copied.ok).toBe(true);
    if (!copied.ok) throw new Error(copied.reason);
    expect(projectStoredFormula(copied.writes[0]!.raw, workbook, sheet.id).text).toBe('=@B[1]+@Missing!A[0]');
  });
  it('classifies scalar-looking direct and tabular fields as numbers and booleans', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet' });
    const workbook = workbookWithSheets([sheet]);
    for (const fields of [[['001']], [['1.00', 'true'], ['001', 'FALSE']]]) {
      const result = preparePasteCellWrites(workbook, sheet.id, cellIdentityAt(sheet.content, 'A1')!, {
        ok: true, value: { kind: 'external', grid: { rowCount: fields.length, columnCount: fields[0]!.length, rows: fields } },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('paste failed');
      expect(result.writes.map(({ raw }) => classifyCellValue(raw)))
        .toEqual(fields.flat().map((value) => classifyCellValue(value)));
    }
  });
  it('preserves formula-like and envelope-like external fields as exact literal text', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet' });
    const envelope = encodeCellTextLiteral('hidden');
    const result = preparePasteCellWrites(workbookWithSheets([sheet]), sheet.id, cellIdentityAt(sheet.content, 'A1')!, {
      ok: true, value: { kind: 'external', grid: { rowCount: 1, columnCount: 2, rows: [['=1+2', envelope]] } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('paste failed');
    expect(result.writes.map((item) => decodeCellTextLiteral(item.raw))).toEqual(['=1+2', envelope]);
  });
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

  it('copies a mixed internal range with formula offsets and literal identity intact', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 3, columnCount: 3 });
    const literal = encodeCellTextLiteral('=1+2');
    const result = preparePasteCellWrites(workbookWithSheets([sheet]), sheet.id, cellIdentityAt(sheet.content, 'B2')!, {
      ok: true, value: {
        kind: 'internal', grid: { rowCount: 1, columnCount: 2, rows: [['=@B[1]', '=1+2']] },
        source: { sheetId: sheet.id, dimensions: { rowCount: 1, columnCount: 2 }, cells: [[
          { identity: cellIdentityAt(sheet.content, 'A1')!, raw: '=@sheet:column:2[sheet:row:1]' },
          { identity: cellIdentityAt(sheet.content, 'B1')!, raw: literal },
        ]] },
      },
    });
    expect(result).toEqual({ ok: true, writes: [
      write(sheet.id, cellIdentityAt(sheet.content, 'B2')!, '=@sheet:column:3[sheet:row:2]'),
      write(sheet.id, cellIdentityAt(sheet.content, 'C2')!, literal),
    ] });
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
