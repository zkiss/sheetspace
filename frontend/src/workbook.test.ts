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
  parseFormula,
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

describe('formula parser', () => {
  function formulaWorkbook() {
    const inputs = sheet('sheet-1', 'Inputs');
    const outputs = sheet('sheet-2', 'Outputs');
    const sales = sheet('sheet-3', 'Sales Q1');
    const planned = sheet('sheet-4', 'Planned-Revenue (FY26)');
    const ownerPlan = sheet('sheet-5', "Owner's Plan");

    return {
      workbook: {
        version: 1 as const,
        sheets: [inputs, outputs, sales, planned, ownerPlan],
      },
      inputs,
      outputs,
      sales,
      planned,
      ownerPlan,
    };
  }

  it('ignores non-formula content', () => {
    const { workbook, inputs } = formulaWorkbook();

    expect(parseFormula('SUM(A1)', workbook, inputs)).toEqual({ kind: 'not-formula', raw: 'SUM(A1)' });
  });

  it('parses SUM formulas case-insensitively without rewriting raw formula text', () => {
    const { workbook, inputs } = formulaWorkbook();
    const raw = '=sUm(A1, B2:C3)';

    expect(parseFormula(raw, workbook, inputs)).toEqual({
      kind: 'formula',
      raw,
      expression: {
        kind: 'sum',
        functionName: 'SUM',
        arguments: [
          {
            kind: 'cell',
            sheetName: undefined,
            address: { columnIndex: 0, rowIndex: 0 },
          },
          {
            kind: 'range',
            sheetName: undefined,
            range: {
              start: { columnIndex: 1, rowIndex: 1 },
              end: { columnIndex: 2, rowIndex: 2 },
            },
          },
        ],
      },
    });
  });

  it('allows whitespace and newlines around formula separators', () => {
    const { workbook, inputs } = formulaWorkbook();

    expect(parseFormula('= \n SUM \t ( \n A1 \n , \t B2 \n : \t C3 \n ) ', workbook, inputs)).toMatchObject({
      kind: 'formula',
      expression: {
        arguments: [
          { kind: 'cell', address: { columnIndex: 0, rowIndex: 0 } },
          {
            kind: 'range',
            range: {
              start: { columnIndex: 1, rowIndex: 1 },
              end: { columnIndex: 2, rowIndex: 2 },
            },
          },
        ],
      },
    });
  });

  it('parses unquoted cross-sheet cell and range references', () => {
    const { workbook, inputs } = formulaWorkbook();

    expect(parseFormula('=SUM(Outputs!A1, Inputs!B2:C3)', workbook, inputs)).toMatchObject({
      kind: 'formula',
      expression: {
        arguments: [
          {
            kind: 'cell',
            sheetName: 'Outputs',
            address: { columnIndex: 0, rowIndex: 0 },
          },
          {
            kind: 'range',
            sheetName: 'Inputs',
            range: {
              start: { columnIndex: 1, rowIndex: 1 },
              end: { columnIndex: 2, rowIndex: 2 },
            },
          },
        ],
      },
    });
  });

  it('parses quoted cross-sheet references for sheet names with spaces and punctuation', () => {
    const { workbook, inputs } = formulaWorkbook();

    expect(parseFormula("=SUM('Sales Q1'!A1:B2, 'Planned-Revenue (FY26)'!C3)", workbook, inputs)).toMatchObject({
      kind: 'formula',
      expression: {
        arguments: [
          {
            kind: 'range',
            sheetName: 'Sales Q1',
            range: {
              start: { columnIndex: 0, rowIndex: 0 },
              end: { columnIndex: 1, rowIndex: 1 },
            },
          },
          {
            kind: 'cell',
            sheetName: 'Planned-Revenue (FY26)',
            address: { columnIndex: 2, rowIndex: 2 },
          },
        ],
      },
    });
  });

  it('parses quoted sheet names with escaped apostrophes', () => {
    const { workbook, inputs } = formulaWorkbook();

    expect(parseFormula("=SUM('Owner''s Plan'!A1:B2)", workbook, inputs)).toMatchObject({
      kind: 'formula',
      expression: {
        arguments: [
          {
            kind: 'range',
            sheetName: "Owner's Plan",
            range: {
              start: { columnIndex: 0, rowIndex: 0 },
              end: { columnIndex: 1, rowIndex: 1 },
            },
          },
        ],
      },
    });
  });

  it('reports unsupported functions as #NAME!', () => {
    const { workbook, inputs } = formulaWorkbook();

    expect(parseFormula('=AVERAGE(A1:A3)', workbook, inputs)).toEqual({
      kind: 'error',
      raw: '=AVERAGE(A1:A3)',
      error: '#NAME!',
    });
  });

  it('reports invalid syntax as #PARSE!', () => {
    const { workbook, inputs } = formulaWorkbook();

    expect(parseFormula('=SUM(A1,)', workbook, inputs)).toEqual({
      kind: 'error',
      raw: '=SUM(A1,)',
      error: '#PARSE!',
    });
    expect(parseFormula('=SUM(A 1)', workbook, inputs)).toEqual({
      kind: 'error',
      raw: '=SUM(A 1)',
      error: '#PARSE!',
    });
  });

  it('reports unresolved sheet names and out-of-bounds references as #REF!', () => {
    const { workbook, inputs } = formulaWorkbook();

    expect(parseFormula('=SUM(Missing!A1)', workbook, inputs)).toEqual({
      kind: 'error',
      raw: '=SUM(Missing!A1)',
      error: '#REF!',
    });
    expect(parseFormula('=SUM(K1)', workbook, inputs)).toEqual({
      kind: 'error',
      raw: '=SUM(K1)',
      error: '#REF!',
    });
  });

  it('reports malformed quote and address cases as #PARSE!', () => {
    const { workbook, inputs } = formulaWorkbook();

    expect(parseFormula("=SUM('Sales Q1!A1)", workbook, inputs)).toEqual({
      kind: 'error',
      raw: "=SUM('Sales Q1!A1)",
      error: '#PARSE!',
    });
    expect(parseFormula('=SUM(A0)', workbook, inputs)).toEqual({
      kind: 'error',
      raw: '=SUM(A0)',
      error: '#PARSE!',
    });
  });
});
