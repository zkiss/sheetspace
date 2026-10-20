// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildFormulaDependencyGraph } from '@calculation/formulaDependencies';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { formulaRawToCanonical, formulaRawToDisplay, formulaReferenceTokens, workbookFormulaReferenceResolver } from '@workbook/formula/reference';
import { parseFormulaSyntax } from '@workbook/formula/syntax';
import { commitCellRawContent } from '@workbook/mutations/operations';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { inspectFormula } from './formulaInspection';

describe('quoted draft recovery boundaries', () => {
  it.each([
    "=@$'unfinished @A[1]",
    "=) + @$'unfinished @A[1]",
    "=@'R'[1]:$'unfinished @B[2]",
    "=) + @'R'[1]:$'unfinished @B[2]",
    "=@'R'[1]:'unfinished @B[2]",
    "=) + @'R'[1]:'unfinished @B[2]",
    "=@A[1]:$'unfinished @B[2]",
    "=) + @A[1]:$'unfinished @B[2]",
    "=@Budget!$'unfinished @A[1]",
    "=) + @Budget!$'unfinished @A[1]",
    "=@$'Owner''s unfinished @A[1]",
    "=@'unfinished @A[1]",
  ])('preserves %s without manufacturing consumer references', (raw) => {
    const sheet = sheetDocument({ id: 'budget', name: 'Budget' });
    const workbook = workbookWithSheets([sheet]);
    const resolver = workbookFormulaReferenceResolver(workbook, sheet.id);

    const syntax = parseFormulaSyntax(raw);
    expect(syntax.references).toEqual([]);
    expect(syntax.referenceLexemes).toEqual([]);
    expect(formulaReferenceTokens(raw)).toEqual([]);
    expect(formulaRawToCanonical(raw, resolver)).toBe(raw);
    expect(formulaRawToDisplay(raw, resolver)).toBe(raw);
    expect(inspectFormula(raw, workbook, sheet)).toBeUndefined();
    expect(syntax.tokens.map(({ sourceSpan }) => raw.slice(sourceSpan.start, sourceSpan.end)).join('')).toBe(raw);

    const stored = commitCellRawContent(workbook, sheet.id, 'C1', raw);
    const graph = buildFormulaDependencyGraph(calculationProjection(stored));
    expect([...graph.dependencies.values()]).toEqual([new Set()]);
    expect(graph.dependents.size).toBe(0);
  });

  it.each([
    "=) + @$'closed @A[1]' + @B[2]",
    "=) + @'R'[1]:$'closed @A[1]' + @B[2]",
    "=@$'closed @A[1]' + @B[2]",
    "=@'R'[1]:$'closed @A[1]' + @B[2]",
    "=) + @$'Owner''s @A[1]' + @B[2]",
    "=) + @'' + @B[2]",
  ])('recovers real references after a closed quoted fragment in %s', (raw) => {
    const syntax = parseFormulaSyntax(raw);
    expect(syntax.references.map(({ sourceSpan }) => raw.slice(sourceSpan.start, sourceSpan.end)))
      .toEqual(['@B[2]']);
  });

  it('keeps original parse error locations independent of the recovery cursor', () => {
    const raw = "=@$'unfinished @A[1]";
    expect(parseFormulaSyntax(raw).diagnostics).toEqual([
      { kind: 'syntax', code: '#PARSE!', sourceSpan: { start: 2, end: 3 } },
    ]);
    const range = "=@'R'[1]:$'unfinished @B[2]";
    expect(parseFormulaSyntax(range).diagnostics).toEqual([
      { kind: 'syntax', code: '#PARSE!', sourceSpan: { start: 9, end: 10 } },
    ]);
  });

  it('retains genuine completed prefix targets before an unfinished quoted name', () => {
    const sheet = sheetDocument({ id: 'budget', name: 'Budget' });
    const workbook = workbookWithSheets([sheet]);
    const resolver = workbookFormulaReferenceResolver(workbook, sheet.id);
    const raw = "=@A[1] + @$'unfinished @B[2]";

    expect(parseFormulaSyntax(raw).references.map(({ sourceSpan }) => raw.slice(sourceSpan.start, sourceSpan.end)))
      .toEqual(['@A[1]']);
    expect(formulaRawToCanonical(raw, resolver)).toBe("=@budget:column:1[budget:row:1] + @$'unfinished @B[2]");
    expect(inspectFormula(raw, workbook, sheet)?.references.map(({ text }) => text)).toEqual(['@A[1]']);
  });
});
