import { describe, expect, it } from 'vitest';
import {
  appendColumn,
  appendRow,
  commitCellRawContent,
  createEmptyWorkbook,
  createSheet,
  findSheetByName,
  moveSheetZOrder,
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
        revision: 0,
        position: { x: 12, y: 24 },
        frameSize: { width: 240, height: 160 },
        zIndex: 1,
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

  it('stacks new sheets above older sheets by default', () => {
    const first = sheet('sheet-1', 'Inputs');
    const secondResult = createSheet({
      id: 'sheet-2',
      name: 'Outputs',
      existingSheets: [first],
    });

    expect(secondResult.ok).toBe(true);
    if (secondResult.ok) {
      expect(first.zIndex).toBe(1);
      expect(secondResult.value.zIndex).toBe(2);
    }
  });

  it('moves a sheet one level through deterministic z-order without reordering workbook sheets', () => {
    const workbook = {
      version: 1 as const,
      sheets: [sheet('sheet-1', 'Inputs'), sheet('sheet-2', 'Assumptions'), sheet('sheet-3', 'Outputs')],
    };

    const movedUp = moveSheetZOrder(workbook, 'sheet-1', 'up');

    expect(movedUp.ok).toBe(true);
    if (movedUp.ok) {
      expect(movedUp.value.sheets.map((candidate) => candidate.id)).toEqual(['sheet-1', 'sheet-2', 'sheet-3']);
      expect(movedUp.value.sheets.map((candidate) => [candidate.id, candidate.zIndex])).toEqual([
        ['sheet-1', 2],
        ['sheet-2', 1],
        ['sheet-3', 3],
      ]);
    }
  });

  it('moves a sheet to the top and bottom of the deterministic z-order', () => {
    const workbook = {
      version: 1 as const,
      sheets: [sheet('sheet-1', 'Inputs'), sheet('sheet-2', 'Assumptions'), sheet('sheet-3', 'Outputs')],
    };

    const movedToTop = moveSheetZOrder(workbook, 'sheet-1', 'top');
    expect(movedToTop.ok).toBe(true);
    if (!movedToTop.ok) {
      throw new Error('Expected top z-order move to succeed');
    }

    expect(movedToTop.value.sheets.map((candidate) => [candidate.id, candidate.zIndex])).toEqual([
      ['sheet-1', 3],
      ['sheet-2', 1],
      ['sheet-3', 2],
    ]);

    const movedToBottom = moveSheetZOrder(movedToTop.value, 'sheet-1', 'bottom');
    expect(movedToBottom.ok).toBe(true);
    if (movedToBottom.ok) {
      expect(movedToBottom.value.sheets.map((candidate) => [candidate.id, candidate.zIndex])).toEqual([
        ['sheet-1', 1],
        ['sheet-2', 2],
        ['sheet-3', 3],
      ]);
    }
  });

  it('renames a sheet without rewriting cell content', () => {
    const workbook = {
      version: 1 as const,
      sheets: [
        {
          ...sheet('sheet-1', 'Inputs'),
          cells: {
            A1: " =SUM( 'Old Name'!A1 )\n",
          },
        },
      ],
    };

    const result = renameSheet(workbook, 'sheet-1', 'Renamed');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sheets[0].name).toBe('Renamed');
      expect(result.value.sheets[0].cells.A1).toBe(" =SUM( 'Old Name'!A1 )\n");
    }
  });

  it('appends rows and columns without changing existing cells', () => {
    const original = {
      ...sheet('sheet-1', 'Inputs'),
      cells: { A1: '42' },
    };

    expect(appendRow(original)).toMatchObject({
      rowCount: 21,
      columnCount: 10,
      cells: { A1: '42' },
    });
    expect(appendColumn(original)).toMatchObject({
      rowCount: 20,
      columnCount: 11,
      cells: { A1: '42' },
    });
  });

  it('commits raw cell content and clears stored cells', () => {
    const workbook = {
      version: 1 as const,
      sheets: [sheet('sheet-1', 'Inputs')],
    };

    const withText = commitCellRawContent(workbook, 'sheet-1', 'A1', 'Region');
    expect(withText).not.toBe(workbook);
    expect(withText.sheets[0].cells.A1).toBe('Region');

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
            A1: '',
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
            A1: 'Original',
          },
        },
      ],
    };

    expect(commitCellRawContent(workbook, 'sheet-1', 'B1', '')).toBe(workbook);
    expect(commitCellRawContent(workbook, 'sheet-1', 'A1', 'Original')).toBe(workbook);
    expect(commitCellRawContent(workbook, 'missing-sheet', 'A1', 'Value')).toBe(workbook);
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
