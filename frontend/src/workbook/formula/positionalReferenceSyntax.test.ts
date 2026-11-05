import { describe, expect, it } from 'vitest';
import { collectFormulaReferences, parseFormulaSyntax, parseUserFormulaSyntax } from './syntax';
import { formatCanonicalFormulaEndpoint, formulaReferenceTokens, formulaRawToCanonical, workbookFormulaReferenceResolver } from './reference';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { prepareUserFormula } from './formulaPreparation';

describe('positional public reference syntax', () => {
  it.each([
    ['=@B[#2]', false, false],
    ['=@B[#$2]', false, true],
    ['=@$B[#2]', true, false],
    ['=@$B[#$2]', true, true],
    ['=@Orders!B[#2]', false, false],
    ["=@'Owner''s Orders'!$'Unit Price'[#$2]", true, true],
    ['=@Orders!Price[#2]', false, false],
  ])('preserves the row modifier and independent anchors in %s', (raw, column, row) => {
    const syntax = parseUserFormulaSyntax(raw, (_sheet, name) => name === 'Price');

    expect(syntax.result).toMatchObject({ kind: 'formula', expression: { kind: 'row-reference' } });
    const endpoint = syntax.referenceLexemes[0].endpoints[0];
    expect(endpoint).toMatchObject({ rowMode: 'positional', anchors: { column, row } });
    expect(raw.slice(endpoint.payloadSpans.row.start, endpoint.payloadSpans.row.end)).toBe('2');
    expect(syntax.tokens.map((token) => raw.slice(token.sourceSpan.start, token.sourceSpan.end)).join('')).toBe(raw);
    if (syntax.result.kind === 'formula') expect(collectFormulaReferences(syntax.result.expression)).toEqual(syntax.references);
  });

  it.each([
    ['=@B[5]:A[#2]', [undefined, 'positional']],
    ['=@B[#5]:A[2]', ['positional', undefined]],
    ['=@B[#5]:A[#2]', ['positional', 'positional']],
    ['=@B[#5]:A', ['positional', undefined]],
    ["=@'Price'[#5]:'Cost'[2]", ['positional', undefined]],
    ["=@'Price'[#5]:'Cost'", ['positional', undefined]],
  ])('keeps source-ordered endpoint modes in %s', (raw, modes) => {
    const syntax = parseUserFormulaSyntax(raw);

    expect(syntax.result).toMatchObject({ kind: 'formula', expression: { kind: 'row-reference' } });
    expect(syntax.referenceLexemes[0].endpoints.map((endpoint) => endpoint.rowMode)).toEqual(modes);
    expect(syntax.referenceLexemes[0].endpoints.map((endpoint) => raw.slice(endpoint.sourceSpan.start, endpoint.sourceSpan.end))).toEqual(raw.slice(2).split(':'));
    if (!raw.endsWith(']')) expect(syntax.referenceLexemes[0].endpoints[1]).toMatchObject({ open: true, anchors: { row: false } });
  });

  it('keeps the internal percent column escape distinct from the row modifier', () => {
    const syntax = parseUserFormulaSyntax('=@%B[2]+@%$B[#$2]', () => true);

    expect(syntax.result.kind).toBe('formula');
    expect(syntax.referenceLexemes.map((reference) => reference.endpoints[0])).toMatchObject([
      { kind: 'a1', value: { rowIndex: 1, columnIndex: 1 } },
      { kind: 'a1', rowMode: 'positional', value: { rowIndex: 1, columnIndex: 1 }, anchors: { column: true, row: true } },
    ]);
    expect(syntax.referenceLexemes[0].endpoints[0].rowMode).toBeUndefined();
  });

  it.each(['@B[#0]', '@B[#01]', '@B[$#2]', '@B[##2]', '@#B[2]', '@B[#-2]', '@B[#2.5]', '@B[#]', '@B[#2', '@B[#9007199254740992]', '@B[#2]:@C[#3]'])('rejects malformed positional syntax %s', (reference) => {
    expect(parseUserFormulaSyntax(`=${reference}`).result).toMatchObject({ kind: 'error', error: '#PARSE!' });
  });

  it('preserves literal and error tokens and recovers references around an incomplete draft', () => {
    const raw = '=SUM("@B[#2]", #REF!, @A[#2], @B[#$], @C[#$3])';
    const syntax = parseUserFormulaSyntax(raw);

    expect(syntax.result.kind).toBe('error');
    expect(syntax.referenceLexemes.map((reference) => raw.slice(reference.sourceSpan.start, reference.sourceSpan.end))).toEqual(['@A[#2]', '@C[#$3]']);
    expect(syntax.tokens.map((token) => raw.slice(token.sourceSpan.start, token.sourceSpan.end)).join('')).toBe(raw);
  });
});

describe('positional canonical endpoint contract', () => {
  const anchors = { column: true, row: true };

  it.each([undefined, "property ' one"])('round trips stable column identity and numeric row position with property %s', (propertyId) => {
    const endpoint = formatCanonicalFormulaEndpoint({ columnId: 'column-2', rowIndex: 4 }, anchors, propertyId);
    const syntax = parseFormulaSyntax(`=@sheet-1!${endpoint}`, { stored: true });

    expect(syntax.result).toMatchObject({ kind: 'formula', expression: { kind: 'row-reference' } });
    expect(syntax.referenceLexemes[0].endpoints[0]).toMatchObject({ kind: 'positional-canonical', value: { columnId: 'column-2', rowIndex: 4, ...(propertyId === undefined ? {} : { propertyId }) }, anchors });
    expect(syntax.referenceLexemes[0].endpoints[0].value).not.toHaveProperty('rowId');
    const parsed = syntax.referenceLexemes[0].endpoints[0];
    if (parsed.kind !== 'positional-canonical') throw new Error('Expected a canonical positional endpoint');
    expect(formatCanonicalFormulaEndpoint(parsed.value, parsed.anchors, parsed.value.propertyId)).toBe(endpoint);
    expect(endpoint).toContain('[#$5]');
    expect(formulaReferenceTokens(`=@${endpoint}`)[0].endpoints[0]).toMatchObject({ kind: 'recipe', endpoint: { kind: 'positional-canonical' } });
  });

  it.each([false, true])('preserves mixed, reversed and open endpoints (named: %s)', (named) => {
    const propertyId = named ? 'property-2' : undefined;
    const stable = formatCanonicalFormulaEndpoint({ columnId: 'column-1', rowId: 'row-9' }, { column: false, row: false }, propertyId);
    const positional = formatCanonicalFormulaEndpoint({ columnId: 'column-2', rowIndex: 1 }, anchors, propertyId);
    for (const endpoints of [[stable, positional], [positional, stable], [positional, positional]]) {
      const syntax = parseFormulaSyntax(`=@${endpoints.join(':')}`, { stored: true });
      expect(syntax.result).toMatchObject({ kind: 'formula', expression: { kind: 'row-reference' } });
      expect(syntax.referenceLexemes[0].endpoints).toHaveLength(2);
      expect(syntax.referenceLexemes[0].endpoints.map((endpoint) => endpoint.kind)).toEqual(endpoints.map((endpoint) => endpoint.includes('[#') ? 'positional-canonical' : named ? 'stored-named' : 'canonical'));
    }
    const open = formatCanonicalFormulaEndpoint({ columnId: 'column-1', rowIndex: 1 }, anchors, propertyId, true);
    const syntax = parseFormulaSyntax(`=@${positional}:${open}`, { stored: true });
    expect(syntax.result.kind).toBe('formula');
    expect(syntax.referenceLexemes[0].endpoints[1]).toMatchObject({ kind: 'open-canonical', open: true, value: { columnId: 'column-1' } });
    expect(syntax.referenceLexemes[0].endpoints[1].value).not.toHaveProperty('rowIndex');
  });

  it.each([0, 1000, Number.MAX_SAFE_INTEGER - 1])('round trips a row index independently of sheet size: %s', (rowIndex) => {
    const endpoint = formatCanonicalFormulaEndpoint({ columnId: 'column-1', rowIndex }, { column: false, row: false });
    const syntax = parseFormulaSyntax(`=@${endpoint}`, { stored: true });

    expect(syntax.result.kind).toBe('formula');
    expect(syntax.referenceLexemes[0].endpoints[0]).toMatchObject({ kind: 'positional-canonical', value: { columnId: 'column-1', rowIndex } });
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER, NaN, Infinity])('rejects an unserializable row index %s', (rowIndex) => {
    expect(() => formatCanonicalFormulaEndpoint({ columnId: 'column-1', rowIndex }, anchors)).toThrow(RangeError);
  });

  it('does not silently bind a positional recipe as a stable row before binding integration', () => {
    const sheet = sheetDocument({ id: 'sheet-1', name: 'Sheet', rowCount: 3, columnCount: 2 });
    const workbook = workbookWithSheets([sheet]);
    const raw = '=@B[#2]';

    expect(formulaRawToCanonical(raw, workbookFormulaReferenceResolver(workbook, sheet.id))).toBe(raw);
    expect(prepareUserFormula(raw, workbook, sheet.id)).not.toContain(`[${sheet.content.rows[1]}]`);
  });
});
