import { describe, expect, it } from 'vitest';
import { parseUserFormulaSyntax, type FormulaSourceSpan } from './syntax';

describe('complete user reference candidates', () => {
  it.each([
    "@'Property'[0]", "@'Property'[-1]", "@'Property'[01]", "@'Property'[1.5]",
    "@'Property'[", "@'Property' [0]", "@'Property'[1]junk", "@'Property'[1][2]",
    '@A[0]', '@A[-1]', '@A[01]', '@A[1.5]', '@A[', '@A[1]junk', '@A[1][2]',
    '@A[1]:B[0]', '@A[1]:', '@A[1]:B[2]:C[3]', '@A[1]:@B[2]',
    '@A[1]:Other!B[2]', '@@A[1]', 'word@A[1]', '1@A[1]', '@A[1]!B[2]',
    '@foo-1[bad]', '@~0070~0063[0072]',
    "@'Property'[9007199254740992]", '@Amount[9007199254740992]',
  ])('does not bind an invalid fragment or its prefixes: %s', (fragment) => {
    const raw = `=${fragment}+@Good!B[2]`;

    const analysis = parseUserFormulaSyntax(raw, (_sheet, name) => name === 'Amount');

    expect(analysis.result.kind).toBe('error');
    expect(analysis.referenceLexemes.map(({ sourceSpan }) => raw.slice(sourceSpan.start, sourceSpan.end))).toEqual(['@Good!B[2]']);
  });

  it.each(['@A[1]', '@A[1]-3', "@'Property'", "@'Property'[2]", '@Amount[2]', '@A[1]:B[2]', '@B[2]:A[1]'])('recognizes complete user syntax: %s', (fragment) => {
    const analysis = parseUserFormulaSyntax(`=${fragment}`, (_sheet, name) => name === 'Amount');

    expect(analysis.result.kind).toBe('formula');
    expect(analysis.referenceLexemes).toHaveLength(1);
    expect(analysis.referenceLexemes[0].endpoints.every(({ kind }) => kind === 'a1' || kind === 'named')).toBe(true);
  });

  it('recovers separate references in malformed expressions without scanning text literals', () => {
    const raw = '= Unknown(, "@NotAReference!A[1]",) + @Missing!A[1] + ??? @Good!B[2]';

    const analysis = parseUserFormulaSyntax(raw);

    expect(analysis.result.kind).toBe('error');
    expect(analysis.referenceLexemes.map(({ qualifier }) => qualifier?.value)).toEqual(['Missing', 'Good']);
    expect(analysis.tokens.map(({ sourceSpan }) => raw.slice(sourceSpan.start, sourceSpan.end)).join('')).toBe(raw);
  });

  it('does not recursively interpret the text of a literal stored envelope', () => {
    const raw = '=~F1["=@Inputs!A[1]",[]]';

    const analysis = parseUserFormulaSyntax(raw);

    expect(analysis.result.kind).toBe('error');
    expect(analysis.referenceLexemes).toEqual([]);
  });
});

describe('reference payload source spans', () => {
  it('excludes quoting, anchors and punctuation while preserving UTF-16 escaped payloads', () => {
    const raw = "=SUM(@'Owner😀''s Plan' ! $'Cost''s [price]'[$12] : 'Total' [3], @$AA[$1])";
    const slice = (span: FormulaSourceSpan) => raw.slice(span.start, span.end);

    const analysis = parseUserFormulaSyntax(raw);

    // Spaces before a row suffix are not part of the supported endpoint grammar.
    expect(analysis.referenceLexemes.map(({ sourceSpan }) => slice(sourceSpan))).toEqual(['@$AA[$1]']);
    const valid = raw.replace("'Total' [3]", "'Total'[3]");
    const lexemes = parseUserFormulaSyntax(valid).referenceLexemes;
    const payload = (span: FormulaSourceSpan) => valid.slice(span.start, span.end);
    expect(lexemes[0].qualifier?.value).toBe("Owner😀's Plan");
    expect(payload(lexemes[0].qualifier!.payloadSpan)).toBe("Owner😀''s Plan");
    expect(lexemes.map(({ endpoints }) => endpoints.map(({ payloadSpans }) => [payload(payloadSpans.column), payload(payloadSpans.row)]))).toEqual([
      [["Cost''s [price]", '12'], ['Total', '3']], [['AA', '1']],
    ]);
  });

  it('emits zero-width implicit row payloads and unquoted qualifier payloads', () => {
    const raw = '=@Inputs!$Amount + @Local';

    const analysis = parseUserFormulaSyntax(raw);

    expect(analysis.result.kind).toBe('formula');
    expect(analysis.referenceLexemes[0].qualifier?.payloadSpan).toEqual({ start: 2, end: 8 });
    expect(analysis.referenceLexemes.map(({ endpoints }) => endpoints[0].payloadSpans)).toEqual([
      { column: { start: 10, end: 16 }, row: { start: 16, end: 16 } },
      { column: { start: 20, end: 25 }, row: { start: 25, end: 25 } },
    ]);
  });
});
