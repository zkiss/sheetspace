import { describe, expect, it } from 'vitest';
import { formulaReferenceLexemes, parseFormulaSyntax, parseUserFormulaSyntax } from './syntax';
import { formatCanonicalFormulaEndpoint, formulaReferenceTokens } from './reference';
import { analyzeStoredFormula } from './storedFormulaAnalysis';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

describe('stored reference provenance', () => {
  const anchored = { column: true, row: false };
  const rowAnchored = { column: false, row: true };

  it.each(['column', 'B', 'column-1'])('round trips %s positional identities across all stored surfaces', (columnId) => {
    const first = formatCanonicalFormulaEndpoint({ columnId, rowIndex: 1 }, anchored);
    const second = formatCanonicalFormulaEndpoint({ columnId: 'B', rowIndex: 4 }, rowAnchored);
    for (const parts of [[first], [first, second], [second, first]]) {
      const raw = `=@'Other Sheet'!${parts.join(':')}`;
      const parsed = parseFormulaSyntax(raw, { stored: true });
      const lexemes = formulaReferenceLexemes(raw, () => true, { stored: true });
      const tokens = formulaReferenceTokens(raw, undefined, { stored: true });
      expect(parsed.result.kind).toBe('formula');
      expect(lexemes).toEqual(parsed.referenceLexemes);
      expect(tokens).toHaveLength(1);
      for (const [index, part] of parts.entries()) {
        const expected = part === first ? { columnId, rowIndex: 1 } : { columnId: 'B', rowIndex: 4 };
        const endpoint = lexemes[0].endpoints[index];
        expect(endpoint).toMatchObject({ kind: 'positional-canonical', value: expected, anchors: part === first ? anchored : rowAnchored });
        expect(endpoint.value).not.toHaveProperty('rowId');
        expect(raw.slice(endpoint.sourceSpan.start, endpoint.sourceSpan.end)).toBe(part);
        expect(tokens[0].endpoints[index]).toMatchObject({ kind: 'recipe', endpoint });
      }
    }
  });

  it.each(['row-9', '2'])('retains stable and positional peers with row identity %s in either order', (rowId) => {
    const stable = formatCanonicalFormulaEndpoint({ columnId: 'B', rowId }, anchored);
    const positional = formatCanonicalFormulaEndpoint({ columnId: 'column', rowIndex: 2 }, rowAnchored);
    for (const parts of [[stable, positional], [positional, stable]]) {
      const raw = `=@${parts.join(':')}`;
      const endpoints = formulaReferenceLexemes(raw, undefined, { stored: true })[0].endpoints;
      const tokens = formulaReferenceTokens(raw, undefined, { stored: true });
      expect(tokens).toHaveLength(1);
      expect(endpoints.map((endpoint) => raw.slice(endpoint.sourceSpan.start, endpoint.sourceSpan.end))).toEqual(parts);
      expect(endpoints[parts.indexOf(stable)]).toMatchObject({ kind: 'canonical', value: { columnId: 'B', rowId }, anchors: anchored });
      expect(endpoints[parts.indexOf(positional)]).toMatchObject({ kind: 'positional-canonical', value: { columnId: 'column', rowIndex: 2 }, anchors: rowAnchored });
      expect(tokens[0].endpoints[parts.indexOf(stable)]).toMatchObject({ kind: 'canonical', coordinate: { columnId: 'B', rowId } });
      expect(tokens[0].endpoints[parts.indexOf(positional)]).toMatchObject({ kind: 'recipe', endpoint: endpoints[parts.indexOf(positional)] });
    }
  });

  it('preserves encoded named peers and open positional endpoints', () => {
    const propertyId = 'Price';
    const stable = formatCanonicalFormulaEndpoint({ columnId: 'B', rowId: '2' }, anchored, propertyId);
    const positional = formatCanonicalFormulaEndpoint({ columnId: 'column', rowIndex: 1 }, rowAnchored, propertyId);
    const open = formatCanonicalFormulaEndpoint({ columnId: 'B', rowIndex: 0 }, anchored, propertyId, true);
    for (const parts of [[stable, positional], [positional, stable], [positional, positional], [positional, open]]) {
      const raw = `=@${parts.join(':')}`;
      const endpoints = formulaReferenceLexemes(raw, undefined, { stored: true })[0].endpoints;
      expect(formulaReferenceTokens(raw, undefined, { stored: true })).toHaveLength(1);
      expect(endpoints[0].value).toMatchObject({ propertyId });
      expect(endpoints[1].value).toMatchObject({ propertyId });
      expect(endpoints.map((endpoint) => raw.slice(endpoint.sourceSpan.start, endpoint.sourceSpan.end))).toEqual(parts);
      if (parts[1] === open) {
        expect(endpoints[1]).toMatchObject({ kind: 'open-canonical', open: true, value: { propertyId, columnId: 'B' } });
        expect(endpoints[1].value).not.toHaveProperty('rowId');
        expect(endpoints[1].value).not.toHaveProperty('rowIndex');
      }
    }
    expect(formulaReferenceLexemes(`=@${stable}:column[#2]`, undefined, { stored: true })).toEqual([]);
  });

  it('keeps public and default wrappers from claiming ambiguous identifiers as stored identities', () => {
    for (const raw of ['=@B[#2]', '=@$B[#$2]', '=@B[2]', '=@$B[$2]']) {
      expect(parseUserFormulaSyntax(raw).referenceLexemes[0].endpoints[0].kind).toBe('a1');
      expect(formulaReferenceLexemes(raw)[0].endpoints[0].kind).toBe('a1');
      expect(formulaReferenceTokens(raw)[0].endpoints[0].kind).not.toBe('canonical');
      expect(parseUserFormulaSyntax(raw, () => true).referenceLexemes[0].endpoints[0].kind).toBe('named');
    }
    expect(parseUserFormulaSyntax("=@'Unit Price'[#2]").referenceLexemes[0].endpoints[0]).toMatchObject({ kind: 'named', rowMode: 'positional', value: { propertyName: 'Unit Price', row: 2 } });
  });

  it('exposes the same positional identity through stored analysis without binding it', () => {
    const sheet = sheetDocument({ id: 'sheet-1', name: 'Sheet', rowCount: 3, columnCount: 2 });
    const raw = '=@B[#$2]';
    const analysis = analyzeStoredFormula(raw, workbookWithSheets([sheet]), sheet.id);
    expect(analysis.syntax.referenceLexemes).toEqual(formulaReferenceLexemes(raw, undefined, { stored: true }));
    expect(analysis.references[0]).toMatchObject({ live: false, lexeme: { endpoints: [{ kind: 'positional-canonical', value: { columnId: 'B', rowIndex: 1 }, anchors: { column: false, row: true } }] } });
  });
});
