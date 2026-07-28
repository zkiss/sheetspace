import { describe, expect, it } from 'vitest';
import {
  appendColumn,
  appendRow,
  classifyCellValue,
  commitCellRawContent,
  createEmptyWorkbook,
  createSheet,
  displayFormulaValue,
  evaluateFormulaCells,
  findSheetByName,
  formulaCollectionValues,
  formulaErrorValue,
  FormulaCalculation,
  formulaScalarValue,
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

  it('evaluates common numeric and aggregate functions over scalars, references, and ranges', () => {
    const inputs = sheetWithCells('sheet-inputs', 'Inputs', {
      A1: '2',
      A2: '4',
      A3: 'text',
      A4: 'TRUE',
      A5: '',
      A6: '   ',
      B1: '=AVERAGE(A1:A6, 10)',
      B2: '=MIN(A1:A6, -1)',
      B3: '=MAX(A1:A6, 10)',
      B4: '=COUNT(A1:A6, "9", FALSE, 3)',
      B5: '=COUNTA(A1:A6, "", FALSE)',
      B6: '=ABS(-3.5)',
      B7: '=SQRT(ABS(-16))',
      C1: '-11',
      C2: '25',
    });
    const outputs = sheetWithCells('sheet-outputs', 'Outputs', {
      A1: '=AVERAGE(sheet-inputs!A1:A2)',
      A2: '=COUNT(sheet-inputs!A1:A6)',
      A3: '=COUNTA(sheet-inputs!A1:A6)',
      A4: '=MIN(sheet-inputs!A1:A6)',
      A5: '=MAX(sheet-inputs!A1:A6)',
      A6: '=ABS(sheet-inputs!C1)',
      A7: '=SQRT(sheet-inputs!C2)',
    });
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs, outputs] });

    expect(results['sheet-inputs'].B1).toMatchObject({ kind: 'number', value: 16 / 3 });
    expect(results['sheet-inputs'].B2).toMatchObject({ kind: 'number', value: -1 });
    expect(results['sheet-inputs'].B3).toMatchObject({ kind: 'number', value: 10 });
    expect(results['sheet-inputs'].B4).toMatchObject({ kind: 'number', value: 3 });
    expect(results['sheet-inputs'].B5).toMatchObject({ kind: 'number', value: 7 });
    expect(results['sheet-inputs'].B6).toMatchObject({ kind: 'number', value: 3.5 });
    expect(results['sheet-inputs'].B7).toMatchObject({ kind: 'number', value: 4 });
    expect(results['sheet-outputs'].A1).toMatchObject({ kind: 'number', value: 3 });
    expect(results['sheet-outputs'].A2).toMatchObject({ kind: 'number', value: 2 });
    expect(results['sheet-outputs'].A3).toMatchObject({ kind: 'number', value: 5 });
    expect(results['sheet-outputs'].A4).toMatchObject({ kind: 'number', value: 2 });
    expect(results['sheet-outputs'].A5).toMatchObject({ kind: 'number', value: 4 });
    expect(results['sheet-outputs'].A6).toMatchObject({ kind: 'number', value: 11 });
    expect(results['sheet-outputs'].A7).toMatchObject({ kind: 'number', value: 5 });
  });

  it('applies aggregate empty, arity, type, domain, and error rules consistently', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '=AVERAGE(B1:B3)',
      A2: '=MIN(B1:B3)',
      A3: '=MAX(B1:B3)',
      A4: '=COUNT()',
      A5: '=COUNTA()',
      A6: '=ABS()',
      A7: '=ABS(1, 2)',
      A8: '=ABS(B1:B2)',
      A9: '=SQRT(-1)',
      A10: '=SQRT("4")',
      A11: '=AVERAGE(C1:C2)',
      A12: '=COUNT(B1:B3)',
      B1: 'text',
      B2: 'TRUE',
      B3: '',
      C1: '=SUM(Missing!A1)',
      C2: '1',
    });
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs] })['sheet-1'];

    expect(results.A1).toMatchObject({ kind: 'error', error: '#DIV/0!' });
    expect(results.A2).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.A3).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.A4).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.A5).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.A6).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.A7).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.A8).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.A9).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.A10).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.A11).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(results.A12).toMatchObject({ kind: 'number', value: 0 });
  });

  it('evaluates arithmetic precedence, grouping, associativity, unary chains, and references', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '8',
      A2: '2',
      B1: '=1+2*3',
      B2: '=(1+2)*3',
      B3: '=10-3-2',
      B4: '=--A1 + +A2',
      B5: '=-(A1+2)',
    });
    const outputs = sheetWithCells('sheet-2', 'Outputs', {
      A1: '=sheet-1!A1/sheet-1!A2',
    });
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs, outputs] });

    expect(results['sheet-1'].B1).toMatchObject({ kind: 'number', value: 7 });
    expect(results['sheet-1'].B2).toMatchObject({ kind: 'number', value: 9 });
    expect(results['sheet-1'].B3).toMatchObject({ kind: 'number', value: 5 });
    expect(results['sheet-1'].B4).toMatchObject({ kind: 'number', value: 10 });
    expect(results['sheet-1'].B5).toMatchObject({ kind: 'number', value: -10 });
    expect(results['sheet-2'].A1).toMatchObject({ kind: 'number', value: 4 });
  });

  it('returns typed arithmetic errors and isolates unrelated cells', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: 'text',
      A2: '',
      A3: 'TRUE',
      B1: '=1/0',
      B2: '=1/-0',
      B3: '=A1+1',
      B4: '=A2*2',
      B5: '=-A3',
      B6: '=1e308*2',
      B7: '=6/2',
    });
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs] })['sheet-1'];

    expect(results.B1).toMatchObject({ kind: 'error', error: '#DIV/0!' });
    expect(results.B2).toMatchObject({ kind: 'error', error: '#DIV/0!' });
    expect(results.B3).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.B4).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.B5).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.B6).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.B7).toMatchObject({ kind: 'number', value: 3 });
  });

  it('evaluates every comparison operator with equal and unequal numeric boundaries', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '=2=2',
      A2: '=2<>3',
      A3: '=2<3',
      A4: '=2<=2',
      A5: '=3>2',
      A6: '=3>=3',
      A7: '=2>3',
    });
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs] })['sheet-1'];

    for (const key of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']) {
      expect(results[key]).toEqual({ kind: 'boolean', value: true, display: 'TRUE' });
    }
    expect(results.A7).toEqual({ kind: 'boolean', value: false, display: 'FALSE' });
  });

  it('compares text by Unicode code point, booleans FALSE before TRUE, and blank with blank', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '="A"<"a"',
      A2: '="\u{10000}">"\u{E000}"',
      A3: '=FALSE<TRUE',
      A4: '=TRUE>=TRUE',
      A5: '=B1=B2',
      A6: '=B1<=B2',
      A7: '=B1<>B2',
    });
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs] })['sheet-1'];

    for (const key of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']) {
      expect(results[key]).toMatchObject({ kind: 'boolean', value: true });
    }
    expect(results.A7).toMatchObject({ kind: 'boolean', value: false });
  });

  it('applies arithmetic before comparisons and compares same-sheet and cross-sheet references', () => {
    const inputs = sheetWithCells('sheet-inputs', 'Inputs', {
      A1: '3',
      A2: '4',
      B1: '=A1*2>=A2+2',
    });
    const outputs = sheetWithCells('sheet-outputs', 'Outputs', {
      A1: '=B1<sheet-inputs!A2',
      A2: '=sheet-inputs!A1>B1',
      B1: '2',
    });
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs, outputs] });

    expect(results['sheet-inputs'].B1).toMatchObject({ kind: 'boolean', value: true });
    expect(results['sheet-outputs'].A1).toMatchObject({ kind: 'boolean', value: true });
    expect(results['sheet-outputs'].A2).toMatchObject({ kind: 'boolean', value: true });
  });

  it('returns #VALUE! for mixed categories and ranges, and propagates operand errors left to right', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '=1="1"',
      A2: '=TRUE=1',
      A3: '=B1=B2',
      A4: '=B1:B2=B1:B2',
      A5: '=Missing!A1=(1/0)',
      A6: '=(1/0)=Missing!A1',
      B1: '',
      B2: 'text',
    });
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs] })['sheet-1'];

    for (const key of ['A1', 'A2', 'A3', 'A4']) {
      expect(results[key]).toMatchObject({ kind: 'error', error: '#VALUE!' });
    }
    expect(results.A5).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(results.A6).toMatchObject({ kind: 'error', error: '#DIV/0!' });
  });

  it('propagates arithmetic operand errors from left to right', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '=Missing!A1 + (1/0)',
      A2: '=(1/0) + Missing!A1',
    });
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs] })['sheet-1'];

    expect(results.A1).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(results.A2).toMatchObject({ kind: 'error', error: '#DIV/0!' });
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

  it('classifies referenced cells using shared Phase 2 scalar semantics', () => {
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
    expect(results.B1).toMatchObject({ kind: 'number', value: 0, display: '0' });
    expect(results.B2).toMatchObject({ kind: 'number', value: 1, display: '1' });
    expect(results.B3).toMatchObject({ kind: 'number', value: 100, display: '100' });
  });

  it('keeps parse, name, ref, and value failures isolated to cell-level results', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '=SUM(A1,)',
      A2: '=NOPE(B1)',
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
    expect(results.A4).toMatchObject({ kind: 'number', value: 0 });
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
    expect(results.A3).toMatchObject({ kind: 'error', error: '#REF!' });
  });

  it('resolves references when visited so an earlier argument error wins', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '=SUM(A1,)',
      A2: '=SUM(A1, Missing!A1)',
      A3: '=SUM(Missing!A1, A1)',
    });
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs] })['sheet-1'];

    expect(results.A2).toMatchObject({ kind: 'error', error: '#PARSE!' });
    expect(results.A3).toMatchObject({ kind: 'error', error: '#REF!' });
  });

  it('evaluates literal and grouped formulas as typed display results', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '=12.5',
      A2: '="say ""hi"""',
      A3: '=TrUe',
      A4: '=((FALSE))',
      A5: '=""',
      A6: '=1e999',
    });
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs] })['sheet-1'];

    expect(results.A1).toEqual({ kind: 'number', value: 12.5, display: '12.5' });
    expect(results.A2).toEqual({ kind: 'text', value: 'say "hi"', display: 'say "hi"' });
    expect(results.A3).toEqual({ kind: 'boolean', value: true, display: 'TRUE' });
    expect(results.A4).toEqual({ kind: 'boolean', value: false, display: 'FALSE' });
    expect(results.A5).toEqual({ kind: 'text', value: '', display: '' });
    expect(results.A6).toEqual({ kind: 'error', error: '#VALUE!', display: '#VALUE!' });
  });

  it('preserves typed values through same-sheet and cross-sheet scalar references', () => {
    const inputs = sheetWithCells('sheet-inputs', 'Inputs', {
      A1: ' 2.5 ',
      A2: 'TRUE',
      A3: ' source text ',
      A4: '   ',
      B1: '=A1',
      B2: '=A2',
      B3: '=A3',
      B4: '=A5',
    });
    const outputs = sheetWithCells('sheet-outputs', 'Outputs', {
      A1: '=sheet-inputs!B1',
      A2: '=sheet-inputs!B2',
      A3: '=sheet-inputs!B3',
      A4: '=sheet-inputs!B4',
      A5: '=sheet-inputs!A4',
    });
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs, outputs] });

    expect(results['sheet-inputs'].B1).toEqual({ kind: 'number', value: 2.5, display: '2.5' });
    expect(results['sheet-inputs'].B2).toEqual({ kind: 'boolean', value: true, display: 'TRUE' });
    expect(results['sheet-inputs'].B3).toEqual({
      kind: 'text',
      value: ' source text ',
      display: ' source text ',
    });
    expect(results['sheet-inputs'].B4).toEqual({ kind: 'blank', display: '' });
    expect(results['sheet-outputs'].A1).toEqual({ kind: 'number', value: 2.5, display: '2.5' });
    expect(results['sheet-outputs'].A2).toEqual({ kind: 'boolean', value: true, display: 'TRUE' });
    expect(results['sheet-outputs'].A3).toMatchObject({ kind: 'text', value: ' source text ' });
    expect(results['sheet-outputs'].A4).toEqual({ kind: 'blank', display: '' });
    expect(results['sheet-outputs'].A5).toEqual({ kind: 'text', value: '   ', display: '   ' });
  });

  it('rejects a range in scalar position and keeps SUM on the shared collection path', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '2',
      A2: 'text',
      A3: 'FALSE',
      A5: '=Missing!A1',
      B1: '=A1:A3',
      B2: '=SUM(1, "2", TRUE, A1:A4)',
      B3: '=SUM(A1:A5)',
    });
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs] })['sheet-1'];

    expect(results.B1).toEqual({ kind: 'error', error: '#VALUE!', display: '#VALUE!' });
    expect(results.B2).toEqual({ kind: 'number', value: 3, display: '3' });
    expect(results.B3).toEqual({ kind: 'error', error: '#REF!', display: '#REF!' });
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

describe('incremental formula calculation', () => {
  function sheetWithCells(id: string, name: string, cells: Sheet['cells']): Sheet {
    return { ...sheet(id, name), cells };
  }

  it('recomputes direct and transitive diamond dependents without evaluating unrelated formulas', () => {
    const calculation = new FormulaCalculation();
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '1',
      B1: '=SUM(A1)',
      C1: '=SUM(B1)',
      D1: '=SUM(A1)',
      E1: '=SUM(C1,D1)',
      H1: '10',
      I1: '=SUM(H1)',
    });
    const workbook = { version: 1 as const, sheets: [inputs] };
    calculation.update(workbook);
    const evaluated: string[] = [];

    const nextWorkbook = commitCellRawContent(workbook, 'sheet-1', 'A1', '2');
    const results = calculation.update(nextWorkbook, (sheetId, key) => evaluated.push(`${sheetId}:${key}`));

    expect(new Set(evaluated)).toEqual(new Set([
      'sheet-1:B1',
      'sheet-1:C1',
      'sheet-1:D1',
      'sheet-1:E1',
    ]));
    expect(results['sheet-1'].E1).toMatchObject({ kind: 'number', value: 4 });
    expect(results['sheet-1'].I1).toMatchObject({ kind: 'number', value: 10 });
  });

  it('tracks dependencies nested in unary and binary arithmetic expressions', () => {
    const calculation = new FormulaCalculation();
    const inputs = sheetWithCells('sheet-inputs', 'Inputs', {
      A1: '2',
      B1: '10',
    });
    const outputs = sheetWithCells('sheet-outputs', 'Outputs', {
      A1: '=-(sheet-inputs!A1 + 3) * 2',
      B1: '=sheet-inputs!B1 + 1',
    });
    calculation.update({ version: 1 as const, sheets: [inputs, outputs] });

    const evaluated: string[] = [];
    const nextInputs = { ...inputs, cells: { ...inputs.cells, A1: '4' } };
    const results = calculation.update(
      { version: 1 as const, sheets: [nextInputs, outputs] },
      (sheetId, key) => evaluated.push(`${sheetId}:${key}`),
    );

    expect(evaluated).toEqual(['sheet-outputs:A1']);
    expect(results['sheet-outputs'].A1).toMatchObject({ kind: 'number', value: -14 });
    expect(results['sheet-outputs'].B1).toMatchObject({ kind: 'number', value: 11 });
  });

  it('tracks dependencies inside comparison operands', () => {
    const calculation = new FormulaCalculation();
    const inputs = sheetWithCells('sheet-inputs', 'Inputs', { A1: '2' });
    const outputs = sheetWithCells('sheet-outputs', 'Outputs', {
      A1: '=4<=sheet-inputs!A1 + 1',
      A2: '=sheet-inputs!A1 + 1>=4',
      B1: '=10>5',
    });
    calculation.update({ version: 1 as const, sheets: [inputs, outputs] });

    const evaluated: string[] = [];
    const nextInputs = { ...inputs, cells: { ...inputs.cells, A1: '3' } };
    const results = calculation.update(
      { version: 1 as const, sheets: [nextInputs, outputs] },
      (sheetId, key) => evaluated.push(`${sheetId}:${key}`),
    );

    expect(evaluated).toEqual(['sheet-outputs:A1', 'sheet-outputs:A2']);
    expect(results['sheet-outputs'].A1).toMatchObject({ kind: 'boolean', value: true });
    expect(results['sheet-outputs'].A2).toMatchObject({ kind: 'boolean', value: true });
    expect(results['sheet-outputs'].B1).toMatchObject({ kind: 'boolean', value: true });
  });

  it('invalidates range and cross-sheet dependency paths by stable sheet id', () => {
    const calculation = new FormulaCalculation();
    const inputs = sheetWithCells('sheet-inputs', 'Inputs', { A1: '2', A2: '3' });
    const outputs = sheetWithCells('sheet-outputs', 'Outputs', {
      A1: '=SUM(sheet-inputs!A1:A2)',
      A2: '=SUM(A1)',
      B1: '=SUM(B2)',
      B2: '9',
    });
    const workbook = { version: 1 as const, sheets: [inputs, outputs] };
    calculation.update(workbook);
    const evaluated: string[] = [];

    const nextWorkbook = commitCellRawContent(workbook, 'sheet-inputs', 'A2', '8');
    const results = calculation.update(nextWorkbook, (_sheetId, key) => evaluated.push(key));

    expect(new Set(evaluated)).toEqual(new Set(['A1', 'A2']));
    expect(results['sheet-outputs'].A2).toMatchObject({ kind: 'number', value: 10 });
    expect(results['sheet-outputs'].B1).toMatchObject({ kind: 'number', value: 9 });
  });

  it('removes stale edges when formulas change or clear', () => {
    const calculation = new FormulaCalculation();
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '1',
      B1: '10',
      C1: '=SUM(A1)',
      D1: '=SUM(C1)',
    });
    let workbook = { version: 1 as const, sheets: [inputs] };
    calculation.update(workbook);

    workbook = commitCellRawContent(workbook, 'sheet-1', 'C1', '=SUM(B1)');
    calculation.update(workbook);
    const stalePathEvaluated: string[] = [];
    workbook = commitCellRawContent(workbook, 'sheet-1', 'A1', '2');
    calculation.update(workbook, (_sheetId, key) => stalePathEvaluated.push(key));
    expect(stalePathEvaluated).toEqual([]);

    const replacementPathEvaluated: string[] = [];
    workbook = commitCellRawContent(workbook, 'sheet-1', 'B1', '20');
    expect(calculation.update(workbook, (_sheetId, key) => replacementPathEvaluated.push(key))['sheet-1'].D1)
      .toMatchObject({ kind: 'number', value: 20 });
    expect(new Set(replacementPathEvaluated)).toEqual(new Set(['C1', 'D1']));

    workbook = commitCellRawContent(workbook, 'sheet-1', 'C1', '');
    expect(calculation.update(workbook)['sheet-1'].D1).toMatchObject({ kind: 'number', value: 0 });
    const clearedPathEvaluated: string[] = [];
    workbook = commitCellRawContent(workbook, 'sheet-1', 'B1', '30');
    calculation.update(workbook, (_sheetId, key) => clearedPathEvaluated.push(key));
    expect(clearedPathEvaluated).toEqual([]);
  });

  it('preserves cross-sheet identity through rename and reload, then isolates deleted-target errors', () => {
    const calculation = new FormulaCalculation();
    const inputs = sheetWithCells('sheet-inputs', 'Inputs', { A1: '7' });
    const outputs = sheetWithCells('sheet-outputs', 'Outputs', {
      A1: '=SUM(sheet-inputs!A1)',
      B1: '=SUM(B2)',
      B2: '4',
    });
    const workbook = { version: 1 as const, sheets: [inputs, outputs] };
    calculation.update(workbook);
    const renamed = renameSheet(workbook, 'sheet-inputs', 'Renamed Inputs');
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) {
      return;
    }
    const renamedEvaluations: string[] = [];
    expect(calculation.update(renamed.value, (_sheetId, key) => renamedEvaluations.push(key))['sheet-outputs'].A1)
      .toMatchObject({ kind: 'number', value: 7 });
    expect(renamedEvaluations).toEqual([]);

    const reloaded = new FormulaCalculation().update(renamed.value);
    expect(reloaded['sheet-outputs'].A1).toMatchObject({ kind: 'number', value: 7 });

    const deleted = {
      ...renamed.value,
      sheets: renamed.value.sheets.filter((candidate) => candidate.id !== 'sheet-inputs'),
    };
    const deletedResults = calculation.update(deleted);
    expect(deletedResults['sheet-outputs'].A1).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(deletedResults['sheet-outputs'].B1).toMatchObject({ kind: 'number', value: 4 });
  });
});

describe('formula value helpers', () => {
  it('classifies blank, number, boolean, and raw text cells centrally', () => {
    expect(classifyCellValue('')).toEqual({ kind: 'blank' });
    expect(classifyCellValue(' .5e2 ')).toEqual({ kind: 'number', value: 50 });
    expect(classifyCellValue(' false ')).toEqual({ kind: 'boolean', value: false });
    expect(classifyCellValue('   ')).toEqual({ kind: 'text', value: '   ' });
    expect(classifyCellValue('Infinity')).toEqual({ kind: 'text', value: 'Infinity' });
  });

  it('provides shared scalar, collection, error, and display boundaries', () => {
    const range = {
      kind: 'range' as const,
      values: [{ kind: 'number' as const, value: 1 }, { kind: 'blank' as const }],
      rowCount: 2,
      columnCount: 1,
    };

    expect(formulaCollectionValues(range)).toEqual(range.values);
    expect(formulaScalarValue(range)).toEqual({ kind: 'error', error: '#VALUE!' });
    expect(formulaErrorValue('#DIV/0!')).toEqual({ kind: 'error', error: '#DIV/0!' });
    expect(displayFormulaValue({ kind: 'number', value: -0 })).toEqual({
      kind: 'number',
      value: -0,
      display: '0',
    });
  });
});
