import type { Workbook } from '../core/model';
import { requireStoredFormula } from './storedFormula';
import type { StoredFormulaContent } from '../core/storedFormulaContent';
import { formatCanonicalFormulaEndpoint } from './reference';
import { escapeFormulaText } from './opaqueFormulaText';
import { modelFormulaRecipes } from './modelFormulaAssociation';

/** Positional row recipes belong to the existing declaration, not current row positions. */
export function instantiateStoredModelFormula(template: StoredFormulaContent, workbook: Workbook, rowIndex: number, declaration: string, currentSheetId: string): StoredFormulaContent {
  const recipes = modelFormulaRecipes(template, declaration);
  if (!recipes) throw new Error('Stored model formula does not match declaration');
  const edits = recipes.map(({ declaration: source, stored }) => {
    const sheet = workbook.documents[stored.qualifier?.value ?? currentSheetId];
    if (!sheet) return { ...stored.sourceSpan, text: template.slice(stored.sourceSpan.start, stored.sourceSpan.end) };
    const endpoints = stored.endpoints.map((endpoint, index) => {
      const recipe = source.endpoints[index];
      if ((endpoint.kind !== 'canonical' && endpoint.kind !== 'stored-named') || (recipe.kind !== 'a1' && recipe.kind !== 'named')) throw new Error('Invalid model reference recipe');
      const baseRow = recipe.kind === 'a1' ? recipe.value.rowIndex : recipe.value.row - 1;
      const rowId = sheet.content.rows[baseRow + (recipe.anchors.row ? 0 : rowIndex)];
      return rowId ? formatCanonicalFormulaEndpoint({ columnId: endpoint.value.columnId, rowId }, endpoint.anchors, endpoint.kind === 'stored-named' ? endpoint.value.propertyId : undefined, endpoint.open) : undefined;
    });
    return { ...stored.sourceSpan, text: endpoints.every(Boolean)
      ? `@${stored.qualifier ? `${stored.qualifier.value}!` : ''}${endpoints.join(':')}`
      : escapeFormulaText(declaration.slice(source.sourceSpan.start, source.sourceSpan.end)) };
  });
  return requireStoredFormula(edits.reverse().reduce<string>((content, span) => content.slice(0, span.start) + span.text + content.slice(span.end), template));
}
