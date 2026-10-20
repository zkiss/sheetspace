import { describe, expect, it } from 'vitest';
import {
  formulaSheetReferences,
  parseFormula,
  parseFormulaForInspection,
  parseFormulaSyntax,
  replaceFormulaQualifiers,
} from '@workbook/formula/syntax';
import { analyzeFormulaSyntax, type FormulaReferenceResolver } from '@workbook/formula/reference';

describe('formula syntax', () => {
  it('uses one function-call node for built-ins and unknown functions', () => {
    expect(parseFormula('=sUm(@A[1])')).toMatchObject({
      kind: 'formula',
      expression: { kind: 'function', functionName: 'SUM' },
    });
    expect(parseFormula('=average(@A[1])')).toMatchObject({
      kind: 'formula',
      expression: { kind: 'function', functionName: 'AVERAGE' },
    });
    expect(parseFormula('=unknown(@A[1])')).toMatchObject({
      kind: 'formula',
      expression: { kind: 'function', functionName: 'UNKNOWN' },
    });
    expect(parseFormulaForInspection('=unknown(@A[1])')).toMatchObject({
      kind: 'formula',
      expression: { kind: 'function', functionName: 'UNKNOWN' },
    });
  });

  it('preserves ordered reference and qualifier spans from raw syntax', () => {
    const raw = "=SUM(@A[1], @'Owner''s Plan' \n! B[2]:C[3], @saved-sheet!D[4], @#REF!E[5])";
    const parsed = parseFormulaSyntax(raw, { preserveUnknownFunctions: true });

    expect(parsed.references.map((reference) => ({
      raw: raw.slice(reference.sourceSpan.start, reference.sourceSpan.end),
      qualifier: reference.sheetReferenceSpan
        ? raw.slice(reference.sheetReferenceSpan.start, reference.sheetReferenceSpan.end)
        : undefined,
      sheetId: reference.sheetId,
    }))).toEqual([
      { raw: '@A[1]', qualifier: undefined, sheetId: undefined },
      { raw: "@'Owner''s Plan' \n! B[2]:C[3]", qualifier: "'Owner''s Plan'", sheetId: "Owner's Plan" },
      { raw: '@saved-sheet!D[4]', qualifier: 'saved-sheet', sheetId: 'saved-sheet' },
      { raw: '@#REF!E[5]', qualifier: '#REF', sheetId: '#REF' },
    ]);
  });

  it('retains valid prefix references when later syntax is malformed', () => {
    const raw = '=SUM(@source-sheet!A[1],)';
    const parsed = parseFormulaSyntax(raw);

    expect(parsed.result).toEqual({ kind: 'error', raw, error: '#PARSE!' });
    expect(formulaSheetReferences(raw)).toEqual(['source-sheet']);
    expect(replaceFormulaQualifiers(raw, (qualifier) =>
      qualifier === 'source-sheet' ? 'archived-sheet' : qualifier,
    )).toBe('=SUM(@archived-sheet!A[1],)');
  });

  it('returns lossless presentation tokens and diagnostics while recovering references', () => {
    const raw = '=SUM(@A[1], "text") + FALSE';
    const analysis = parseFormulaSyntax(raw);

    expect(analysis.tokens.map((token) => raw.slice(token.sourceSpan.start, token.sourceSpan.end)).join('')).toBe(raw);
    expect(analysis.tokens.map((token) => token.kind)).toContain('function');
    expect(analysis.tokens.map((token) => token.kind)).toContain('reference');
    expect(analysis.tokens.map((token) => token.kind)).toContain('literal');
    expect(analysis.tokens.map((token) => token.kind)).toContain('operator');

    const incomplete = parseFormulaSyntax("=SUM(@A[1], @'Revenue'[)");
    expect(incomplete.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'syntax', code: '#PARSE!' }),
    ]));
    expect(incomplete.references.map((reference) => raw.slice(reference.sourceSpan.start, reference.sourceSpan.end))).not.toContain("@'Revenue'[");
    expect(incomplete.references.map((reference) => incomplete.result.raw.slice(reference.sourceSpan.start, reference.sourceSpan.end))).toContain('@A[1]');
    expect(incomplete.tokens.map((token) => incomplete.result.raw.slice(token.sourceSpan.start, token.sourceSpan.end)).join('')).toBe(incomplete.result.raw);
  });

  it('reports one ordered, non-empty diagnostic for each malformed reference fragment during recovery', () => {
    const raw = '=SUM(@A[1],) + @broken + @B[2]';
    const analysis = parseFormulaSyntax(raw);

    expect(analysis.diagnostics).toEqual([
      { kind: 'syntax', code: '#PARSE!', sourceSpan: { start: raw.indexOf(')'), end: raw.indexOf(')') + 1 } },
      { kind: 'syntax', code: '#PARSE!', sourceSpan: { start: raw.indexOf('@broken'), end: raw.indexOf('@broken') + 1 } },
    ]);
    expect(analysis.references.map((reference) => raw.slice(reference.sourceSpan.start, reference.sourceSpan.end)))
      .toEqual(['@A[1]', '@B[2]']);
    expect(parseFormulaSyntax('=SUM(@A[1], @B[2])').diagnostics).toEqual([]);
  });

  it('keeps trailing and semantic diagnostics bounded and source ordered across the analysis corpus', () => {
    const resolver: FormulaReferenceResolver = {
      currentSheetId: 'sheet',
      sheetByQualifier: (qualifier) => qualifier === 'missing' ? undefined : 'sheet',
      coordinateAt: (_sheetId, address) => address.columnIndex === 10 ? undefined : { columnId: `column-${address.columnIndex}`, rowId: `row-${address.rowIndex}` },
      addressOf: () => undefined,
    };
    const cases = [
      { raw: '=@A[1] trailing', fragments: ['t'] },
      { raw: '=@K[1] + )', fragments: ['@K[1]', ')'] },
      { raw: '=SUM(@A[1],)', fragments: [')'] },
      { raw: '=SUM(@A[1],) + @broken + @B[2]', fragments: [')', '@'] },
      { raw: '=@missing!A[1]', fragments: ['@missing!A[1]'] },
      { raw: '=@A[1]:B[2]', fragments: [] },
      { raw: '="@K[1]"', fragments: [] },
      { raw: "=@'Revenue'[1] + @A[1]", fragments: ['@\'Revenue\'[1]'] },
    ];

    for (const { raw, fragments } of cases) {
      const diagnostics = analyzeFormulaSyntax(raw, resolver).diagnostics;
      expect(diagnostics.map((diagnostic) => raw.slice(diagnostic.sourceSpan.start, diagnostic.sourceSpan.end)))
        .toEqual(fragments);
      for (const diagnostic of diagnostics) {
        expect(diagnostic.sourceSpan.start).toBeGreaterThanOrEqual(0);
        expect(diagnostic.sourceSpan.end).toBeGreaterThan(diagnostic.sourceSpan.start);
        expect(diagnostic.sourceSpan.end).toBeLessThanOrEqual(raw.length);
      }
      expect(diagnostics.map(({ sourceSpan }) => `${sourceSpan.start}:${sourceSpan.end}`))
        .toEqual([...new Set(diagnostics.map(({ sourceSpan }) => `${sourceSpan.start}:${sourceSpan.end}`))]);
      expect(diagnostics).toEqual([...diagnostics].sort((left, right) =>
        left.sourceSpan.start - right.sourceSpan.start || left.sourceSpan.end - right.sourceSpan.end));
    }
  });

  it('recovers qualifiers after an earlier syntax error for inspection and remapping', () => {
    const raw = '=SUM(@A[1],) + @source-sheet!B[2] + @saved-sheet!C[3] + @#REF!D[4]';
    const parsed = parseFormulaSyntax(raw);

    expect(parsed.result).toEqual({ kind: 'error', raw, error: '#PARSE!' });
    expect(formulaSheetReferences(raw)).toEqual(['source-sheet', 'saved-sheet', '#REF']);
    expect(parsed.references.map((reference) =>
      raw.slice(reference.sourceSpan.start, reference.sourceSpan.end),
    )).toEqual(['@A[1]', '@source-sheet!B[2]', '@saved-sheet!C[3]', '@#REF!D[4]']);
    expect(replaceFormulaQualifiers(raw, (qualifier) =>
      qualifier === 'source-sheet' ? 'archived-sheet' : qualifier,
    )).toBe('=SUM(@A[1],) + @archived-sheet!B[2] + @saved-sheet!C[3] + @#REF!D[4]');
  });

  it('does not reinterpret a malformed range/reference mixture as a colon qualifier', () => {
    expect(parseFormula('=@A[1]:B[2]!@C[3]')).toEqual({
      kind: 'error',
      raw: '=@A[1]:B[2]!@C[3]',
      error: '#PARSE!',
    });
    expect(formulaSheetReferences('=@A[1]:B[2]!@C[3]')).toEqual([]);
  });

  it('never treats reference-like text literals or broken quotes as tokens', () => {
    expect(formulaSheetReferences('="@sheet-id!A[1]"')).toEqual([]);
    expect(formulaSheetReferences("=SUM(@'broken!A[1], @sheet-id! nope)")).toEqual([]);
  });

  it('replaces qualifiers only, preserving casing, whitespace, and line breaks', () => {
    const raw = "=sUm( @Inputs \n ! A[1], @'Sales Q1'!B[2]:C[3] )";
    expect(replaceFormulaQualifiers(raw, (qualifier) => ({
      Inputs: 'sheet-inputs',
      'Sales Q1': 'sheet-sales',
    })[qualifier] ?? qualifier)).toBe(
      '=sUm( @sheet-inputs \n ! A[1], @sheet-sales!B[2]:C[3] )',
    );
  });
});
