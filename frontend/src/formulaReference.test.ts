import { describe, expect, it } from 'vitest';
import { copyCanonicalFormula, formulaRawToCanonical, formulaRawToDisplay, formulaReferenceTokens, moveCanonicalFormula, workbookFormulaReferenceResolver } from './formulaReference';
import { sheetDocument, workbookWithSheets } from './test/workbookFactories';

describe('canonical formula references', () => {
  const source = sheetDocument({ id: 'source', name: 'Source', columnCount: 4, rowCount: 4 });
  const destination = sheetDocument({ id: 'destination', name: 'Destination', columnCount: 4, rowCount: 4 });
  const workbook = workbookWithSheets([source, destination]);
  const resolver = workbookFormulaReferenceResolver(workbook, 'source');

  it('stores stable identities, independent anchors, and qualifier presence without touching other source', () => {
    const raw = '= SUM( A1, $A1, A$1, $A$1, Destination!B2 : C3 )';
    const canonical = formulaRawToCanonical(raw, resolver);

    expect(canonical).toBe(`= SUM( @[source:column:1,source:row:1], @[$source:column:1,source:row:1], @[source:column:1,$source:row:1], @[$source:column:1,$source:row:1], destination!@[destination:column:2,destination:row:2] : @[destination:column:3,destination:row:3] )`);
    expect(formulaRawToDisplay(canonical, resolver)).toBe('= SUM( A1, $A1, A$1, $A$1, Destination!B2 : C3 )');
    expect(formulaReferenceTokens(canonical).map((token) => ({ kind: token.kind, anchors: token.endpoints.flatMap((endpoint) => endpoint ? [endpoint.anchors] : []) }))).toEqual([
      { kind: 'cell', anchors: [{ column: false, row: false }] },
      { kind: 'cell', anchors: [{ column: true, row: false }] },
      { kind: 'cell', anchors: [{ column: false, row: true }] },
      { kind: 'cell', anchors: [{ column: true, row: true }] },
      { kind: 'range', anchors: [{ column: false, row: false }, { column: false, row: false }] },
    ]);
  });

  it('tokenizes A1 references syntactically without requiring a workbook resolver', () => {
    const tokens = formulaReferenceTokens("=A1+$A1+A$1+$A$1+'Other Sheet'!B2 : C3");

    expect(tokens.map((token) => ({
      kind: token.kind,
      qualifier: token.qualifier.kind,
      endpoints: token.endpoints.flatMap((endpoint) => endpoint ? [{
        kind: endpoint.kind,
        anchors: endpoint.anchors,
        span: endpoint.sourceSpan,
      }] : []),
    }))).toEqual([
      { kind: 'cell', qualifier: 'unqualified', endpoints: [{ kind: 'a1', anchors: { column: false, row: false }, span: { start: 1, end: 3 } }] },
      { kind: 'cell', qualifier: 'unqualified', endpoints: [{ kind: 'a1', anchors: { column: true, row: false }, span: { start: 4, end: 7 } }] },
      { kind: 'cell', qualifier: 'unqualified', endpoints: [{ kind: 'a1', anchors: { column: false, row: true }, span: { start: 8, end: 11 } }] },
      { kind: 'cell', qualifier: 'unqualified', endpoints: [{ kind: 'a1', anchors: { column: true, row: true }, span: { start: 12, end: 16 } }] },
      { kind: 'range', qualifier: 'explicit', endpoints: [
        { kind: 'a1', anchors: { column: false, row: false }, span: { start: 31, end: 33 } },
        { kind: 'a1', anchors: { column: false, row: false }, span: { start: 36, end: 38 } },
      ] },
    ]);
  });

  it('copies each unanchored axis independently and keeps moves stable', () => {
    const canonical = formulaRawToCanonical('=A1+$A1+A$1+$A$1', resolver);
    const result = copyCanonicalFormula(canonical, { columnId: 'source:column:3', rowId: 'source:row:3' }, { columnId: 'source:column:4', rowId: 'source:row:4' }, resolver);

    expect(result).toEqual({ ok: true, raw: formulaRawToCanonical('=B2+$A2+B$1+$A$1', resolver) });
    expect(moveCanonicalFormula(canonical)).toEqual({ ok: true, raw: canonical });
  });

  it('reports a failed copy when a displaced coordinate does not resolve', () => {
    const canonical = formulaRawToCanonical('=D4', resolver);
    expect(copyCanonicalFormula(canonical, { columnId: 'source:column:3', rowId: 'source:row:3' }, { columnId: 'source:column:4', rowId: 'source:row:4' }, resolver)).toEqual({ ok: false, reason: 'unresolved-coordinate' });
  });

  it('uses the destination sheet for unqualified cross-sheet copies and retains explicit targets', () => {
    const copied = copyCanonicalFormula(
      formulaRawToCanonical('=A1+Source!A1', resolver),
      { columnId: 'source:column:3', rowId: 'source:row:3' },
      { columnId: 'destination:column:4', rowId: 'destination:row:4' },
      resolver,
      { sourceSheetId: 'source', destinationSheetId: 'destination' },
    );

    expect(copied).toEqual({
      ok: true,
      raw: `=@[destination:column:2,destination:row:2]+source!@[source:column:2,source:row:2]`,
    });
  });

  it('uses shared syntax recovery and preserves qualifier-adjacent formatting', () => {
    expect(formulaReferenceTokens("=SUM('broken!A1, source!B2)")).toEqual([]);
    const raw = '= Source \n ! A1 : B2';
    const canonical = formulaRawToCanonical(raw, resolver);
    expect(canonical).toBe('= source \n ! @[source:column:1,source:row:1] : @[source:column:2,source:row:2]');
    expect(formulaRawToDisplay(canonical, resolver)).toBe(raw);
  });

  it('stores digit-suffixed function arguments and keeps their identities through reorder', () => {
    const reordered = {
      ...source,
      content: {
        ...source.content,
        columns: [source.content.columns[1]!, source.content.columns[0]!, ...source.content.columns.slice(2)],
        rows: [source.content.rows[1]!, source.content.rows[0]!, ...source.content.rows.slice(2)],
      },
    };
    const reorderedResolver = workbookFormulaReferenceResolver(
      workbookWithSheets([reordered, destination]),
      'source',
    );
    const cases = [
      {
        raw: '=LOG10(A1)',
        references: ['A1'],
        canonical: '=LOG10(@[source:column:1,source:row:1])',
        reordered: '=LOG10(B2)',
      },
      {
        raw: '=A1(A1)',
        references: ['A1'],
        canonical: '=A1(@[source:column:1,source:row:1])',
        reordered: '=A1(B2)',
      },
      {
        raw: '=A1(LOG10(B2))',
        references: ['B2'],
        canonical: '=A1(LOG10(@[source:column:2,source:row:2]))',
        reordered: '=A1(LOG10(A1))',
      },
    ];

    for (const entry of cases) {
      expect(formulaReferenceTokens(entry.raw).map((token) =>
        entry.raw.slice(token.sourceSpan.start, token.sourceSpan.end),
      )).toEqual(entry.references);
      const canonical = formulaRawToCanonical(entry.raw, resolver);
      expect(canonical).toBe(entry.canonical);
      expect(formulaRawToDisplay(canonical, reorderedResolver)).toBe(entry.reordered);
    }
  });

  it('makes missing targets broken and rejects broken canonical copy inputs', () => {
    expect(formulaRawToCanonical('=Missing!A1', resolver)).toBe('=#REF!');
    expect(formulaRawToDisplay('=missing!@[source:column:1,source:row:1]', resolver)).toBe('=#REF!');
    expect(copyCanonicalFormula('=#REF!@[source:column:1,source:row:1]', { columnId: 'source:column:1', rowId: 'source:row:1' }, { columnId: 'source:column:2', rowId: 'source:row:2' }, resolver)).toEqual({ ok: false, reason: 'unresolved-coordinate' });
  });

  it('does not treat canonical-looking string literals as references', () => {
    const literal = '"@[source:column:1,source:row:1]"';
    expect(formulaRawToDisplay(`=${literal}+@[source:column:1,source:row:1]`, resolver)).toBe(`=${literal}+A1`);
    expect(formulaReferenceTokens(`=A1+${literal}`).map((token) => token.endpoints[0].kind)).toEqual(['a1']);
    expect(formulaRawToCanonical(`=A1+${literal}`, resolver)).toBe(`=@[source:column:1,source:row:1]+${literal}`);
  });

  it('recognizes canonical endpoints only in formulaSyntax grammar contexts', () => {
    const canonical = '@[source:column:1,source:row:1]';
    expect(formulaReferenceTokens(`=A1(${canonical})`).map((token) => token.endpoints[0].kind)).toEqual(['canonical']);
    expect(formulaReferenceTokens(`=SUM(${canonical}+A1)`).map((token) => token.endpoints[0].kind)).toEqual(['canonical', 'a1']);
    expect(formulaReferenceTokens(`='Other Sheet'!${canonical}:@[$source:column:2,source:row:2]`).map((token) => ({
      qualifier: token.qualifier.kind,
      kind: token.kind,
      endpoints: token.endpoints.flatMap((endpoint) => endpoint ? [endpoint.kind] : []),
    }))).toEqual([{ qualifier: 'explicit', kind: 'range', endpoints: ['canonical', 'canonical'] }]);
    expect(formulaReferenceTokens(`="${canonical}"+${canonical}`).map((token) => token.endpoints[0].kind)).toEqual(['canonical']);
    expect(formulaReferenceTokens(`=SUM('broken!${canonical}, Source!${canonical})`)).toEqual([]);
  });

  it('encodes ambiguous stable sheet qualifiers without changing subtraction syntax', () => {
    const a1Named = sheetDocument({ id: 'a1-sheet', name: 'Sheet1', columnCount: 4, rowCount: 4 });
    const quoted = sheetDocument({ id: 'quoted-a1', name: 'A1', columnCount: 4, rowCount: 4 });
    const namedResolver = workbookFormulaReferenceResolver(workbookWithSheets([source, a1Named, quoted]), 'source');
    const canonical = "='a1-sheet'!@[a1-sheet:column:2,a1-sheet:row:2]";

    expect(formulaRawToCanonical('=Sheet1!B2', namedResolver)).toBe(canonical);
    expect(formulaRawToCanonical("='A1'!B2", namedResolver)).toBe("='quoted-a1'!@[quoted-a1:column:2,quoted-a1:row:2]");
    expect(formulaReferenceTokens(canonical)).toMatchObject([{
      qualifier: { kind: 'explicit', sheetId: 'a1-sheet' },
      endpoints: [{ kind: 'canonical' }],
    }]);
    expect(formulaRawToDisplay(canonical, namedResolver)).toBe('=Sheet1!B2');
    expect(copyCanonicalFormula(canonical, { columnId: 'a1-sheet:column:1', rowId: 'a1-sheet:row:1' }, { columnId: 'a1-sheet:column:2', rowId: 'a1-sheet:row:2' }, namedResolver, { sourceSheetId: 'a1-sheet' })).toEqual({ ok: true, raw: "='a1-sheet'!@[a1-sheet:column:3,a1-sheet:row:3]" });
    expect(formulaReferenceTokens("=A1-'a1-sheet'!@[a1-sheet:column:1,a1-sheet:row:1]").map((token) => token.qualifier.kind)).toEqual(['unqualified', 'explicit']);
  });

  it('escapes apostrophes in stable sheet qualifiers', () => {
    const apostrophe = sheetDocument({ id: "owner's-id", name: "Owner's Sheet", columnCount: 4, rowCount: 4 });
    const namedResolver = workbookFormulaReferenceResolver(workbookWithSheets([source, apostrophe]), 'source');
    const canonical = "='owner''s-id'!@[owner's-id:column:1,owner's-id:row:1]";

    expect(formulaRawToCanonical("='Owner''s Sheet'!A1", namedResolver)).toBe(canonical);
    expect(formulaReferenceTokens(canonical)[0]?.qualifier).toMatchObject({ kind: 'explicit', sheetId: "owner's-id" });
    expect(formulaRawToDisplay(canonical, namedResolver)).toBe("='Owner''s Sheet'!A1");
  });
});
