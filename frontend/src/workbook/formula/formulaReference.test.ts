import { describe, expect, it } from 'vitest';
import { copyCanonicalFormula, formulaRawToCanonical, formulaRawToDisplay, formulaReferenceTokens, moveCanonicalFormula, workbookFormulaReferenceResolver } from '@workbook/formula/reference';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

describe('canonical formula references', () => {
  const source = sheetDocument({ id: 'source', name: 'Source', columnCount: 4, rowCount: 5 });
  const destination = sheetDocument({ id: 'destination', name: 'Destination', columnCount: 4, rowCount: 5 });
  const workbook = workbookWithSheets([source, destination]);
  const resolver = workbookFormulaReferenceResolver(workbook, 'source');

  it('stores stable identities, independent anchors, and qualifier presence without touching other source', () => {
    const raw = '= SUM( @A[1], @$A[1], @A[$1], @$A[$1], @Destination!B[2] : C[3] )';
    const canonical = formulaRawToCanonical(raw, resolver);

    expect(canonical).toBe(`= SUM( @source:column:1[source:row:1], @$source:column:1[source:row:1], @source:column:1[$source:row:1], @$source:column:1[$source:row:1], @destination!destination:column:2[destination:row:2] : destination:column:3[destination:row:3] )`);
    expect(formulaRawToDisplay(canonical, resolver)).toBe('= SUM( @A[1], @$A[1], @A[$1], @$A[$1], @Destination!B[2] : C[3] )');
    expect(formulaReferenceTokens(canonical).map((token) => ({ kind: token.kind, anchors: token.endpoints.flatMap((endpoint) => endpoint ? [endpoint.anchors] : []) }))).toEqual([
      { kind: 'cell', anchors: [{ column: false, row: false }] },
      { kind: 'cell', anchors: [{ column: true, row: false }] },
      { kind: 'cell', anchors: [{ column: false, row: true }] },
      { kind: 'cell', anchors: [{ column: true, row: true }] },
      { kind: 'range', anchors: [{ column: false, row: false }, { column: false, row: false }] },
    ]);
  });

  it('tokenizes A1 references syntactically without requiring a workbook resolver', () => {
    const tokens = formulaReferenceTokens("=@A[1]+@$A[1]+@A[$1]+@$A[$1]+@'Other Sheet'!B[2] : C[3]");

    expect(tokens.map((token) => ({
      kind: token.kind,
      qualifier: token.qualifier.kind,
      endpoints: token.endpoints.flatMap((endpoint) => endpoint ? [{
        kind: endpoint.kind,
        anchors: endpoint.anchors,
        span: endpoint.sourceSpan,
      }] : []),
    }))).toEqual([
      { kind: 'cell', qualifier: 'unqualified', endpoints: [{ kind: 'a1', anchors: { column: false, row: false }, span: { start: 2, end: 6 } }] },
      { kind: 'cell', qualifier: 'unqualified', endpoints: [{ kind: 'a1', anchors: { column: true, row: false }, span: { start: 8, end: 13 } }] },
      { kind: 'cell', qualifier: 'unqualified', endpoints: [{ kind: 'a1', anchors: { column: false, row: true }, span: { start: 15, end: 20 } }] },
      { kind: 'cell', qualifier: 'unqualified', endpoints: [{ kind: 'a1', anchors: { column: true, row: true }, span: { start: 22, end: 28 } }] },
      { kind: 'range', qualifier: 'explicit', endpoints: [
        { kind: 'a1', anchors: { column: false, row: false }, span: { start: 44, end: 48 } },
        { kind: 'a1', anchors: { column: false, row: false }, span: { start: 51, end: 55 } },
      ] },
    ]);
  });

  it('copies each unanchored axis independently and keeps moves stable', () => {
    const canonical = formulaRawToCanonical('=@A[1]+@$A[1]+@A[$1]+@$A[$1]', resolver);
    const result = copyCanonicalFormula(canonical, { columnId: 'source:column:3', rowId: 'source:row:3' }, { columnId: 'source:column:4', rowId: 'source:row:4' }, resolver);

    expect(result).toEqual({ ok: true, raw: formulaRawToCanonical('=@B[2]+@$A[2]+@B[$1]+@$A[$1]', resolver) });
    expect(moveCanonicalFormula(canonical)).toEqual({ ok: true, raw: canonical });
  });

  it('reports a failed copy when a displaced coordinate does not resolve', () => {
    const canonical = formulaRawToCanonical('=@D[4]', resolver);
    expect(copyCanonicalFormula(canonical, { columnId: 'source:column:3', rowId: 'source:row:3' }, { columnId: 'source:column:4', rowId: 'source:row:4' }, resolver)).toEqual({ ok: false, reason: 'unresolved-coordinate' });
  });

  it('uses the destination sheet for unqualified cross-sheet copies and retains explicit targets', () => {
    const copied = copyCanonicalFormula(
      formulaRawToCanonical('=@A[1]+@Source!A[1]', resolver),
      { columnId: 'source:column:3', rowId: 'source:row:3' },
      { columnId: 'destination:column:4', rowId: 'destination:row:4' },
      resolver,
      { sourceSheetId: 'source', destinationSheetId: 'destination' },
    );

    expect(copied).toEqual({
      ok: true,
      raw: `=@destination:column:2[destination:row:2]+@source!source:column:2[source:row:2]`,
    });
  });

  it('copies mixed anchors and every range endpoint using one source-to-destination delta', () => {
    const copied = copyCanonicalFormula(
      formulaRawToCanonical('=@A[1]+@$C[$1]+@Source!A[1]+@Source!$A[$1]+@A[1]:$B[2]', resolver),
      { columnId: 'source:column:2', rowId: 'source:row:2' },
      { columnId: 'destination:column:4', rowId: 'destination:row:5' },
      resolver,
      { sourceSheetId: 'source', destinationSheetId: 'destination' },
    );

    expect(copied).toEqual({
      ok: true,
      raw: '=@destination:column:3[destination:row:4]+@$destination:column:3[$destination:row:1]+@source!source:column:3[source:row:4]+@source!$source:column:1[$source:row:1]+@destination:column:3[destination:row:4]:$destination:column:2[destination:row:5]',
    });
    if (!copied.ok) throw new Error('copy should resolve');
    expect(formulaRawToDisplay(copied.raw, workbookFormulaReferenceResolver(workbook, 'destination')))
      .toBe('=@C[4]+@$C[$1]+@Source!C[4]+@Source!$A[$1]+@C[4]:$B[5]');
  });

  it('uses shared syntax recovery and preserves qualifier-adjacent formatting', () => {
    expect(formulaReferenceTokens("=SUM('broken!A1, source!B2)")).toEqual([]);
    const raw = '= @Source \n ! A[1] : B[2]';
    const canonical = formulaRawToCanonical(raw, resolver);
    expect(canonical).toBe('= @source \n ! source:column:1[source:row:1] : source:column:2[source:row:2]');
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
        raw: '=LOG10(@A[1])',
        references: ['@A[1]'],
        canonical: '=LOG10(@source:column:1[source:row:1])',
        reordered: '=LOG10(@B[2])',
      },
      {
        raw: '=A1(@A[1])',
        references: ['@A[1]'],
        canonical: '=A1(@source:column:1[source:row:1])',
        reordered: '=A1(@B[2])',
      },
      {
        raw: '=A1(LOG10(@B[2]))',
        references: ['@B[2]'],
        canonical: '=A1(LOG10(@source:column:2[source:row:2]))',
        reordered: '=A1(LOG10(@A[1]))',
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
    expect(formulaRawToCanonical('=@Missing!A[1]', resolver)).toBe('=#REF!');
    expect(formulaRawToDisplay('=@missing!source:column:1[source:row:1]', resolver)).toBe('=#REF!');
    expect(copyCanonicalFormula('=@#REF!source:column:1[source:row:1]', { columnId: 'source:column:1', rowId: 'source:row:1' }, { columnId: 'source:column:2', rowId: 'source:row:2' }, resolver)).toEqual({ ok: false, reason: 'unresolved-coordinate' });
  });

  it('does not treat canonical-looking string literals as references', () => {
    const literal = '"@source:column:1[source:row:1]"';
    expect(formulaRawToDisplay(`=${literal}+@source:column:1[source:row:1]`, resolver)).toBe(`=${literal}+@A[1]`);
    expect(formulaReferenceTokens(`=@A[1]+${literal}`).map((token) => token.endpoints[0].kind)).toEqual(['a1']);
    expect(formulaRawToCanonical(`=@A[1]+${literal}`, resolver)).toBe(`=@source:column:1[source:row:1]+${literal}`);
  });

  it('recognizes canonical endpoints only in formulaSyntax grammar contexts', () => {
    const canonical = '@source:column:1[source:row:1]';
    expect(formulaReferenceTokens(`=A1(${canonical})`).map((token) => token.endpoints[0].kind)).toEqual(['canonical']);
    expect(formulaReferenceTokens(`=SUM(${canonical}+@A[1])`).map((token) => token.endpoints[0].kind)).toEqual(['canonical', 'a1']);
    expect(formulaReferenceTokens(`=@'Other Sheet'!${canonical.slice(1)}:$source:column:2[source:row:2]`).map((token) => ({
      qualifier: token.qualifier.kind,
      kind: token.kind,
      endpoints: token.endpoints.flatMap((endpoint) => endpoint ? [endpoint.kind] : []),
    }))).toEqual([{ qualifier: 'explicit', kind: 'range', endpoints: ['canonical', 'canonical'] }]);
    expect(formulaReferenceTokens(`="${canonical}"+${canonical}`).map((token) => token.endpoints[0].kind)).toEqual(['canonical']);
    expect(formulaReferenceTokens(`=SUM(@'broken!${canonical}, @Source!${canonical})`)).toEqual([]);
  });

  it('encodes ambiguous stable sheet qualifiers without changing subtraction syntax', () => {
    const a1Named = sheetDocument({ id: 'a1-sheet', name: 'Sheet1', columnCount: 4, rowCount: 4 });
    const quoted = sheetDocument({ id: 'quoted-a1', name: 'A1', columnCount: 4, rowCount: 4 });
    const namedResolver = workbookFormulaReferenceResolver(workbookWithSheets([source, a1Named, quoted]), 'source');
    const canonical = "=@a1-sheet!a1-sheet:column:2[a1-sheet:row:2]";

    expect(formulaRawToCanonical('=@Sheet1!B[2]', namedResolver)).toBe(canonical);
    expect(formulaRawToCanonical("=@'A1'!B[2]", namedResolver)).toBe("=@quoted-a1!quoted-a1:column:2[quoted-a1:row:2]");
    expect(formulaReferenceTokens(canonical)).toMatchObject([{
      qualifier: { kind: 'explicit', sheetId: 'a1-sheet' },
      endpoints: [{ kind: 'canonical' }],
    }]);
    expect(formulaRawToDisplay(canonical, namedResolver)).toBe('=@Sheet1!B[2]');
    expect(copyCanonicalFormula(canonical, { columnId: 'a1-sheet:column:1', rowId: 'a1-sheet:row:1' }, { columnId: 'a1-sheet:column:2', rowId: 'a1-sheet:row:2' }, namedResolver, { sourceSheetId: 'a1-sheet' })).toEqual({ ok: true, raw: "=@a1-sheet!a1-sheet:column:3[a1-sheet:row:3]" });
    expect(formulaReferenceTokens("=@A[1]-@'a1-sheet'!a1-sheet:column:1[a1-sheet:row:1]").map((token) => token.qualifier.kind)).toEqual(['unqualified', 'explicit']);
  });

  it('escapes apostrophes in visible sheet qualifiers', () => {
    const apostrophe = sheetDocument({ id: 'owner-id', name: "Owner's Sheet", columnCount: 4, rowCount: 4 });
    const namedResolver = workbookFormulaReferenceResolver(workbookWithSheets([source, apostrophe]), 'source');
    const canonical = "=@owner-id!owner-id:column:1[owner-id:row:1]";

    expect(formulaRawToCanonical("=@'Owner''s Sheet'!A[1]", namedResolver)).toBe(canonical);
    expect(formulaReferenceTokens(canonical)[0]?.qualifier).toMatchObject({ kind: 'explicit', sheetId: 'owner-id' });
    expect(formulaRawToDisplay(canonical, namedResolver)).toBe("=@'Owner''s Sheet'!A[1]");
  });

  it('stores named properties by property and bound-column identity, then displays current names', () => {
    const bound = {
      ...source,
      modelId: 'budget',
      modelColumnBindings: { revenue: source.content.columns[0]!, cost: source.content.columns[1]! },
    };
    const workbookWithModel = {
      ...workbookWithSheets([bound, destination]),
      dataModels: {
        budget: {
          id: 'budget', name: 'Budget', columns: [
            { id: 'revenue', name: 'Revenue', kind: 'manual' as const, type: 'float' as const },
            { id: 'cost', name: "Owner's Cost", kind: 'manual' as const, type: 'float' as const },
          ],
        },
      },
    };
    const namedResolver = workbookFormulaReferenceResolver(workbookWithModel, source.id);
    const canonical = formulaRawToCanonical("=@'Revenue'[1]:$'Owner''s Cost'[$2]", namedResolver);

    expect(canonical).toMatch(/^=@~[0-9a-f]+~[0-9a-f]+\[[0-9a-f]+\]:\$~[0-9a-f]+~[0-9a-f]+\[\$[0-9a-f]+\]$/i);
    expect(formulaRawToDisplay(canonical, namedResolver)).toBe("=@'Revenue'[1]:$'Owner''s Cost'[$2]");

    const ordinaryCanonical = formulaRawToCanonical('=@C[1]', namedResolver);
    const storedNamedCanonical = formulaRawToCanonical("=@'Revenue'[1]", namedResolver);
    const mixedStoredRange = `${ordinaryCanonical}:${storedNamedCanonical.slice(2)}`;
    expect(formulaReferenceTokens(mixedStoredRange)).toEqual([]);
    expect(formulaRawToCanonical(mixedStoredRange, namedResolver)).toBe(mixedStoredRange);
    expect(formulaRawToDisplay(mixedStoredRange, namedResolver)).toBe(mixedStoredRange);

    const renamed = {
      ...workbookWithModel,
      dataModels: { budget: { ...workbookWithModel.dataModels.budget, columns: [
        { ...workbookWithModel.dataModels.budget.columns[1]!, name: 'Costs' },
        { ...workbookWithModel.dataModels.budget.columns[0]!, name: 'Net Revenue' },
      ] } },
    };
    expect(formulaRawToDisplay(canonical, workbookFormulaReferenceResolver(renamed, source.id)))
      .toBe("=@'Net Revenue'[1]:$'Costs'[$2]");

    const replaced = {
      ...renamed,
      dataModels: { budget: { ...renamed.dataModels.budget, columns: [
        { id: 'new-revenue', name: 'Net Revenue', kind: 'manual' as const, type: 'float' as const },
        ...renamed.dataModels.budget.columns.slice(1),
      ] } },
    };
    expect(formulaRawToDisplay(canonical, workbookFormulaReferenceResolver(replaced, source.id))).toBe('=#REF!');
  });

  it('retargets copied named endpoints to translated properties and uses canonical A1 identities for unbound columns', () => {
    const bound = {
      ...source,
      modelId: 'budget',
      modelColumnBindings: { revenue: source.content.columns[0]!, cost: source.content.columns[1]! },
    };
    const workbookWithModel = {
      ...workbookWithSheets([bound, destination]),
      dataModels: {
        budget: {
          id: 'budget', name: 'Budget', columns: [
            { id: 'revenue', name: 'Revenue', kind: 'manual' as const, type: 'float' as const },
            { id: 'cost', name: 'Cost', kind: 'manual' as const, type: 'float' as const },
          ],
        },
      },
    };
    const namedResolver = workbookFormulaReferenceResolver(workbookWithModel, source.id);
    const sourceCell = { columnId: source.content.columns[2]!, rowId: source.content.rows[2]! };
    const destinationCell = { columnId: source.content.columns[3]!, rowId: source.content.rows[3]! };

    const copiedCell = copyCanonicalFormula(formulaRawToCanonical("=@'Revenue'[1]", namedResolver), sourceCell, destinationCell, namedResolver);
    const copiedRange = copyCanonicalFormula(formulaRawToCanonical("=@'Revenue'[1]:'Cost'[2]", namedResolver), sourceCell, destinationCell, namedResolver);

    const copiedCost = formulaRawToCanonical("=@'Cost'[2]", namedResolver);
    expect(copiedCell).toEqual({ ok: true, raw: copiedCost });
    expect(copiedRange).toEqual({ ok: true, raw: `=@${source.content.columns[1]}[${source.content.rows[1]}]:${source.content.columns[2]}[${source.content.rows[2]}]` });
    if (!copiedRange.ok) throw new Error('copy should resolve');
    expect(formulaRawToDisplay(copiedRange.raw, namedResolver)).toBe('=@B[2]:C[3]');
  });

  it('round-trips arbitrary stable IDs through stored named references and reload', () => {
    const specialColumnId = 'column~ [ spaced ]';
    const specialRowId = 'row~ [ spaced ]';
    const specialPropertyId = 'property~ [ spaced ]';
    const special = {
      ...source,
      modelId: 'special-model',
      content: { ...source.content, columns: [specialColumnId, ...source.content.columns.slice(1)], rows: [specialRowId, ...source.content.rows.slice(1)] },
      modelColumnBindings: { [specialPropertyId]: specialColumnId },
    };
    const specialWorkbook = {
      ...workbookWithSheets([special, destination]),
      dataModels: {
        'special-model': {
          id: 'special-model', name: 'Special', columns: [{ id: specialPropertyId, name: 'Special', kind: 'manual' as const, type: 'float' as const }],
        },
      },
    };
    const specialResolver = workbookFormulaReferenceResolver(specialWorkbook, special.id);
    const canonical = formulaRawToCanonical("=@'Special'[1]", specialResolver);
    const reloaded = JSON.parse(JSON.stringify(specialWorkbook));

    expect(canonical).not.toContain(specialPropertyId);
    expect(canonical).not.toContain(specialColumnId);
    expect(canonical).not.toContain(specialRowId);
    expect(formulaReferenceTokens(canonical)).toMatchObject([{ endpoints: [{ kind: 'canonical', propertyId: specialPropertyId, coordinate: { columnId: specialColumnId, rowId: specialRowId } }] }]);
    expect(formulaRawToDisplay(canonical, workbookFormulaReferenceResolver(reloaded, special.id))).toBe("=@'Special'[1]");
  });
});
