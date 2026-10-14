import { describe, expect, it } from 'vitest';
import {
  formulaSheetReferences,
  parseFormula,
  parseFormulaForInspection,
  parseFormulaSyntax,
  replaceFormulaQualifiers,
} from '@workbook/formula/syntax';

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
