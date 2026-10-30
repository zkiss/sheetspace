import { opaqueFormulaText, maskOpaqueFormulaText } from './opaqueFormulaText';
import { parseFormulaSyntax, parseUserFormulaSyntax, type FormulaReferenceLexeme } from './syntax';

export type ModelReferenceRecipe = { declaration: FormulaReferenceLexeme; stored: FormulaReferenceLexeme };
export type ModelReferenceAssociation = { declaration: FormulaReferenceLexeme; stored?: FormulaReferenceLexeme; opaque?: { start: number; end: number } };

/** Associate an existing declaration with canonical tokens without persisting source spelling. */
export function modelFormulaRecipes(content: string, declaration: string): ModelReferenceRecipe[] | undefined {
  return modelFormulaAssociations(content, declaration)?.flatMap(({ declaration: reference, stored }) => stored ? [{ declaration: reference, stored }] : []);
}

export function modelFormulaAssociations(content: string, declaration: string): ModelReferenceAssociation[] | undefined {
  const canonical = parseFormulaSyntax(maskOpaqueFormulaText(content)).referenceLexemes.filter((lexeme) => lexeme.endpoints.every((endpoint) => endpoint.kind === 'canonical' || endpoint.kind === 'stored-named'));
  const raw = opaqueFormulaText(content);
  const decode = (start: number, end: number) => raw.filter((span) => span.start >= start && span.end <= end).reduceRight((text, span) => text.slice(0, span.start - start) + span.text + text.slice(span.end - start), content.slice(start, end));
  const references = parseUserFormulaSyntax(declaration, () => true).referenceLexemes;
  const recipes: ModelReferenceAssociation[] = [];
  let sourceCursor = 0, storedCursor = 0, canonicalIndex = 0;
  for (const reference of references) {
    const gap = declaration.slice(sourceCursor, reference.sourceSpan.start);
    const next = canonical[canonicalIndex];
    if (next && decode(storedCursor, next.sourceSpan.start) === gap) {
      if (reference.endpoints.length !== next.endpoints.length || Boolean(reference.qualifier) !== Boolean(next.qualifier)
        || reference.endpoints.some((endpoint, index) => endpoint.anchors.column !== next.endpoints[index].anchors.column || endpoint.anchors.row !== next.endpoints[index].anchors.row)) return undefined;
      recipes.push({ declaration: reference, stored: next });
      storedCursor = next.sourceSpan.end;
      canonicalIndex++;
    } else {
      let end = storedCursor;
      while (end <= content.length && decode(storedCursor, end).length < gap.length) end = raw.find((span) => span.start === end)?.end ?? end + 1;
      if (end > content.length || decode(storedCursor, end) !== gap) return undefined;
      const start = end;
      const expected = declaration.slice(reference.sourceSpan.start, reference.sourceSpan.end);
      while (end <= content.length && decode(start, end).length < expected.length) end = raw.find((span) => span.start === end)?.end ?? end + 1;
      if (end > content.length) return undefined;
      if (decode(start, end) !== expected) return undefined;
      recipes.push({ declaration: reference, opaque: { start, end } });
      storedCursor = end;
    }
    sourceCursor = reference.sourceSpan.end;
  }
  return canonicalIndex === canonical.length && decode(storedCursor, content.length) === declaration.slice(sourceCursor) ? recipes : undefined;
}
