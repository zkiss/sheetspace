import type { Workbook } from '../core/model';
import { namedColumns } from '../core/columnNames';
import { formatPropertyReferenceToken, parseUserFormulaSyntax } from './syntax';
import { modelFormulaAssociations } from './modelFormulaAssociation';
import { escapeFormulaText } from './opaqueFormulaText';
import type { ModelFormulaBindings } from '../core/modelFormula';
import type { StoredFormulaContent } from '../core/storedFormulaContent';

export type FormulaNameEdit = { start: number; end: number; text: string };

export function applyFormulaNameEdits(text: string, edits: readonly FormulaNameEdit[]): string {
  return [...edits].sort((a, b) => b.start - a.start).reduce((value, edit) => value.slice(0, edit.start) + edit.text + value.slice(edit.end), text);
}

export function projectOpaqueModelTemplate(content: string, declaration: string, edits: readonly FormulaNameEdit[]): string {
  const associations = modelFormulaAssociations(content, declaration);
  if (!associations) throw new Error('Invalid model formula association');
  const replacements: FormulaNameEdit[] = [];
  for (const association of associations) {
    const span = association.declaration.sourceSpan;
    const matching = edits.filter((edit) => edit.start >= span.start && edit.end <= span.end);
    if (!matching.length || !association.opaque) continue;
    const source = declaration.slice(span.start, span.end);
    const relative = matching.map((edit) => ({ ...edit, start: edit.start - span.start, end: edit.end - span.start }));
    replacements.push({ ...association.opaque, text: escapeFormulaText(applyFormulaNameEdits(source, relative)) });
  }
  return applyFormulaNameEdits(content, replacements);
}

export type ModelFormulaEditPlan = Readonly<Record<string, Readonly<Record<string, { declaration: string; edits: readonly FormulaNameEdit[] }>>>>;

export function projectRenamedModelFormulas(before: Workbook, after: Workbook, receivePlans?: (plans: ModelFormulaEditPlan) => void): Workbook {
  const plans: Record<string, Record<string, { declaration: string; edits: FormulaNameEdit[] }>> = {};
  const models = Object.fromEntries(Object.entries(after.dataModels ?? {}).map(([id, model]) => {
    const previous = before.dataModels?.[id];
    const resolve = (qualifier: string | undefined, name: string) => {
      if (!qualifier) {
        const property = previous?.columns.find((item) => item.name === name);
        return property && model.columns.find((item) => item.id === property.id)?.name;
      }
      const sheet = Object.values(before.documents).find((item) => item.name === qualifier);
      const nextSheet = sheet && after.documents[sheet.id];
      const target = sheet && namedColumns(before, sheet).find((item) => item.name === name);
      return target && nextSheet && namedColumns(after, nextSheet).find((item) => item.columnId === target.columnId && item.id === target.id)?.name;
    };
    return [id, { ...model, columns: model.columns.map((property) => {
      if (property.kind !== 'calculated') return property;
      const old = previous?.columns.find((item) => item.id === property.id);
      if (old?.kind !== 'calculated' || old.formula !== property.formula) return property;
      const syntax = parseUserFormulaSyntax(old.formula, (qualifier, name) => resolve(qualifier, name) !== undefined);
      const edits = syntax.referenceLexemes.flatMap((lexeme) => lexeme.endpoints.flatMap((endpoint) => {
        if (endpoint.kind !== 'named') return [];
        const name = resolve(lexeme.qualifier?.value, endpoint.value.propertyName);
        return name && name !== endpoint.value.propertyName ? [{ ...endpoint.payloadSpans.column, text: formatPropertyReferenceToken(name) }] : [];
      }));
      if (!edits.length) return property;
      (plans[id] ??= {})[property.id] = { declaration: old.formula, edits };
      return { ...property, formula: applyFormulaNameEdits(old.formula, edits) };
    }) }];
  }));
  receivePlans?.(plans);
  let documents = after.documents;
  for (const sheet of Object.values(after.documents)) {
    if (!sheet.modelId || !sheet.modelFormulaBindings) continue;
    const bindings = projectRenamedBindings(sheet.modelFormulaBindings, plans[sheet.modelId]);
    if (bindings !== sheet.modelFormulaBindings) documents = { ...documents, [sheet.id]: { ...sheet, modelFormulaBindings: bindings } };
  }
  return { ...after, dataModels: models, documents };
}

export function projectRenamedBindings(bindings: ModelFormulaBindings, plans: ModelFormulaEditPlan[string] | undefined): ModelFormulaBindings {
  if (!plans) return bindings;
  let result = bindings;
  for (const [id, plan] of Object.entries(plans)) {
    const binding = bindings[id];
    if (!binding) continue;
    const content = projectOpaqueModelTemplate(binding.content, plan.declaration, plan.edits) as StoredFormulaContent;
    if (content !== binding.content) result = { ...result, [id]: { ...binding, content } };
  }
  return result;
}
