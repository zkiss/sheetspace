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
  evaluateFormulaCells,
  expandRange,
  findSheetByName,
  formulaRawForDisplay,
  formulaRawForStorage,
  formulaSheetReferenceIds,
  moveSheetZOrder,
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
            address: { columnIndex: 0, rowIndex: 0 },
            sourceSpan: { start: 5, end: 7 },
          },
          {
            kind: 'range',
            range: {
              start: { columnIndex: 1, rowIndex: 1 },
              end: { columnIndex: 2, rowIndex: 2 },
            },
            sourceSpan: { start: 9, end: 14 },
          },
        ],
        sourceSpan: { start: 1, end: 15 },
      },
    });
  });

  it.each([
    ['=01', 1, { start: 1, end: 3 }],
    ['=12.', 12, { start: 1, end: 4 }],
    ['=.5', 0.5, { start: 1, end: 3 }],
    ['=1.e2', 100, { start: 1, end: 5 }],
    ['=.5e2', 50, { start: 1, end: 5 }],
    ['=1e+2', 100, { start: 1, end: 5 }],
  ])('parses numeric literal %s', (raw, value, sourceSpan) => {
    const { workbook, inputs } = formulaWorkbook();

    expect(parseFormula(raw, workbook, inputs)).toEqual({
      kind: 'formula',
      raw,
      expression: { kind: 'number', value, sourceSpan },
    });
  });

  it('parses text and boolean literals without normalizing raw formula text', () => {
    const { workbook, inputs } = formulaWorkbook();
    const raw = '="say ""hi""\nthere"';

    expect(parseFormula(raw, workbook, inputs)).toEqual({
      kind: 'formula',
      raw,
      expression: {
        kind: 'text',
        value: 'say "hi"\nthere',
        sourceSpan: { start: 1, end: raw.length },
      },
    });
    expect(parseFormula('=TrUe', workbook, inputs)).toEqual({
      kind: 'formula',
      raw: '=TrUe',
      expression: {
        kind: 'boolean',
        value: true,
        sourceSpan: { start: 1, end: 5 },
      },
    });
    expect(parseFormula('=false', workbook, inputs)).toEqual({
      kind: 'formula',
      raw: '=false',
      expression: {
        kind: 'boolean',
        value: false,
        sourceSpan: { start: 1, end: 6 },
      },
    });
  });

  it('parses nested literals, calls, and grouped expressions into source-aware nodes', () => {
    const { workbook, inputs } = formulaWorkbook();
    const raw = '=SUM(1, "x", TRUE, ((A1)), SUM(B2))';

    expect(parseFormula(raw, workbook, inputs)).toEqual({
      kind: 'formula',
      raw,
      expression: {
        kind: 'sum',
        functionName: 'SUM',
        sourceSpan: { start: 1, end: 35 },
        arguments: [
          { kind: 'number', value: 1, sourceSpan: { start: 5, end: 6 } },
          { kind: 'text', value: 'x', sourceSpan: { start: 8, end: 11 } },
          { kind: 'boolean', value: true, sourceSpan: { start: 13, end: 17 } },
          {
            kind: 'group',
            sourceSpan: { start: 19, end: 25 },
            expression: {
              kind: 'group',
              sourceSpan: { start: 20, end: 24 },
              expression: {
                kind: 'cell',
                address: { columnIndex: 0, rowIndex: 0 },
                sourceSpan: { start: 21, end: 23 },
              },
            },
          },
          {
            kind: 'sum',
            functionName: 'SUM',
            sourceSpan: { start: 27, end: 34 },
            arguments: [
              {
                kind: 'cell',
                address: { columnIndex: 1, rowIndex: 1 },
                sourceSpan: { start: 31, end: 33 },
              },
            ],
          },
        ],
      },
    });
  });

  it('parses zero-argument SUM as an empty call', () => {
    const { workbook, inputs } = formulaWorkbook();

    expect(parseFormula('=sUm()', workbook, inputs)).toEqual({
      kind: 'formula',
      raw: '=sUm()',
      expression: {
        kind: 'sum',
        functionName: 'SUM',
        arguments: [],
        sourceSpan: { start: 1, end: 6 },
      },
    });
  });

  it.each([
    '=.',
    '=1e',
    '=1e+',
    '="unterminated',
    '=(A1',
    '=A1)',
    '=()',
    '=(A1, B1)',
    '="x" trailing',
    '=SUM(K1',
    '=SUM(Missing!A1',
  ])('reports malformed literal or grouping %s as #PARSE!', (raw) => {
    const { workbook, inputs } = formulaWorkbook();

    expect(parseFormula(raw, workbook, inputs)).toEqual({
      kind: 'error',
      raw,
      error: '#PARSE!',
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

  it('parses canonical cross-sheet cell and range references by sheet id', () => {
    const { workbook, inputs } = formulaWorkbook();

    expect(parseFormula('=SUM(sheet-2!A1, sheet-1!B2:C3)', workbook, inputs)).toMatchObject({
      kind: 'formula',
      expression: {
        arguments: [
          {
            kind: 'cell',
            sheetId: 'sheet-2',
            address: { columnIndex: 0, rowIndex: 0 },
          },
          {
            kind: 'range',
            sheetId: 'sheet-1',
            range: {
              start: { columnIndex: 1, rowIndex: 1 },
              end: { columnIndex: 2, rowIndex: 2 },
            },
          },
        ],
      },
    });
  });

  it('parses spans for quoted and digit-leading canonical sheet qualifiers', () => {
    const { workbook, inputs } = formulaWorkbook();
    workbook.sheets.push(sheet('123e4567-e89b-12d3-a456-426614174000', 'UUID inputs'));

    expect(
      parseFormula(
        "=SUM('sheet-3'!A1, 123e4567-e89b-12d3-a456-426614174000!B2)",
        workbook,
        inputs,
      ),
    ).toMatchObject({
      kind: 'formula',
      expression: {
        arguments: [
          {
            kind: 'cell',
            sheetId: 'sheet-3',
            sourceSpan: { start: 5, end: 17 },
            sheetReferenceSpan: { start: 5, end: 14 },
          },
          {
            kind: 'cell',
            sheetId: '123e4567-e89b-12d3-a456-426614174000',
            sourceSpan: { start: 19, end: 58 },
            sheetReferenceSpan: { start: 19, end: 55 },
          },
        ],
      },
    });
  });

  it('excludes surrounding whitespace from reference token spans', () => {
    const { workbook, inputs } = formulaWorkbook();
    const raw = '=SUM(A1 \n, sheet-2 \t! B2 \n: C3)';

    expect(parseFormula(raw, workbook, inputs)).toMatchObject({
      kind: 'formula',
      expression: {
        arguments: [
          {
            kind: 'cell',
            sourceSpan: { start: 5, end: 7 },
          },
          {
            kind: 'range',
            sheetId: 'sheet-2',
            sourceSpan: { start: 11, end: 30 },
            sheetReferenceSpan: { start: 11, end: 18 },
          },
        ],
      },
    });
  });

  it('canonicalizes visible sheet names while preserving surrounding formula text', () => {
    const { workbook } = formulaWorkbook();
    const raw = "=sUm( Outputs !A1, 'Sales Q1'!A1:B2, 'Owner''s Plan'!C3 )";

    expect(formulaRawForStorage(raw, workbook)).toBe(
      '=sUm( sheet-2 !A1, sheet-3!A1:B2, sheet-5!C3 )',
    );
  });

  it('does not canonicalize sheet-like references inside text literals', () => {
    const { workbook } = formulaWorkbook();
    const raw = '=SUM("Inputs!A1 and ""Sales Q1!B2""", Inputs!A1)';

    expect(formulaRawForStorage(raw, workbook)).toBe(
      '=SUM("Inputs!A1 and ""Sales Q1!B2""", sheet-1!A1)',
    );
    expect(formulaRawForDisplay('="sheet-1!A1"', workbook)).toBe('="sheet-1!A1"');
  });

  it('keeps canonical ids in parsed formula references', () => {
    const { workbook, inputs } = formulaWorkbook();
    const raw = '=SUM(sheet-1!A1, sheet-3!A1:B2)';

    expect(parseFormula(raw, workbook, inputs)).toMatchObject({
      kind: 'formula',
      expression: {
        arguments: [
          { kind: 'cell', sheetId: 'sheet-1' },
          { kind: 'range', sheetId: 'sheet-3' },
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

  it('reports malformed unknown function calls as #PARSE! before name resolution', () => {
    const { workbook, inputs } = formulaWorkbook();

    for (const raw of ['=AVERAGE((A1)', '=NOPE("unterminated)', '=NOPE(Missing!A1']) {
      expect(parseFormula(raw, workbook, inputs)).toEqual({
        kind: 'error',
        raw,
        error: '#PARSE!',
      });
    }
    expect(parseFormula('=NOPE(K1)', workbook, inputs)).toEqual({
      kind: 'error',
      raw: '=NOPE(K1)',
      error: '#NAME!',
    });
    expect(parseFormula('=SUM(NOPE())', workbook, inputs)).toEqual({
      kind: 'error',
      raw: '=SUM(NOPE())',
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

  it('extracts canonical ids without treating malformed formulas as references', () => {
    expect(formulaSheetReferenceIds('=SUM(sheet-1!A1, sheet-3!A1:B2)')).toEqual(['sheet-1', 'sheet-3']);
    expect(formulaSheetReferenceIds("=SUM('broken!A1, text sheet-2! nope)")).toEqual([]);
  });

  it('renders formula edit text from current sheet names without changing stored ids', () => {
    const inputs = sheet('sheet-1', 'Renamed Inputs');
    const outputs = sheet('sheet-2', 'Outputs');
    const workbook = { version: 1 as const, sheets: [inputs, outputs] };
    const cell = '=SUM(sheet-1!A1)';

    expect(formulaRawForDisplay(cell, workbook)).toBe("=SUM('Renamed Inputs'!A1)");
  });

  it('renders unknown canonical ids as #REF qualifiers', () => {
    const workbook = { version: 1 as const, sheets: [sheet('sheet-2', 'Outputs')] };

    expect(formulaRawForDisplay('=SUM(sheet-deleted!A1)', workbook)).toBe('=SUM(#REF!A1)');
  });
});

describe('formula evaluator', () => {
  function sheetWithCells(id: string, name: string, cells: Sheet['cells']): Sheet {
    return {
      ...sheet(id, name),
      cells,
    };
  }

  it('evaluates same-sheet SUM references, ranges, variable arguments, and empty cells', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '1',
      A2: '2',
      B1: '  -3.5  ',
      B2: '=SUM(A1:A2, B1, C1)',
      B3: '=SUM()',
    });
    const workbook = { version: 1 as const, sheets: [inputs] };

    expect(evaluateFormulaCells(workbook)['sheet-1'].B2).toEqual({
      kind: 'number',
      value: -0.5,
      display: '-0.5',
    });
    expect(evaluateFormulaCells(workbook)['sheet-1'].B3).toEqual({
      kind: 'number',
      value: 0,
      display: '0',
    });
  });

  it('evaluates cross-sheet cell and range references by canonical sheet id', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '4',
      A2: '5',
      B1: '6',
      B2: '7',
    });
    const sales = sheetWithCells('sheet-2', 'Sales Q1', {
      A1: '3',
    });
    const outputs = sheetWithCells('sheet-3', 'Outputs', {
      A1: '=SUM(sheet-1!A1:B2, sheet-2!A1)',
    });
    const workbook = { version: 1 as const, sheets: [inputs, sales, outputs] };

    expect(evaluateFormulaCells(workbook)['sheet-3'].A1).toMatchObject({
      kind: 'number',
      value: 25,
      display: '25',
    });
  });

  it('evaluates persisted sheet references by uuid after the target is renamed', () => {
    const inputs = sheetWithCells('sheet-1', 'Renamed Inputs', {
      A1: '7',
    });
    const outputs = sheetWithCells('sheet-2', 'Outputs', {
      A1: '=SUM(sheet-1!A1)',
    });
    const workbook = { version: 1 as const, sheets: [inputs, outputs] };

    expect(evaluateFormulaCells(workbook)['sheet-2'].A1).toMatchObject({
      kind: 'number',
      value: 7,
      display: '7',
    });
  });

  it('does not rebind persisted references when a deleted target placeholder name is reused', () => {
    const replacementInputs = sheetWithCells('sheet-replacement', '__sheetspace_missing_sheet_deleted', {
      A1: '99',
    });
    const outputs = sheetWithCells('sheet-2', 'Outputs', {
      A1: '=SUM(sheet-deleted!A1)',
    });
    const workbook = { version: 1 as const, sheets: [replacementInputs, outputs] };

    expect(evaluateFormulaCells(workbook)['sheet-2'].A1).toMatchObject({
      kind: 'error',
      error: '#REF!',
      display: '#REF!',
    });
  });

  it('uses strict trimmed decimal and integer semantics for referenced values', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '  10 ',
      A2: '-2.25',
      A3: '=SUM(A1:A2)',
      B1: '=SUM(C1)',
      B2: '=SUM(C2)',
      B3: '=SUM(C3)',
      C1: '+1',
      C2: '1.',
      C3: '1e2',
    });
    const workbook = { version: 1 as const, sheets: [inputs] };

    const results = evaluateFormulaCells(workbook)['sheet-1'];
    expect(results.A3).toMatchObject({ kind: 'number', value: 7.75, display: '7.75' });
    expect(results.B1).toMatchObject({ kind: 'error', error: '#VALUE!', display: '#VALUE!' });
    expect(results.B2).toMatchObject({ kind: 'error', error: '#VALUE!', display: '#VALUE!' });
    expect(results.B3).toMatchObject({ kind: 'error', error: '#VALUE!', display: '#VALUE!' });
  });

  it('keeps parse, name, ref, and value failures isolated to cell-level results', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '=SUM(A1,)',
      A2: '=AVERAGE(B1)',
      A3: '=SUM(Missing!A1)',
      A4: '=SUM(B1)',
      A5: '=SUM(C1)',
      A6: '=SUM(K1)',
      A7: '=SUM(A1:K1)',
      A8: '=SUM(A1:)',
      B1: 'text',
      C1: '8',
    });
    const workbook = { version: 1 as const, sheets: [inputs] };

    const results = evaluateFormulaCells(workbook)['sheet-1'];
    expect(results.A1).toMatchObject({ kind: 'error', error: '#PARSE!' });
    expect(results.A2).toMatchObject({ kind: 'error', error: '#NAME!' });
    expect(results.A3).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(results.A4).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.A5).toMatchObject({ kind: 'number', value: 8 });
    expect(results.A6).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(results.A7).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(results.A8).toMatchObject({ kind: 'error', error: '#PARSE!' });
  });

  it('propagates the first referenced formula error in argument and row-major range order', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '=SUM(Missing!A1)',
      B1: 'text',
      A2: '=SUM(A1:B1)',
      A3: '=SUM(B1, A1)',
    });
    const workbook = { version: 1 as const, sheets: [inputs] };

    const results = evaluateFormulaCells(workbook)['sheet-1'];
    expect(results.A2).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(results.A3).toMatchObject({ kind: 'error', error: '#VALUE!' });
  });

  it('detects direct, indirect, and cross-sheet cycles without replacing raw formulas', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '=SUM(A1)',
      A2: '=SUM(A3)',
      A3: '=SUM(A2)',
      B1: '=SUM(sheet-2!B1)',
    });
    const outputs = sheetWithCells('sheet-2', 'Outputs', {
      B1: '=SUM(sheet-1!B1)',
    });
    const workbook = { version: 1 as const, sheets: [inputs, outputs] };

    const results = evaluateFormulaCells(workbook);
    expect(results['sheet-1'].A1).toMatchObject({ kind: 'error', error: '#CYCLE!' });
    expect(results['sheet-1'].A2).toMatchObject({ kind: 'error', error: '#CYCLE!' });
    expect(results['sheet-1'].A3).toMatchObject({ kind: 'error', error: '#CYCLE!' });
    expect(results['sheet-1'].B1).toMatchObject({ kind: 'error', error: '#CYCLE!' });
    expect(results['sheet-2'].B1).toMatchObject({ kind: 'error', error: '#CYCLE!' });
    expect(workbook.sheets[0].cells.A1).toBe('=SUM(A1)');
  });
});
