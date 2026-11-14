import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import type { CustomFunction } from '../core/model';
import { analyzeFunctionBody } from './functionBodyAnalysis';
import { collectFormulaReferences, parseFormula } from './syntax';

const first = sheetDocument({ id: 'first', name: 'First', rowCount: 2, columnCount: 2 });
const second = sheetDocument({ id: 'second', name: 'Second', rowCount: 2, columnCount: 2 });
const workbook = workbookWithSheets([first, second]);
const definition = (body: string, names: string[] = ['a', 'b']): CustomFunction => ({ name: 'f', body, parameters: names.map((name) => ({ name, type: 'int' })) });

describe('function body syntax', () => {
  it('parses parameters lexically with precedence, calls, strings and exact spans', () => {
    const body = '=SUM(a, b*2, "a", a(3))';
    const analysis = analyzeFunctionBody(definition(body), workbook, first.id);
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.syntax.tokens.map((token) => body.slice(token.sourceSpan.start, token.sourceSpan.end)).join('')).toBe(body);
    expect(analysis.syntax.result).toMatchObject({ kind: 'formula', expression: { kind: 'function', arguments: [
      { kind: 'parameter', name: 'A', sourceSpan: { start: 5, end: 6 } },
      { kind: 'binary', operator: '*', left: { kind: 'parameter', name: 'B' } },
      { kind: 'text', value: 'a' }, { kind: 'function', functionName: 'A' },
    ] } });
    if (analysis.syntax.result.kind === 'formula') expect(collectFormulaReferences(analysis.syntax.result.expression)).toEqual([]);
    expect(parseFormula('=a').kind).toBe('error');
  });

  it('accepts zero or many parameters and reports unrelated names and malformed text', () => {
    expect(analyzeFunctionBody(definition('=later()', []), workbook, first.id).diagnostics).toEqual([]);
    expect(analyzeFunctionBody(definition('=p99', Array.from({ length: 100 }, (_, i) => `p${i}`)), workbook, first.id).diagnostics).toEqual([]);
    for (const body of ['=aa+1', '=SUM(a,', 'plain']) {
      expect(analyzeFunctionBody(definition(body), workbook, first.id).diagnostics[0].code).toBe('#PARSE!');
    }
  });

  it('binds caller and explicitly named sheets without trusting internal identity spelling', () => {
    const body = '=a+@A[1]+@Second!B[2]';
    const one = analyzeFunctionBody(definition(body), workbook, first.id);
    const two = analyzeFunctionBody(definition(body), workbook, second.id);
    expect(one.diagnostics).toEqual([]);
    expect(one.bound?.references.map((entry) => entry.reference?.coordinate)).toEqual([
      { columnId: first.content.columns[0], rowId: first.content.rows[0] },
      { columnId: second.content.columns[1], rowId: second.content.rows[1] },
    ]);
    expect(two.bound?.references[0].reference?.coordinate.rowId).toBe(second.content.rows[0]);
    const invalid = analyzeFunctionBody(definition(`=@${first.content.columns[0]}[${first.content.rows[0]}]`), workbook, first.id);
    expect(invalid.bound?.references).toEqual([]);
    expect(invalid.diagnostics.length).toBeGreaterThan(0);
    expect(analyzeFunctionBody(definition('=@Missing!A[1]'), workbook, first.id).diagnostics[0].code).toBe('#REF!');
  });
});
