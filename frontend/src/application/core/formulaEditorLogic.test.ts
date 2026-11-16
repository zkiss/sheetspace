import { referenceIdentityColor } from '@workbook/core/referenceIdentity';
import { describe, expect, it, vi } from 'vitest';
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
  it('highlights and hovers positional references while diagnosing missing positions', () => {
    const raw = '=SUM(@Budget!Revenue[#$1]:Cost[#2])+@Budget!Revenue[#999]';
    const analysis = analyzeFormulaEditor(raw, resolver);
    expect(analysis.referenceIdentities[0]).toMatchObject({ kind: 'range', sheetId: budget.id });
    expect(analysis.referenceIdentities[1]).toBeUndefined();
    expect(analysis.diagnostics).toEqual([expect.objectContaining({ kind: 'reference' })]);
    expect(formulaReferenceHover(analysis.references[0]!, resolver, () => [{ kind: 'number', value: 3 }])).toMatchObject({ kind: 'range', values: [{ value: 3 }] });
  });
  it('highlights and hovers the full open named range through the current last row', () => {
    const raw = '=SUM(@Budget!Revenue[1]:Cost)';
    const analysis = analyzeFormulaEditor(raw, resolver);
    const reference = analysis.references[0]!;
    expect(analysis.tokens.filter((token) => token.kind === 'reference').map((token) => raw.slice(token.sourceSpan.start, token.sourceSpan.end))).toEqual(['@Budget!Revenue[1]:Cost']);
    const identity = stableReferenceIdentity(reference, resolver);
    expect(identity).toEqual({ kind: 'range', sheetId: budget.id,
      start: { rowId: budget.content.rows[0], columnId: budget.content.columns[0] },
      end: { rowId: budget.content.rows.slice(-1)[0], columnId: budget.content.columns[1] } });
    const values = [{ kind: 'number' as const, value: 1 }, { kind: 'number' as const, value: 2 }];
    expect(formulaReferenceHover(reference, resolver, () => values)).toMatchObject({ kind: 'range', identity, values });
    const extended = { ...budget, content: { ...budget.content, rows: [...budget.content.rows, 'zz-new-row'] } };
    const extendedResolver = workbookFormulaReferenceResolver({ ...workbook, documents: { ...workbook.documents, [budget.id]: extended } }, budget.id);
    expect(stableReferenceIdentity(reference, extendedResolver)).toMatchObject({ end: { rowId: 'zz-new-row' } });
  });
  it('handles completion within qualified references and escaped strings', () => {
    expect(formulaCompletions('=@Budget!Re', { start: 11, end: 11 }, { sheetNames: [] })).toEqual([]);
    expect(formulaCompletions('=@Budget!Re', { start: 11, end: 11 }, { sheetNames: [], propertyNames: ['Wrong'], propertyNamesForSheet: (sheet) => sheet === 'Budget' ? ['Revenue'] : [] }))
      .toContainEqual(expect.objectContaining({ label: 'Revenue', kind: 'property' }));
    const raw = '="a""b"+SU';
    expect(formulaCompletions(raw, { start: raw.length, end: raw.length }, { sheetNames: [] }))
      .toContainEqual(expect.objectContaining({ label: 'SUM' }));
  });

  it('offers only the named columns of the qualified sheet, including quoted sheet names', () => {
    const names = vi.fn((sheet: string) => sheet === "Owner's Plan" ? ['Sales total', 'Sales tax'] : []);
    const raw = "=@'Owner''s Plan'!Sa[1]";
    const cursor = raw.indexOf('[1]');
    const suggestions = formulaCompletions(raw, { start: cursor, end: cursor }, {
      sheetNames: ["Owner's Plan"], propertyNames: ['Same sheet'], propertyNamesForSheet: names,
    });
    expect(names).toHaveBeenCalledWith("Owner's Plan");
    expect(suggestions.map((item) => item.label)).toEqual(['Sales total', 'Sales tax']);
    expect(applyFormulaCompletion(raw, suggestions[0]!)).toBe("=@'Owner''s Plan'!'Sales total'[1]");
    expect(resolver.namedColumnNames?.('budget')).toEqual(['Revenue', 'Cost']);
    expect(resolver.namedColumnNames?.('missing')).toEqual([]);
  });

  it.each([
    { raw: "=@Budget!'Sales t", cursor: 16, name: 'Sales total', expected: "=@Budget!'Sales total'" },
    { raw: "=@Budget!'Sales tax'[1]+1", cursor: 16, name: 'Sales total', expected: "=@Budget!'Sales total'[1]+1" },
    { raw: "=@Budget!'Owner''s ta", cursor: 20, name: "Owner's tax", expected: "=@Budget!'Owner''s tax'" },
    { raw: "=@Budget!'Owner''s tax'[1]", cursor: 20, name: "Owner's total", expected: "=@Budget!'Owner''s total'[1]" },
  ])('replaces a partially typed quoted column including its suffix', ({ raw, cursor, name, expected }) => {
    const completion = formulaCompletions(raw, { start: cursor, end: cursor }, {
      sheetNames: [], propertyNamesForSheet: () => [name],
    }).find((suggestion) => suggestion.label === name);

    expect(completion).toBeDefined();
    expect(applyFormulaCompletion(raw, completion!)).toBe(expected);
  });

  it.each([
    { raw: "=@'Sales@2026'!Re", name: 'Revenue', qualifier: 'Sales@2026', expected: "=@'Sales@2026'!Revenue" },
    { raw: "=@Budget!'Sales@t", name: 'Sales@total', qualifier: 'Budget', expected: "=@Budget!'Sales@total'" },
    { raw: "=@'Owner''s @Plan!'!$'Sales@tax'[$1]+2", prefix: "'Sales@", name: 'Sales@total', qualifier: "Owner's @Plan!", expected: "=@'Owner''s @Plan!'!$'Sales@total'[$1]+2" },
    { raw: "=@'A!,+ [é]''@' ! 'X!,+ [é]''@'", name: "X!,+ [é]'@", qualifier: "A!,+ [é]'@", expected: "=@'A!,+ [é]''@' ! 'X!,+ [é]''@'" },
    { raw: '=@Budget!$', name: 'Revenue', qualifier: 'Budget', expected: '=@Budget!$Revenue' },
    { raw: '="x@!""y"+@Budget!Re', name: 'Revenue', qualifier: 'Budget', expected: '="x@!""y"+@Budget!Revenue' },
  ])('uses decoded names and exact spans for $raw', ({ raw, name, qualifier, expected, prefix }) => {
    const cursor = prefix ? raw.indexOf(prefix) + prefix.length : raw.length;
    const lookup = vi.fn((sheet: string) => sheet === qualifier ? [name] : []);
    const suggestions = formulaCompletions(raw, { start: cursor, end: cursor }, {
      sheetNames: ['Decoy'], propertyNames: ['Decoy'], propertyNamesForSheet: lookup,
    });
    expect(lookup).toHaveBeenCalledWith(qualifier);
    expect(suggestions.map((item) => item.label)).toEqual([name]);
    expect(applyFormulaCompletion(raw, suggestions[0]!)).toBe(expected);
  });

  it('replaces a quoted sheet name without duplicating its existing separator', () => {
    const raw = "=@'Owner''s @Plan!' !A[1]";
    const cursor = raw.indexOf('@Plan') + 2;
    const suggestions = formulaCompletions(raw, { start: cursor, end: cursor }, { sheetNames: ["Owner's @Plan!"] });
    expect(applyFormulaCompletion(raw, suggestions[0]!)).toBe(raw);
  });

  it('does not fall back to active columns for unknown quoted qualifiers', () => {
    const raw = "=@'Unknown@sheet'!Re";
    expect(formulaCompletions(raw, { start: raw.length, end: raw.length }, {
      sheetNames: [], propertyNames: ['Revenue'], propertyNamesForSheet: () => [],
    })).toEqual([]);
  });

  it.each([
    '=@Revenue[|1]', '=@Revenue[1|]', '=@Revenue[$|1]', '=@Revenue[#|1]', '=@Revenue[#$|1]',
    '=@Revenue[|', '=@Revenue[#|', '=@Revenue[$|', '=@Revenue[#$|', '=@Revenue[1|',
    '=@Revenue[SU|]', '=@Revenue[@SU|+1]', '=@Revenue[1]:|', '=@Revenue[1]:Co|st[2]',
    '=@Revenue[1]:$Co|st', "=@Revenue[1]:'Co|st'[2]", '=@Revenue[1]|',
    '=@Revenue.|SU', '=@%SU|', '=@~SU|', '=@$|$Revenue',
  ])('suppresses completion in structural reference text: %s', (marked) => {
    const cursor = marked.indexOf('|');
    const raw = marked.replace('|', '');
    for (const automatic of [false, true]) {
      expect(formulaCompletions(raw, { start: cursor, end: cursor }, {
        sheetNames: ['Budget'], propertyNames: ['Revenue'], automatic,
      })).toEqual([]);
    }
  });

  it.each([
    { marked: '=@$Bu|', kind: 'property', expected: '=@$Budget', start: 3, end: 5 },
    { marked: '=@Bu|!Revenue[1]', kind: 'sheet', expected: '=@Budget!Revenue[1]', start: 2, end: 4 },
    { marked: '=@Bu|[1]:Cost[2]', kind: 'property', expected: '=@Budget[1]:Cost[2]', start: 2, end: 4 },
    { marked: '=@$Bu|[$1]', kind: 'property', expected: '=@$Budget[$1]', start: 3, end: 5 },
  ])('limits completion kinds and preserves reference ownership for $marked', ({ marked, kind, expected, start, end }) => {
    const cursor = marked.indexOf('|');
    const raw = marked.replace('|', '');
    const completions = formulaCompletions(raw, { start: cursor, end: cursor }, {
      sheetNames: ['Budget'], propertyNames: ['Budget'],
    });
    expect(completions.map((item) => [item.kind, item.label, item.replacement])).toEqual([[kind, 'Budget', { start, end }]]);
    expect(applyFormulaCompletion(raw, completions[0]!)).toBe(expected);
  });

  it('resumes function completion only after a reference expression boundary', () => {
    for (const raw of ['=@Revenue[1]+SU', '=@Revenue[1]:Cost[2]+SU']) {
      const completion = formulaCompletions(raw, { start: raw.length, end: raw.length }, { sheetNames: [] })
        .find((item) => item.label === 'SUM')!;
      expect(applyFormulaCompletion(raw, completion)).toBe(raw + 'M');
    }
  });

  it.each([
    { raw: `=@'Sales"2026'!Re`, qualifier: 'Sales"2026', name: 'Revenue', expected: `=@'Sales"2026'!Revenue` },
    { raw: `=@Budget!'Sales"ta`, qualifier: 'Budget', name: 'Sales"tax', expected: `=@Budget!'Sales"tax'` },
    { raw: `=@Budget-2026!Re`, qualifier: 'Budget-2026', name: 'Revenue', expected: `=@Budget-2026!Revenue` },
    { raw: `=@Budget.v2 ! Re`, qualifier: 'Budget.v2', name: 'Revenue', expected: `=@Budget.v2 ! Revenue` },
    { raw: `=@2026_Plan!Re`, qualifier: '2026_Plan', name: 'Revenue', expected: `=@2026_Plan!Revenue` },
    { raw: `=@_Plan!Re`, qualifier: '_Plan', name: 'Revenue', expected: `=@_Plan!Revenue` },
  ])('resolves completion using the actual qualifier in $raw', ({ raw, qualifier, name, expected }) => {
    const lookup = vi.fn((sheet: string) => sheet === qualifier ? [name] : []);
    const completion = formulaCompletions(raw, { start: raw.length, end: raw.length }, {
      sheetNames: [], propertyNames: ['Decoy'], propertyNamesForSheet: lookup,
    });
    expect(lookup).toHaveBeenCalledWith(qualifier);
    expect(completion.map((item) => [item.kind, item.label])).toEqual([['property', name]]);
    expect(applyFormulaCompletion(raw, completion[0]!)).toBe(expected);
  });

  it.each(['+', '-', '*', '/', '=', '<>', '<', '<=', '>', '>='])('completes after %s without a row selector', (operator) => {
    for (const reference of ['@Revenue', '@Budget!Revenue']) {
      for (const automatic of [false, true]) {
        const raw = `=${reference}${operator}SU`;
        const completion = formulaCompletions(raw, { start: raw.length, end: raw.length }, { sheetNames: [], automatic })
          .find((item) => item.label === 'SUM')!;
        expect(completion.replacement).toEqual({ start: raw.length - 2, end: raw.length });
        expect(applyFormulaCompletion(raw, completion)).toBe(`=${reference}${operator}SUM`);
      }
    }
  });

  it('distinguishes double quotes in names from real literals', () => {
    const literal = `=@'Sales"2026'!Revenue+"a@!'""b"`;
    const cursor = literal.indexOf('@!') + 2;
    expect(formulaCompletions(literal, { start: cursor, end: cursor }, { sheetNames: [] })).toEqual([]);
    for (const raw of [`=@'Sales"2026'!Revenue+SU`, `="a@!'""b"+SU`]) {
      const sum = formulaCompletions(raw, { start: raw.length, end: raw.length }, { sheetNames: [] })
        .find((item) => item.label === 'SUM')!;
      expect(applyFormulaCompletion(raw, sum)).toBe(raw + 'M');
    }
  });

  it('formats grouped expressions without treating parentheses as function calls', () => {
    expect(formatFormula('=(1+2)*3', { start: 0, end: 0 }).raw).toBe('=(1 + 2) * 3');
  });

  it('outdents tabs and leaves unindented lines intact when the selection ends at a newline', () => {
    const raw = '\tfirst\nsecond\nthird';
    expect(outdentFormulaSelection(raw, { start: 0, end: 14 }).raw).toBe('first\nsecond\nthird');
  });

  it('reports unresolved range endpoints and incompatible hover results', () => {
    const cell = parseFormulaSyntax('=@A[1]').references[0]!;
    const range = parseFormulaSyntax('=@A[1]:B[1]').references[0]!;
    const missingEnd = parseFormulaSyntax('=@A[1]:Z[999]').references[0]!;
    const missingNamedEnd = parseFormulaSyntax('=@Revenue[1]:Missing[1]').references[0]!;
    expect(stableReferenceIdentity(missingEnd, resolver)).toBeUndefined();
    expect(stableReferenceIdentity(missingNamedEnd, resolver)).toBeUndefined();
    expect(formulaReferenceHover(cell, resolver, () => undefined)).toMatchObject({ kind: 'broken', identity: { kind: 'cell' } });
    expect(formulaReferenceHover(cell, resolver, () => [])).toMatchObject({ kind: 'broken', identity: { kind: 'cell' } });
    expect(formulaReferenceHover(range, resolver, () => ({ kind: 'number', value: 2 })))
      .toMatchObject({ kind: 'range', values: [{ kind: 'number', value: 2 }], truncated: false });
  });
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
    expect(properties).toContainEqual(expect.objectContaining({ kind: 'property', insertText: "'Revenue''s Net'" }));
  });

  it('completes a reference at a mid-token caret without duplicating its existing suffix', () => {
    const propertyRaw = '=@Re[1]';
    const property = formulaCompletions(propertyRaw, { start: 4, end: 4 }, { sheetNames: [], propertyNames: ['Revenue'] })
      .find((suggestion) => suggestion.label === 'Revenue');
    const sheetRaw = '=@Bu!A[1]';
    const sheet = formulaCompletions(sheetRaw, { start: 4, end: 4 }, { sheetNames: ['Budget'] })
      .find((suggestion) => suggestion.label === 'Budget');

    expect(applyFormulaCompletion(propertyRaw, property!)).toBe("=@Revenue[1]");
    expect(applyFormulaCompletion(sheetRaw, sheet!)).toBe('=@Budget!A[1]');
  });

  it.each([
    { raw: '=@$Re[$1]', cursor: 5, options: { sheetNames: [], propertyNames: ['Revenue'] }, label: 'Revenue', expected: "=@$Revenue[$1]" },
    { raw: "=@'Inputs'!$Re[$1]", cursor: 14, options: { sheetNames: [], propertyNamesForSheet: () => ['Revenue'] }, label: 'Revenue', expected: "=@'Inputs'!$Revenue[$1]" },
    { raw: '=@A[1]-SU', cursor: 9, options: { sheetNames: [] }, label: 'SUM', expected: '=@A[1]-SUM' },
    { raw: '=@A[1]+SU', cursor: 9, options: { sheetNames: [] }, label: 'SUM', expected: '=@A[1]+SUM' },
    { raw: '=@A[1]*SU', cursor: 9, options: { sheetNames: [] }, label: 'SUM', expected: '=@A[1]*SUM' },
    { raw: '=@A[1]/SU', cursor: 9, options: { sheetNames: [] }, label: 'SUM', expected: '=@A[1]/SUM' },
    { raw: '=SUM(@A[1], SU', cursor: 14, options: { sheetNames: [] }, label: 'SUM', expected: '=SUM(@A[1], SUM' },
  ])('preserves anchored reference syntax and completes after parser-recognized expression boundaries', ({ raw, cursor, options, label, expected }) => {
    const completion = formulaCompletions(raw, { start: cursor, end: cursor }, options).find((suggestion) => suggestion.label === label);

    expect(completion).toBeDefined();
    expect(applyFormulaCompletion(raw, completion!)).toBe(expected);
  });

  it.each(['+', '-', '*', '/', '=', '<>', '<', '<=', '>', '>='])('completes functions after the %s expression operator', (operator) => {
    const raw = `=@A[1]${operator}SU`;
    const completion = formulaCompletions(raw, { start: raw.length, end: raw.length }, { sheetNames: [] })
      .find((suggestion) => suggestion.label === 'SUM');

    expect(applyFormulaCompletion(raw, completion!)).toBe(`=@A[1]${operator}SUM`);
  });

  it('does not complete inside string literals or over an explicit selection', () => {
    expect(formulaCompletions('="SUM"', { start: 4, end: 4 }, { sheetNames: [] })).toEqual([]);
    expect(formulaCompletions('=SMM(@A[1])', { start: 1, end: 4 }, { sheetNames: [] })).toEqual([]);
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

  it('resolves named references for model context and bound-sheet hover values', () => {
    const unqualified = parseFormulaSyntax("=@'Revenue'[1]").references[0]!;
    const qualified = parseFormulaSyntax("=@Budget!'Revenue'[1]").references[0]!;

    expect(formulaReferenceHover(unqualified, resolver, () => ({ kind: 'number', value: 3 }), { modelOnly: true }))
      .toMatchObject({ kind: 'model-context', identity: { sheetId: 'budget', columnId: budget.content.columns[0] } });
    expect(formulaReferenceHover(qualified, resolver, () => ({ kind: 'number', value: 3 })))
      .toMatchObject({ kind: 'value', value: { kind: 'number', value: 3 } });
    expect(formulaReferenceHover(qualified, resolver, () => ({ kind: 'error', error: '#DIV/0!' })))
      .toMatchObject({ kind: 'value', value: { kind: 'error', error: '#DIV/0!' } });
  });

  it('assigns stable, differentiated colours to resolved reference identities', () => {
    const revenue = stableReferenceIdentity(parseFormulaSyntax("=@'Revenue'[1]").references[0]!, resolver)!;
    const cost = stableReferenceIdentity(parseFormulaSyntax("=@'Cost'[1]").references[0]!, resolver)!;
    const canonicalRevenue = stableReferenceIdentity(analyzeFormulaEditor(formulaRawToCanonical("=@Revenue[1]", resolver), resolver).references[0]!, resolver)!;

    expect(referenceIdentityColor(revenue)).toBe(referenceIdentityColor(canonicalRevenue));
    expect(referenceIdentityColor(revenue)).not.toBe(referenceIdentityColor(cost));
  });
});
