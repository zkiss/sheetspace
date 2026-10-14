import { describe, expect, it } from 'vitest';
import { formulaReferenceLexemes, parseFormula } from './syntax';
import { formulaRawToCanonical, formulaRawToDisplayProjection, workbookFormulaReferenceResolver } from './reference';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

describe('mandatory reference syntax', () => {
  it.each([
    ['@A[1]', 'cell'],
    ['@Inputs!A[1]', 'cell'],
    ["@'Sales Q1'!A[1]", 'cell'],
    ["@'Owner''s Plan'!$AA[$123]", 'cell'],
    ['@$A[1]', 'cell'],
    ['@A[$1]', 'cell'],
    ['@$A[$1]', 'cell'],
    ['@A[1]:C[10]', 'range'],
    ['@Inputs!$C[10]:A[$1]', 'range'],
  ])('parses the complete reference %s', (reference, kind) => {
    const raw = `=${reference}`;

    expect(parseFormula(raw)).toMatchObject({
      kind: 'formula', expression: { kind, sourceSpan: { start: 1, end: raw.length } },
    });
    expect(formulaReferenceLexemes(raw)).toHaveLength(1);
  });

  it.each([
    'A1', 'Inputs!A1', '@[column-id,row-id]', 'Inputs!@column-id[row-id]',
    '@A[0]', '@A[$0]', '@A[-1]', '@A[01]', '@A[foo]', '@A[1+2]', '@A[1.5]',
    '@A[]', '@A1', '@A[1', '@A[1]junk', '@A[1]:@C[10]',
    '@Inputs!A[1]:Other!C[10]', '@A[1]:column-id[row-id]',
    '@column-id[row-id]:C[10]', '@@A[1]',
  ])('rejects invalid or replaced syntax %s as a complete formula', (reference) => {
    const raw = `=${reference}`;

    expect(parseFormula(raw)).toEqual({ kind: 'error', raw, error: '#PARSE!' });
  });

  it.each(['=A1', '=Inputs!A1', '=@[column-id,row-id]'])('does not transform legacy references in %s', (raw) => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs' });
    const resolver = workbookFormulaReferenceResolver(workbookWithSheets([sheet]), sheet.id);

    expect(formulaReferenceLexemes(raw)).toEqual([]);
    expect(formulaRawToCanonical(raw, resolver)).toBe(raw);
  });
});

describe('UUID reference components and projections', () => {
  const sheetId = '123e4567-e89b-12d3-a456-426614174000';
  const columnId = '223e4567-e89b-12d3-a456-426614174001';
  const otherColumnId = '323e4567-e89b-12d3-a456-426614174002';
  const rowId = '423e4567-e89b-12d3-a456-426614174003';
  const otherRowId = '523e4567-e89b-12d3-a456-426614174004';
  const original = sheetDocument({ id: sheetId, name: "Owner's Plan", columnCount: 2, rowCount: 2 });
  const sheet = {
    ...original,
    content: { ...original.content, columns: [columnId, otherColumnId], rows: [rowId, otherRowId] },
  };
  const resolver = workbookFormulaReferenceResolver(workbookWithSheets([sheet]), sheetId);

  it('round trips independent range anchors and projects exact component and whole-reference spans', () => {
    const raw = "= sUm(\n @'Owner''s Plan' \t! $B[$2] : A[1], @A[$1] )";
    const canonical = `= sUm(\n @${sheetId} \t! $${otherColumnId}[$${otherRowId}] : ${columnId}[${rowId}], @${columnId}[$${rowId}] )`;

    expect(formulaRawToCanonical(raw, resolver)).toBe(canonical);
    expect(parseFormula(canonical)).toMatchObject({ kind: 'formula' });
    const lexemes = formulaReferenceLexemes(canonical);
    expect(lexemes.map((lexeme) => ({
      text: canonical.slice(lexeme.sourceSpan.start, lexeme.sourceSpan.end),
      qualifier: lexeme.qualifier && canonical.slice(lexeme.qualifier.sourceSpan.start, lexeme.qualifier.sourceSpan.end),
      endpoints: lexeme.endpoints.map((endpoint) => ({
        text: canonical.slice(endpoint.sourceSpan.start, endpoint.sourceSpan.end), anchors: endpoint.anchors,
      })),
    }))).toEqual([
      {
        text: `@${sheetId} \t! $${otherColumnId}[$${otherRowId}] : ${columnId}[${rowId}]`,
        qualifier: sheetId,
        endpoints: [
          { text: `$${otherColumnId}[$${otherRowId}]`, anchors: { column: true, row: true } },
          { text: `${columnId}[${rowId}]`, anchors: { column: false, row: false } },
        ],
      },
      { text: `@${columnId}[$${rowId}]`, qualifier: undefined, endpoints: [
        { text: `${columnId}[$${rowId}]`, anchors: { column: false, row: true } },
      ] },
    ]);
    const projection = formulaRawToDisplayProjection(canonical, resolver);
    expect(projection.raw).toBe(raw);
    expect(projection.referenceSpans.map((span) => raw.slice(span.start, span.end))).toEqual([
      "@'Owner''s Plan' \t! $B[$2] : A[1]", '@A[$1]',
    ]);
  });

  it('preserves all non-reference spelling and skips escaped text during syntax recovery', () => {
    const raw = '= OddFunction( 01, TrUe, "@A[1] and ""@Inputs!B[2]""",)\n + @A[1] * .5e2';

    const canonical = formulaRawToCanonical(raw, resolver);

    expect(canonical).toBe(`= OddFunction( 01, TrUe, "@A[1] and ""@Inputs!B[2]""",)\n + @${columnId}[${rowId}] * .5e2`);
    expect(formulaRawToDisplayProjection(canonical, resolver).raw).toBe(raw);
  });

  it.each(['sheet', 'column', 'row'])('does not rebind a deleted %s identity to a replacement', (axis) => {
    const canonical = formulaRawToCanonical("=@'Owner''s Plan'!A[1]+@B[2]", resolver);
    const replacement = {
      ...sheet,
      id: axis === 'sheet' ? 'replacement-sheet' : sheetId,
      content: {
        ...sheet.content,
        columns: axis === 'column' ? ['replacement-column', otherColumnId] : sheet.content.columns,
        rows: axis === 'row' ? ['replacement-row', otherRowId] : sheet.content.rows,
      },
    };
    const replacementResolver = workbookFormulaReferenceResolver(workbookWithSheets([replacement]), replacement.id);

    expect(formulaRawToDisplayProjection(canonical, replacementResolver).raw).toBe('=#REF!+@B[2]');
  });
});
