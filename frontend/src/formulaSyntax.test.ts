import { describe, expect, it } from 'vitest';
import {
  formulaSheetReferences,
  parseFormula,
  parseFormulaForInspection,
  parseFormulaSyntax,
  replaceFormulaQualifiers,
} from './formulaSyntax';

describe('formula syntax', () => {
  it('uses one function-call node for built-ins and unknown functions', () => {
    expect(parseFormula('=sUm(A1)')).toMatchObject({
      kind: 'formula',
      expression: { kind: 'function', functionName: 'SUM' },
    });
    expect(parseFormula('=average(A1)')).toMatchObject({
      kind: 'formula',
      expression: { kind: 'function', functionName: 'AVERAGE' },
    });
    expect(parseFormula('=unknown(A1)')).toEqual({
      kind: 'error',
      raw: '=unknown(A1)',
      error: '#NAME!',
    });
    expect(parseFormulaForInspection('=unknown(A1)')).toMatchObject({
      kind: 'formula',
      expression: { kind: 'function', functionName: 'UNKNOWN' },
    });
  });

  it('preserves ordered reference and qualifier spans from raw syntax', () => {
    const raw = "=SUM(A1, 'Owner''s Plan' \n! B2:C3, pending:abc-123!D4, #REF!E5)";
    const parsed = parseFormulaSyntax(raw, { preserveUnknownFunctions: true });

    expect(parsed.references.map((reference) => ({
      raw: raw.slice(reference.sourceSpan.start, reference.sourceSpan.end),
      qualifier: reference.sheetReferenceSpan
        ? raw.slice(reference.sheetReferenceSpan.start, reference.sheetReferenceSpan.end)
        : undefined,
      sheetId: reference.sheetId,
    }))).toEqual([
      { raw: 'A1', qualifier: undefined, sheetId: undefined },
      { raw: "'Owner''s Plan' \n! B2:C3", qualifier: "'Owner''s Plan'", sheetId: "Owner's Plan" },
      { raw: 'pending:abc-123!D4', qualifier: 'pending:abc-123', sheetId: 'pending:abc-123' },
      { raw: '#REF!E5', qualifier: '#REF', sheetId: '#REF' },
    ]);
  });

  it('retains valid prefix references when later syntax is malformed', () => {
    const raw = '=SUM(pending:local!A1,)';
    const parsed = parseFormulaSyntax(raw);

    expect(parsed.result).toEqual({ kind: 'error', raw, error: '#PARSE!' });
    expect(formulaSheetReferences(raw)).toEqual(['pending:local']);
    expect(replaceFormulaQualifiers(raw, (qualifier) =>
      qualifier === 'pending:local' ? 'saved-sheet' : qualifier,
    )).toBe('=SUM(saved-sheet!A1,)');
  });

  it('recovers qualifiers after an earlier syntax error for inspection and remapping', () => {
    const raw = '=SUM(A1,) + pending:local!B2 + saved-sheet!C3 + #REF!D4';
    const parsed = parseFormulaSyntax(raw);

    expect(parsed.result).toEqual({ kind: 'error', raw, error: '#PARSE!' });
    expect(formulaSheetReferences(raw)).toEqual(['pending:local', 'saved-sheet', '#REF']);
    expect(parsed.references.map((reference) =>
      raw.slice(reference.sourceSpan.start, reference.sourceSpan.end),
    )).toEqual(['A1', 'pending:local!B2', 'saved-sheet!C3', '#REF!D4']);
    expect(replaceFormulaQualifiers(raw, (qualifier) =>
      qualifier === 'pending:local' ? 'saved-pending' : qualifier,
    )).toBe('=SUM(A1,) + saved-pending!B2 + saved-sheet!C3 + #REF!D4');
  });

  it('does not reinterpret a malformed range/reference mixture as a colon qualifier', () => {
    expect(parseFormula('=A1:B2!C3')).toEqual({
      kind: 'error',
      raw: '=A1:B2!C3',
      error: '#PARSE!',
    });
    expect(formulaSheetReferences('=A1:B2!C3')).toEqual([]);
  });

  it('never treats reference-like text literals or broken quotes as tokens', () => {
    expect(formulaSheetReferences('="sheet-id!A1"')).toEqual([]);
    expect(formulaSheetReferences("=SUM('broken!A1, sheet-id! nope)")).toEqual([]);
  });

  it('replaces qualifiers only, preserving casing, whitespace, and line breaks', () => {
    const raw = "=sUm( Inputs \n ! A1, 'Sales Q1'!B2:C3 )";
    expect(replaceFormulaQualifiers(raw, (qualifier) => ({
      Inputs: 'sheet-inputs',
      'Sales Q1': 'sheet-sales',
    })[qualifier] ?? qualifier)).toBe(
      '=sUm( sheet-inputs \n ! A1, sheet-sales!B2:C3 )',
    );
  });
});
