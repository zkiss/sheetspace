import { describe, expect, it } from 'vitest';
import { formulaRawForDisplay, formulaRawForStorage, formulaSheetReferenceIds } from '@workbook/formula/reference';
import { type SheetDocument, type Workbook } from '@workbook/core/model';
import { parseFormula as parseFormulaSyntax } from '@workbook/formula/syntax';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

function parseFormula(raw: string, _workbook?: unknown, _sheet?: unknown) {
  void _workbook;
  void _sheet;
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

  it('canonicalizes cross-sheet references used as arithmetic operands', () => {
    const { workbook } = formulaWorkbook();

    expect(formulaRawForStorage("=@Inputs!A[1]+@'Sales Q1'!B[2]*2", workbook)).toBe(
      "=@sheet-1!A[1]+@sheet-3!B[2]*2",
    );
    expect(formulaRawForStorage('=-@Inputs!A[1]', workbook)).toBe("=-@sheet-1!A[1]");
    expect(formulaRawForStorage('=@A[1]-@Inputs!A[1]', workbook)).toBe("=@A[1]-@sheet-1!A[1]");
    expect(formulaRawForStorage('=@A[1]--@Inputs!A[1]', workbook)).toBe("=@A[1]--@sheet-1!A[1]");
    expect(formulaRawForStorage('=@Inputs!A[1]-@Outputs!A[1]', workbook)).toBe(
      "=@sheet-1!A[1]-@sheet-2!A[1]",
    );
    expect(formulaRawForStorage("=@Inputs!A[1]-@Outputs!A[1]-@'Sales Q1'!A[1]", workbook)).toBe(
      "=@sheet-1!A[1]-@sheet-2!A[1]-@sheet-3!A[1]",
    );

    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    const secondUuid = '223e4567-e89b-12d3-a456-426614174001';
    appendSheet(workbook, sheet(uuid, 'UUID inputs'));
    appendSheet(workbook, sheet(secondUuid, 'UUID outputs'));
    expect(formulaRawForDisplay(`=-@${uuid}!A[1]`, workbook)).toBe("=-@'UUID inputs'!A[1]");
    expect(formulaRawForDisplay(`=@${uuid}!A[1]-@sheet-1!A[1]-@sheet-2!A[1]`, workbook)).toBe(
      "=@'UUID inputs'!A[1]-@Inputs!A[1]-@Outputs!A[1]",
    );
    expect(formulaRawForDisplay(`=@A[1]-@${uuid}!A[1]`, workbook)).toBe("=@A[1]-@'UUID inputs'!A[1]");
    expect(formulaRawForDisplay(`=@${uuid}!A[1]-@${secondUuid}!A[1]`, workbook)).toBe(
      "=@'UUID inputs'!A[1]-@'UUID outputs'!A[1]",
    );
  });

  it.each(['=', '<>', '<', '<=', '>', '>='] as const)(
    'canonicalizes and displays cross-sheet references adjacent to comparison operator %s',
    (operator) => {
      const { workbook } = formulaWorkbook();

      expect(formulaRawForStorage(`=@Inputs!A[1]${operator}2`, workbook)).toBe(
        `=@sheet-1!A[1]${operator}2`,
      );
      expect(formulaRawForStorage(`=2${operator}@Inputs!A[1]`, workbook)).toBe(
        `=2${operator}@sheet-1!A[1]`,
      );
      expect(formulaRawForDisplay(`=@sheet-1!A[1]${operator}2`, workbook)).toBe(
        `=@Inputs!A[1]${operator}2`,
      );
      expect(formulaRawForDisplay(`=2${operator}@sheet-1!A[1]`, workbook)).toBe(
        `=2${operator}@Inputs!A[1]`,
      );
    },
  );

  it('does not canonicalize sheet-like references inside text literals', () => {
    const { workbook } = formulaWorkbook();
    const raw = '=SUM("Inputs!A1 and ""Sales Q1!B2""", @Inputs!A[1])';

    expect(formulaRawForStorage(raw, workbook)).toBe(
      "=SUM(\"Inputs!A1 and \"\"Sales Q1!B2\"\"\", @sheet-1!A[1])",
    );
    expect(formulaRawForDisplay('="sheet-1!A1"', workbook)).toBe('="sheet-1!A1"');
  });

  it('keeps canonical ids in parsed formula references', () => {
    const { workbook, inputs } = formulaWorkbook();
    const raw = '=SUM(@sheet-1!A[1], @sheet-3!A[1]:B[2])';

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

    expect(parseFormula('=MEDIAN(@A[1]:A[3])', workbook, inputs)).toMatchObject({
      kind: 'formula',
      expression: { kind: 'function', functionName: 'MEDIAN' },
    });
  });

  it('reports malformed unknown function calls as #PARSE! before name resolution', () => {
    const { workbook, inputs } = formulaWorkbook();

    for (const raw of ['=AVERAGE((@A[1])', '=NOPE("unterminated)', '=NOPE(@Missing!A[1]']) {
      expect(parseFormula(raw, workbook, inputs)).toEqual({
        kind: 'error',
        raw,
        error: '#PARSE!',
      });
    }
    expect(parseFormula('=NOPE(@K[1])', workbook, inputs)).toMatchObject({ kind: 'formula' });
    expect(parseFormula('=SUM(NOPE())', workbook, inputs)).toMatchObject({ kind: 'formula' });
    for (const raw of ['=(NOPE())', '=((NOPE(@A[1])))']) {
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

    expect(parseFormula('=SUM(@A[1],)', workbook, inputs)).toEqual({
      kind: 'error',
      raw: '=SUM(@A[1],)',
      error: '#PARSE!',
    });
    expect(parseFormula('=SUM(@A[ 1])', workbook, inputs)).toEqual({
      kind: 'error',
      raw: '=SUM(@A[ 1])',
      error: '#PARSE!',
    });
  });

  it('preserves syntactic unresolved and out-of-bounds references for visit-time evaluation', () => {
    const { workbook, inputs } = formulaWorkbook();

    expect(parseFormula('=SUM(@Missing!A[1])', workbook, inputs)).toMatchObject({
      kind: 'formula',
      expression: {
        arguments: [{ kind: 'cell', sheetId: 'Missing' }],
      },
    });
    expect(parseFormula('=SUM(@K[1])', workbook, inputs)).toMatchObject({
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
    expect(parseFormula('=SUM(@A[0])', workbook, inputs)).toEqual({
      kind: 'error',
      raw: '=SUM(@A[0])',
      error: '#PARSE!',
    });
  });

  it('extracts canonical ids without treating malformed formulas as references', () => {
    expect(formulaSheetReferenceIds('=SUM(@sheet-1!A[1], @sheet-3!A[1]:B[2])')).toEqual(['sheet-1', 'sheet-3']);
    expect(formulaSheetReferenceIds("=SUM('broken!A1, text sheet-2! nope)")).toEqual([]);
  });

  it('renders formula edit text from current sheet names without changing stored ids', () => {
    const inputs = sheet('sheet-1', 'Renamed Inputs');
    const outputs = sheet('sheet-2', 'Outputs');
    const workbook = workbookWithSheets([inputs, outputs]);
    const cell = '=SUM(@sheet-1!A[1])';

    expect(formulaRawForDisplay(cell, workbook)).toBe("=SUM(@'Renamed Inputs'!A[1])");
  });

  it('resolves canonical coordinates before rendering an explicit sheet name', () => {
    const inputs = sheet('sheet-1', 'Renamed Inputs');
    const outputs = sheet('sheet-2', 'Outputs');
    const workbook = workbookWithSheets([inputs, outputs]);
    const cell = '=SUM(@sheet-1!sheet-1:column:2[sheet-1:row:1]:sheet-1:column:2[sheet-1:row:2])';

    expect(formulaRawForDisplay(cell, workbook, outputs.id)).toBe("=SUM(@'Renamed Inputs'!B[1]:B[2])");
  });

  it('renders unknown canonical ids as #REF qualifiers', () => {
    const workbook = workbookWithSheets([sheet('sheet-2', 'Outputs')]);

    expect(formulaRawForDisplay('=SUM(@sheet-deleted!A[1])', workbook)).toBe('=SUM(@#REF!A[1])');
  });
});
