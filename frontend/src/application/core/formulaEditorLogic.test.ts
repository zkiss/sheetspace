import { describe, expect, it } from 'vitest';
import { builtInFormulaFunctions } from '@calculation/formulaBuiltins';
import { formulaRawToCanonical, workbookFormulaReferenceResolver } from '@workbook/formula/reference';
import { parseFormula, parseFormulaSyntax } from '@workbook/formula/syntax';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import {
  analyzeFormulaEditor,
  applyFormulaCompletion,
  formatFormula,
  formulaCompletions,
  formulaReferenceHover,
  indentFormulaSelection,
  outdentFormulaSelection,
  stableReferenceIdentity,
} from './formulaEditorLogic';

const inputs = sheetDocument({ id: 'inputs', name: "Owner's Plan", cells: { A1: '2', B1: '=1 / 0' } });
const budget = {
  ...sheetDocument({ id: 'budget', name: 'Budget', cells: { A1: '3', B1: '4' } }),
  modelId: 'model',
  modelColumnBindings: { revenue: 'budget:column:1', cost: 'budget:column:2' },
};
const workbook = {
  ...workbookWithSheets([inputs, budget]),
  dataModels: {
    model: {
      id: 'model', name: 'Budget model', columns: [
        { id: 'revenue', name: 'Revenue', kind: 'manual' as const, type: 'float' as const },
        { id: 'cost', name: 'Cost', kind: 'manual' as const, type: 'float' as const },
      ],
    },
  },
};
const resolver = workbookFormulaReferenceResolver(workbook, budget.id);

describe('formula editor logic', () => {
  it('uses the shared parser and resolver for recovery diagnostics and stable identities', () => {
    const result = analyzeFormulaEditor("=SUM(@'Missing'[1],) + @'Revenue'[1]", resolver);

    expect(result.diagnostics.map((diagnostic) => diagnostic.kind)).toEqual(['reference', 'syntax']);
    expect(result.references).toHaveLength(2);
    expect(result.referenceIdentities[0]).toBeUndefined();
    expect(result.referenceIdentities[1]).toEqual({
      kind: 'cell', sheetId: 'budget', rowId: budget.content.rows[0], columnId: budget.content.columns[0],
    });
  });

  it('completes only registered functions and replaces the cursor word without harming suffix text', () => {
    const suggestions = formulaCompletions('=SU + @A[1]', { start: 3, end: 3 }, { sheetNames: [] });
    const sum = suggestions.find((suggestion) => suggestion.label === 'SUM');

    expect(sum).toBeDefined();
    expect(suggestions.map((suggestion) => suggestion.label)).not.toContain('UNKNOWN');
    expect(applyFormulaCompletion('=SU + @A[1]', sum!)).toBe('=SUM + @A[1]');
    expect(builtInFormulaFunctions.has(sum!.insertText)).toBe(true);
  });

  it('completes quoted sheets and model properties with escaped names', () => {
    const sheets = formulaCompletions('=@Ow', { start: 4, end: 4 }, { sheetNames: ["Owner's Plan"], propertyNames: ['Revenue'] });
    const properties = formulaCompletions("=@'Re + 1", { start: 5, end: 5 }, { sheetNames: [], propertyNames: ["Revenue's Net"] });

    expect(sheets).toContainEqual(expect.objectContaining({ kind: 'sheet', insertText: "'Owner''s Plan'!" }));
    expect(properties).toContainEqual(expect.objectContaining({ kind: 'property', insertText: "'Revenue''s Net'[1]" }));
  });

  it('does not complete inside string literals and honors an explicit replacement selection', () => {
    expect(formulaCompletions('="SUM"', { start: 4, end: 4 }, { sheetNames: [] })).toEqual([]);
    const completion = formulaCompletions('=SMM(@A[1])', { start: 1, end: 4 }, { sheetNames: [] })
      .find((suggestion) => suggestion.label === 'SUM');

    expect(applyFormulaCompletion('=SMM(@A[1])', completion!)).toBe('=SUM(@A[1])');
  });

  it('formats valid formulas by changing only whitespace and preserves literal and reference lexemes', () => {
    const raw = '=SUM( @$A[$1] , ABS("a, b") )+ @\'Revenue\'[1]';
    const formatted = formatFormula(raw, { start: 0, end: raw.length });

    expect(formatted.available).toBe(true);
    expect(formatted.raw).toContain('"a, b"');
    expect(formatted.raw).toContain('@$A[$1]');
    expect(formatted.raw).toContain("@'Revenue'[1]");
    expect(parseFormula(formatted.raw)).toMatchObject({ kind: 'formula' });
    expect(parseFormulaSyntax(formatted.raw).tokens.filter((token) => token.kind !== 'whitespace').map((token) => formatted.raw.slice(token.sourceSpan.start, token.sourceSpan.end)))
      .toEqual(parseFormulaSyntax(raw).tokens.filter((token) => token.kind !== 'whitespace').map((token) => raw.slice(token.sourceSpan.start, token.sourceSpan.end)));
  });

  it('preserves trailing raw whitespace while formatting a gap between formula tokens', () => {
    const raw = '= SUM(@A[1])   ';
    const formatted = formatFormula(raw, { start: raw.length, end: raw.length });

    expect(formatted).toEqual({ available: true, raw: '=SUM(\n  @A[1]\n)   ', selection: { start: raw.length + 3, end: raw.length + 3 } });
  });

  it('leaves unfinished formulas untouched when formatting is unavailable', () => {
    const raw = '=SUM(@A[1],';
    expect(formatFormula(raw, { start: 2, end: 2 })).toEqual({ available: false, raw, selection: { start: 2, end: 2 } });
  });

  it('indents and outdents every selected line while updating the selection', () => {
    const raw = '=SUM(\n@A[1],\n@B[1]\n)';
    const selection = { start: raw.indexOf('@A'), end: raw.indexOf('@B') + 5 };
    const indented = indentFormulaSelection(raw, selection);
    const outdented = outdentFormulaSelection(indented.raw, indented.selection);

    expect(indented.raw).toBe('=SUM(\n  @A[1],\n  @B[1]\n)');
    expect(outdented.raw).toBe(raw);
    expect(outdented.selection).toEqual(selection);
  });

  it('keeps identity equal across raw and canonical spelling and bounds range hover values', () => {
    const rawReference = analyzeFormulaEditor("=@'Revenue'[1]: 'Cost'[1]", resolver).references[0]!;
    const canonicalRaw = formulaRawToCanonical("=@'Revenue'[1]: 'Cost'[1]", resolver);
    const canonicalReference = analyzeFormulaEditor(canonicalRaw, resolver).references[0]!;
    const identity = stableReferenceIdentity(rawReference, resolver)!;

    expect(stableReferenceIdentity(canonicalReference, resolver)).toEqual(identity);
    expect(formulaReferenceHover(rawReference, resolver, () => [
      { kind: 'number', value: 1 }, { kind: 'error', error: '#DIV/0!' }, { kind: 'number', value: 3 },
    ], { maximumRangeValues: 2 })).toEqual(expect.objectContaining({ kind: 'range', identity, truncated: true, values: [
      { kind: 'number', value: 1 }, { kind: 'error', error: '#DIV/0!' },
    ] }));
  });

  it('reports scalar errors, broken targets, and model-only unqualified references without inventing values', () => {
    const valid = analyzeFormulaEditor('=@A[1]', resolver).references[0]!;
    const broken = analyzeFormulaEditor('=@Z[99]', resolver).references[0]!;

    expect(formulaReferenceHover(valid, resolver, () => ({ kind: 'error', error: '#DIV/0!' }))).toMatchObject({ kind: 'value', value: { kind: 'error', error: '#DIV/0!' } });
    expect(formulaReferenceHover(broken, resolver, () => undefined)).toEqual({ kind: 'broken' });
    expect(formulaReferenceHover(valid, resolver, () => ({ kind: 'number', value: 1 }), { modelOnly: true })).toMatchObject({ kind: 'model-context' });
  });
});
