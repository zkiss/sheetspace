import { describe, expect, it } from 'vitest';
import {
  formulaRawForDisplay,
  formulaRawForStorage,
  formulaSheetReferenceIds,
  type SheetDocument,
  type Workbook,
} from './workbook';
import { parseFormula as parseFormulaSyntax } from './formulaSyntax';
import { sheetDocument, workbookWithSheets } from './test/workbookFactories';

function parseFormula(raw: string, _workbook?: unknown, _sheet?: unknown) {
  return parseFormulaSyntax(raw);
}

function sheet(id: string, name: string): SheetDocument {
  return sheetDocument({ id, name });
}

function appendSheet(workbook: Workbook, document: SheetDocument) {
  workbook.manifest.sheetIds.push(document.id);
  workbook.documents[document.id] = document;
}

describe('formula parser', () => {
  function formulaWorkbook() {
    const inputs = sheet('sheet-1', 'Inputs');
    const outputs = sheet('sheet-2', 'Outputs');
    const sales = sheet('sheet-3', 'Sales Q1');
    const planned = sheet('sheet-4', 'Planned-Revenue (FY26)');
    const ownerPlan = sheet('sheet-5', "Owner's Plan");

    return {
      workbook: workbookWithSheets([inputs, outputs, sales, planned, ownerPlan]),
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
        kind: 'function',
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
        kind: 'function',
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
            kind: 'function',
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

  it('parses arithmetic with conventional precedence, associativity, unary operators, and spans', () => {
    const { workbook, inputs } = formulaWorkbook();

    expect(parseFormula('=1+2*3-4/2', workbook, inputs)).toEqual({
      kind: 'formula',
      raw: '=1+2*3-4/2',
      expression: {
        kind: 'binary',
        operator: '-',
        sourceSpan: { start: 1, end: 10 },
        left: {
          kind: 'binary',
          operator: '+',
          sourceSpan: { start: 1, end: 6 },
          left: { kind: 'number', value: 1, sourceSpan: { start: 1, end: 2 } },
          right: {
            kind: 'binary',
            operator: '*',
            sourceSpan: { start: 3, end: 6 },
            left: { kind: 'number', value: 2, sourceSpan: { start: 3, end: 4 } },
            right: { kind: 'number', value: 3, sourceSpan: { start: 5, end: 6 } },
          },
        },
        right: {
          kind: 'binary',
          operator: '/',
          sourceSpan: { start: 7, end: 10 },
          left: { kind: 'number', value: 4, sourceSpan: { start: 7, end: 8 } },
          right: { kind: 'number', value: 2, sourceSpan: { start: 9, end: 10 } },
        },
      },
    });

    expect(parseFormula('=-(A1+2)', workbook, inputs)).toMatchObject({
      kind: 'formula',
      expression: {
        kind: 'unary',
        operator: '-',
        operand: {
          kind: 'group',
          expression: {
            kind: 'binary',
            operator: '+',
          },
        },
      },
    });
  });

  it.each(['=', '<>', '<', '<=', '>', '>='] as const)(
    'parses comparison operator %s below arithmetic precedence',
    (operator) => {
      const { workbook, inputs } = formulaWorkbook();
      const raw = `=1+2*3 ${operator} 8-1`;

      expect(parseFormula(raw, workbook, inputs)).toMatchObject({
        kind: 'formula',
        raw,
        expression: {
          kind: 'binary',
          operator,
          sourceSpan: { start: 1, end: raw.length },
          left: {
            kind: 'binary',
            operator: '+',
            right: { kind: 'binary', operator: '*' },
          },
          right: { kind: 'binary', operator: '-' },
        },
      });
    },
  );

  it.each(['=1<2<3', '=1<>2=TRUE', '=1>=2<=3'])(
    'rejects chained comparison %s',
    (raw) => {
      const { workbook, inputs } = formulaWorkbook();
      expect(parseFormula(raw, workbook, inputs)).toEqual({
        kind: 'error',
        raw,
        error: '#PARSE!',
      });
    },
  );

  it.each(['=', '<>', '<', '<=', '>', '>='] as const)(
    'parses either canonical cross-sheet operand adjacent to comparison operator %s',
    (operator) => {
      const { workbook, inputs } = formulaWorkbook();

      expect(parseFormula(`=A1${operator}sheet-2!B1`, workbook, inputs)).toMatchObject({
        kind: 'formula',
        expression: {
          kind: 'binary',
          operator,
          left: { kind: 'cell' },
          right: { kind: 'cell', sheetId: 'sheet-2' },
        },
      });
      expect(parseFormula(`=sheet-2!B1${operator}A1`, workbook, inputs)).toMatchObject({
        kind: 'formula',
        expression: {
          kind: 'binary',
          operator,
          left: { kind: 'cell', sheetId: 'sheet-2' },
          right: { kind: 'cell' },
        },
      });
    },
  );

  it.each(['=1+', '=1*/2', '=+', '=1 2'])('rejects malformed arithmetic %s', (raw) => {
    const { workbook, inputs } = formulaWorkbook();
    expect(parseFormula(raw, workbook, inputs)).toEqual({ kind: 'error', raw, error: '#PARSE!' });
  });

  it('parses zero-argument SUM as an empty call', () => {
    const { workbook, inputs } = formulaWorkbook();

    expect(parseFormula('=sUm()', workbook, inputs)).toEqual({
      kind: 'formula',
      raw: '=sUm()',
      expression: {
        kind: 'function',
        functionName: 'SUM',
        arguments: [],
        sourceSpan: { start: 1, end: 6 },
      },
    });
  });

  it('parses common numeric and aggregate functions case-insensitively', () => {
    const { workbook, inputs } = formulaWorkbook();

    expect(parseFormula('=aVeRaGe(A1:A3)', workbook, inputs)).toMatchObject({
      kind: 'formula',
      expression: {
        kind: 'function',
        functionName: 'AVERAGE',
        arguments: [{ kind: 'range' }],
      },
    });
    expect(parseFormula('=sqrt(ABS(B1))', workbook, inputs)).toMatchObject({
      kind: 'formula',
      expression: {
        kind: 'function',
        functionName: 'SQRT',
        arguments: [
          {
            kind: 'function',
            functionName: 'ABS',
          },
        ],
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
    appendSheet(workbook, sheet('123e4567-e89b-12d3-a456-426614174000', 'UUID inputs'));

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

  it('canonicalizes cross-sheet references used as arithmetic operands', () => {
    const { workbook } = formulaWorkbook();

    expect(formulaRawForStorage("=Inputs!A1+'Sales Q1'!B2*2", workbook)).toBe(
      '=sheet-1!A1+sheet-3!B2*2',
    );
    expect(formulaRawForStorage('=-Inputs!A1', workbook)).toBe('=-sheet-1!A1');
    expect(formulaRawForStorage('=A1-Inputs!A1', workbook)).toBe('=A1-sheet-1!A1');
    expect(formulaRawForStorage('=A1--Inputs!A1', workbook)).toBe('=A1--sheet-1!A1');
    expect(formulaRawForStorage('=Inputs!A1-Outputs!A1', workbook)).toBe(
      '=sheet-1!A1-sheet-2!A1',
    );
    expect(formulaRawForStorage("=Inputs!A1-Outputs!A1-'Sales Q1'!A1", workbook)).toBe(
      '=sheet-1!A1-sheet-2!A1-sheet-3!A1',
    );

    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    const secondUuid = '223e4567-e89b-12d3-a456-426614174001';
    appendSheet(workbook, sheet(uuid, 'UUID inputs'));
    appendSheet(workbook, sheet(secondUuid, 'UUID outputs'));
    expect(formulaRawForDisplay(`=-${uuid}!A1`, workbook)).toBe("=-'UUID inputs'!A1");
    expect(formulaRawForDisplay(`=${uuid}!A1-sheet-1!A1-sheet-2!A1`, workbook)).toBe(
      "='UUID inputs'!A1-Inputs!A1-Outputs!A1",
    );
    expect(formulaRawForDisplay(`=A1-${uuid}!A1`, workbook)).toBe("=A1-'UUID inputs'!A1");
    expect(formulaRawForDisplay(`=${uuid}!A1-${secondUuid}!A1`, workbook)).toBe(
      "='UUID inputs'!A1-'UUID outputs'!A1",
    );
  });

  it.each(['=', '<>', '<', '<=', '>', '>='] as const)(
    'canonicalizes and displays cross-sheet references adjacent to comparison operator %s',
    (operator) => {
      const { workbook } = formulaWorkbook();

      expect(formulaRawForStorage(`=Inputs!A1${operator}2`, workbook)).toBe(
        `=sheet-1!A1${operator}2`,
      );
      expect(formulaRawForStorage(`=2${operator}Inputs!A1`, workbook)).toBe(
        `=2${operator}sheet-1!A1`,
      );
      expect(formulaRawForDisplay(`=sheet-1!A1${operator}2`, workbook)).toBe(
        `=Inputs!A1${operator}2`,
      );
      expect(formulaRawForDisplay(`=2${operator}sheet-1!A1`, workbook)).toBe(
        `=2${operator}Inputs!A1`,
      );
    },
  );

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

  it('retains unsupported functions as general call nodes for evaluator dispatch', () => {
    const { workbook, inputs } = formulaWorkbook();

    expect(parseFormula('=MEDIAN(A1:A3)', workbook, inputs)).toMatchObject({
      kind: 'formula',
      expression: { kind: 'function', functionName: 'MEDIAN' },
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
    expect(parseFormula('=NOPE(K1)', workbook, inputs)).toMatchObject({ kind: 'formula' });
    expect(parseFormula('=SUM(NOPE())', workbook, inputs)).toMatchObject({ kind: 'formula' });
    for (const raw of ['=(NOPE())', '=((NOPE(A1)))']) {
      expect(parseFormula(raw, workbook, inputs)).toMatchObject({ kind: 'formula' });
    }
  });

  it('parses complete arithmetic syntax before evaluator name resolution', () => {
    const { workbook, inputs } = formulaWorkbook();

    for (const raw of ['=NOPE()+1', '=1+NOPE()']) {
      expect(parseFormula(raw, workbook, inputs)).toMatchObject({ kind: 'formula' });
    }
    expect(parseFormula('=NOPE()+', workbook, inputs)).toEqual({
      kind: 'error',
      raw: '=NOPE()+',
      error: '#PARSE!',
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

  it('preserves syntactic unresolved and out-of-bounds references for visit-time evaluation', () => {
    const { workbook, inputs } = formulaWorkbook();

    expect(parseFormula('=SUM(Missing!A1)', workbook, inputs)).toMatchObject({
      kind: 'formula',
      expression: {
        arguments: [{ kind: 'cell', sheetId: 'Missing' }],
      },
    });
    expect(parseFormula('=SUM(K1)', workbook, inputs)).toMatchObject({
      kind: 'formula',
      expression: {
        arguments: [{ kind: 'cell', address: { columnIndex: 10, rowIndex: 0 } }],
      },
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
    const workbook = workbookWithSheets([inputs, outputs]);
    const cell = '=SUM(sheet-1!A1)';

    expect(formulaRawForDisplay(cell, workbook)).toBe("=SUM('Renamed Inputs'!A1)");
  });

  it('renders unknown canonical ids as #REF qualifiers', () => {
    const workbook = workbookWithSheets([sheet('sheet-2', 'Outputs')]);

    expect(formulaRawForDisplay('=SUM(sheet-deleted!A1)', workbook)).toBe('=SUM(#REF!A1)');
  });
});
