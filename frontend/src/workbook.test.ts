import { describe, expect, it } from 'vitest';
import {
  appendColumn,
  appendRow,
  cellKey,
  columnIndexToLabel,
  columnLabelToIndex,
  commitCellRawContent,
  createEmptyWorkbook,
  createSheet,
  expandRange,
  findSheetByName,
  parseA1Address,
  parseA1Range,
  parseNamedA1Address,
  parseNamedA1Range,
  renameSheet,
  validateSheetName,
  type Sheet,
} from './workbook';

function sheet(id: string, name: string): Sheet {
  const result = createSheet({ id, name });
  if (!result.ok) {
    throw new Error(`Failed to create test sheet ${name}`);
  }
  return result.value;
}

describe('workbook model', () => {
  it('creates an empty workbook with no sheets', () => {
    expect(createEmptyWorkbook()).toEqual({ version: 1, sheets: [] });
  });

  it('creates named sheets with MVP defaults and no cell values', () => {
    const result = createSheet({
      id: 'sheet-1',
      name: 'Inputs',
      position: { x: 12, y: 24 },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        id: 'sheet-1',
        name: 'Inputs',
        position: { x: 12, y: 24 },
        columnCount: 10,
        rowCount: 20,
        cells: {},
      },
    });
  });

  it('rejects empty and duplicate sheet names', () => {
    const existing = [sheet('sheet-1', 'Inputs')];

    expect(validateSheetName('   ', existing)).toEqual({ ok: false, reason: 'empty' });
    expect(validateSheetName('Inputs', existing)).toEqual({ ok: false, reason: 'duplicate' });
    expect(validateSheetName(' Inputs ', existing, 'sheet-1')).toEqual({ ok: true, name: 'Inputs' });
  });

  it('renames a sheet without rewriting cell content', () => {
    const workbook = {
      version: 1 as const,
      sheets: [
        {
          ...sheet('sheet-1', 'Inputs'),
          cells: {
            A1: { raw: " =SUM( 'Old Name'!A1 )\n" },
          },
        },
      ],
    };

    const result = renameSheet(workbook, 'sheet-1', 'Renamed');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sheets[0].name).toBe('Renamed');
      expect(result.value.sheets[0].cells.A1.raw).toBe(" =SUM( 'Old Name'!A1 )\n");
    }
  });

  it('appends rows and columns without changing existing cells', () => {
    const original = {
      ...sheet('sheet-1', 'Inputs'),
      cells: { A1: { raw: '42' } },
    };

    expect(appendRow(original)).toMatchObject({
      rowCount: 21,
      columnCount: 10,
      cells: { A1: { raw: '42' } },
    });
    expect(appendColumn(original)).toMatchObject({
      rowCount: 20,
      columnCount: 11,
      cells: { A1: { raw: '42' } },
    });
  });

  it('commits raw cell content and clears stored cells', () => {
    const workbook = {
      version: 1 as const,
      sheets: [sheet('sheet-1', 'Inputs')],
    };

    const withText = commitCellRawContent(workbook, 'sheet-1', 'A1', 'Region');
    expect(withText).not.toBe(workbook);
    expect(withText.sheets[0].cells.A1.raw).toBe('Region');

    const cleared = commitCellRawContent(withText, 'sheet-1', 'A1', '');
    expect(cleared).not.toBe(withText);
    expect(cleared.sheets[0].cells.A1).toBeUndefined();
  });

  it('clears an existing stored empty cell instead of preserving it as a no-op', () => {
    const workbook = {
      version: 1 as const,
      sheets: [
        {
          ...sheet('sheet-1', 'Inputs'),
          cells: {
            A1: { raw: '' },
          },
        },
      ],
    };

    const cleared = commitCellRawContent(workbook, 'sheet-1', 'A1', '');

    expect(cleared).not.toBe(workbook);
    expect(cleared.sheets[0].cells.A1).toBeUndefined();
  });

  it('leaves workbook state unchanged for no-op cell commits', () => {
    const workbook = {
      version: 1 as const,
      sheets: [
        {
          ...sheet('sheet-1', 'Inputs'),
          cells: {
            A1: { raw: 'Original' },
          },
        },
      ],
    };

    expect(commitCellRawContent(workbook, 'sheet-1', 'B1', '')).toBe(workbook);
    expect(commitCellRawContent(workbook, 'sheet-1', 'A1', 'Original')).toBe(workbook);
    expect(commitCellRawContent(workbook, 'missing-sheet', 'A1', 'Value')).toBe(workbook);
  });
});

describe('column labels and A1 addressing', () => {
  it('converts zero-based column indexes to Excel-style labels', () => {
    expect(columnIndexToLabel(0)).toBe('A');
    expect(columnIndexToLabel(1)).toBe('B');
    expect(columnIndexToLabel(25)).toBe('Z');
    expect(columnIndexToLabel(26)).toBe('AA');
    expect(columnIndexToLabel(27)).toBe('AB');
  });

  it('converts column labels back to zero-based indexes', () => {
    expect(columnLabelToIndex('A')).toEqual({ ok: true, value: 0 });
    expect(columnLabelToIndex('z')).toEqual({ ok: true, value: 25 });
    expect(columnLabelToIndex('AA')).toEqual({ ok: true, value: 26 });
    expect(columnLabelToIndex('A1')).toEqual({ ok: false, reason: 'invalid-format' });
  });

  it('parses and normalizes A1 addresses', () => {
    expect(parseA1Address('a1')).toEqual({ ok: true, value: { columnIndex: 0, rowIndex: 0 } });
    expect(parseA1Address('AB20')).toEqual({ ok: true, value: { columnIndex: 27, rowIndex: 19 } });
    expect(cellKey({ columnIndex: 27, rowIndex: 19 })).toBe('AB20');
  });

  it('rejects malformed and out-of-bounds A1 addresses', () => {
    const bounds = sheet('sheet-1', 'Inputs');

    expect(parseA1Address('A 1', bounds)).toEqual({ ok: false, reason: 'invalid-format' });
    expect(parseA1Address('A0', bounds)).toEqual({ ok: false, reason: 'invalid-format' });
    expect(parseA1Address('K1', bounds)).toEqual({ ok: false, reason: 'out-of-bounds' });
    expect(parseA1Address('A21', bounds)).toEqual({ ok: false, reason: 'out-of-bounds' });
  });

  it('parses and expands rectangular ranges inside sheet bounds', () => {
    const bounds = sheet('sheet-1', 'Inputs');
    const range = parseA1Range('A1:C2', bounds);

    expect(range.ok).toBe(true);
    if (range.ok) {
      expect(expandRange(range.value, bounds)).toEqual({
        ok: true,
        value: [
          { columnIndex: 0, rowIndex: 0 },
          { columnIndex: 1, rowIndex: 0 },
          { columnIndex: 2, rowIndex: 0 },
          { columnIndex: 0, rowIndex: 1 },
          { columnIndex: 1, rowIndex: 1 },
          { columnIndex: 2, rowIndex: 1 },
        ],
      });
    }
  });

  it('normalizes reversed ranges before expansion', () => {
    const bounds = sheet('sheet-1', 'Inputs');
    const range = parseA1Range('C2:A1', bounds);

    expect(range.ok).toBe(true);
    if (range.ok) {
      expect(range.value.start).toEqual({ columnIndex: 0, rowIndex: 0 });
      expect(range.value.end).toEqual({ columnIndex: 2, rowIndex: 1 });
    }
  });

  it('rejects malformed and out-of-bounds ranges', () => {
    const bounds = sheet('sheet-1', 'Inputs');

    expect(parseA1Range('A1', bounds)).toEqual({ ok: false, reason: 'invalid-format' });
    expect(parseA1Range('A1:K1', bounds)).toEqual({ ok: false, reason: 'out-of-bounds' });
  });
});

describe('cross-sheet helpers', () => {
  it('finds sheets by current visible name', () => {
    const workbook = { version: 1 as const, sheets: [sheet('sheet-1', 'Inputs')] };

    expect(findSheetByName(workbook, 'Inputs')).toEqual({ ok: true, value: workbook.sheets[0] });
    expect(findSheetByName(workbook, 'Missing')).toEqual({ ok: false, reason: 'unknown-sheet' });
  });

  it('parses same-sheet references using a default sheet', () => {
    const defaultSheet = sheet('sheet-1', 'Inputs');
    const workbook = { version: 1 as const, sheets: [defaultSheet] };

    expect(parseNamedA1Address('B2', workbook, defaultSheet)).toEqual({
      ok: true,
      value: { columnIndex: 1, rowIndex: 1, sheetName: undefined },
    });
  });

  it('parses unquoted and quoted cross-sheet references', () => {
    const workbook = {
      version: 1 as const,
      sheets: [sheet('sheet-1', 'Inputs'), sheet('sheet-2', 'Sales Q1')],
    };

    expect(parseNamedA1Address('Inputs!A1', workbook)).toEqual({
      ok: true,
      value: { columnIndex: 0, rowIndex: 0, sheetName: 'Inputs' },
    });
    expect(parseNamedA1Range("'Sales Q1'!A1:B2", workbook)).toEqual({
      ok: true,
      value: {
        sheetName: 'Sales Q1',
        start: { columnIndex: 0, rowIndex: 0 },
        end: { columnIndex: 1, rowIndex: 1 },
      },
    });
  });

  it('rejects references to unknown sheets and malformed sheet syntax', () => {
    const workbook = { version: 1 as const, sheets: [sheet('sheet-1', 'Inputs')] };

    expect(parseNamedA1Address('Missing!A1', workbook)).toEqual({
      ok: false,
      reason: 'unknown-sheet',
    });
    expect(parseNamedA1Address("'Missing!A1", workbook)).toEqual({
      ok: false,
      reason: 'invalid-format',
    });
  });
});
