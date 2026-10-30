import type { SheetDocument, Workbook } from '../core/model';
import { decodeStoredFormula, type FormulaOccurrence, type FormulaSlot, type StoredFormula } from './storedFormula';
import { mergeFormulaDiagnostics, parseUserFormulaSyntax, type FormulaDiagnostic, type FormulaExpression, type FormulaParseResult, type FormulaReference, type FormulaReferenceLexeme, type FormulaSourceSpan, type FormulaSyntaxResult } from './syntax';

export type StoredSlotAnalysis = { slot: FormulaSlot; live: boolean; index?: number; name?: string };
export type StoredReferenceAnalysis = {
  lexeme: FormulaReferenceLexeme;
  occurrence?: FormulaOccurrence;
  sheet?: SheetDocument;
  slots: StoredSlotAnalysis[];
  reference?: Extract<FormulaReference, { kind: 'canonical' }>;
  live: boolean;
};
export type StoredFormulaAnalysis = {
  formula: StoredFormula;
  syntax: FormulaSyntaxResult;
  references: StoredReferenceAnalysis[];
  dormantOccurrences: FormulaOccurrence[];
  result: FormulaParseResult;
  diagnostics: FormulaDiagnostic[];
};

/** Explicit trusted-content API. Names and spelling never grant identity on a read. */
export function analyzeStoredFormula(content: string, workbook: Workbook, currentSheetId?: string): StoredFormulaAnalysis {
  // Effective sheets were captured at input; absent or changed caller context cannot rebind them.
  void currentSheetId;
  return analyzeDecodedStoredFormula(decodeStoredFormula(content), workbook);
}

function analyzeDecodedStoredFormula(formula: StoredFormula, workbook: Workbook): StoredFormulaAnalysis {
  // Persisted property keys keep user grammar recognizable even after a declaration is deleted.
  const syntax = parseUserFormulaSyntax(formula.text, (_qualifier, name, payloadSpan) => formula.occurrences.some((occurrence) =>
    occurrence.slots.some((slot) => slot.kind === 'property' && slot.key === name && ownsPayload(occurrence, slot.id, payloadSpan))));
  const references = syntax.referenceLexemes.map((lexeme): StoredReferenceAnalysis => {
    const occurrence = formula.occurrences.find((candidate) => alignedOccurrence(candidate, lexeme));
    if (!occurrence) return { lexeme, slots: [], live: false };
    const sheetSlot = occurrence.slots.find((slot) => slot.id === occurrence.sheetSlotId)!;
    const sheet = sheetSlot.status === 'retained' ? workbook.documents[sheetSlot.targetIds[0]] : undefined;
    const slots = occurrence.slots.map((slot) => analyzeSlot(slot, sheet, workbook));
    const reference = canonicalReference(occurrence, lexeme);
    return { lexeme, occurrence, sheet, slots, reference, live: Boolean(reference) && slots.every((slot) => slot.live) };
  });
  const dormantOccurrences = formula.occurrences.filter((occurrence) => !references.some((reference) => reference.occurrence === occurrence));
  const diagnostics = mergeFormulaDiagnostics(syntax.diagnostics, [
    ...references.filter((reference) => !reference.live).map(({ lexeme }) => ({ kind: 'reference' as const, code: '#REF!' as const, sourceSpan: lexeme.sourceSpan })),
    ...dormantOccurrences.map(({ guard }) => ({ kind: 'syntax' as const, code: '#PARSE!' as const, sourceSpan: guard })),
  ]);
  let result = syntax.result;
  if (result.kind === 'formula') {
    if (dormantOccurrences.length) result = { kind: 'error', raw: formula.text, error: '#PARSE!' };
    else result = { ...result, expression: overlayExpression(result.expression, references) };
  }
  return { formula, syntax, references, dormantOccurrences, result, diagnostics };
}

function alignedOccurrence(occurrence: FormulaOccurrence, lexeme: FormulaReferenceLexeme): boolean {
  if (!sameSpan(occurrence.guard, lexeme.sourceSpan) || occurrence.endpoints.length !== lexeme.endpoints.length) return false;
  if (!occurrence.origins.some((origin) => origin.slotId === null && origin.start === lexeme.sourceSpan.start && origin.end > origin.start)) return false;
  const matches = (id: string, kind: FormulaSlot['kind'], key: FormulaSlot['key'], span: FormulaSourceSpan) => {
    const slot = occurrence.slots.find((slot) => slot.id === id);
    return slot?.kind === kind && slot.key === key && ownsPayload(occurrence, id, span);
  };
  const qualifierSpan = lexeme.qualifier?.payloadSpan ?? { start: lexeme.sourceSpan.start, end: lexeme.sourceSpan.start };
  if (!matches(occurrence.sheetSlotId, 'sheet', lexeme.qualifier?.value ?? null, qualifierSpan)) return false;
  const usedSlots = new Set([occurrence.sheetSlotId]);
  const endpointsMatch = lexeme.endpoints.every((endpoint, index) => {
    const stored = occurrence.endpoints[index];
    if (endpoint.kind !== 'a1' && endpoint.kind !== 'named') return false;
    usedSlots.add(stored.columnSlotId); usedSlots.add(stored.rowSlotId);
    return matches(stored.columnSlotId, endpoint.kind === 'a1' ? 'column' : 'property', endpoint.kind === 'a1' ? endpoint.value.columnIndex : endpoint.value.propertyName, endpoint.payloadSpans.column)
      && matches(stored.rowSlotId, 'row', endpoint.kind === 'a1' ? endpoint.value.rowIndex + 1 : endpoint.value.row, endpoint.payloadSpans.row);
  });
  return endpointsMatch && occurrence.slots.every((slot) => usedSlots.has(slot.id));
}

function ownsPayload(occurrence: FormulaOccurrence, id: string, span: FormulaSourceSpan): boolean {
  const origins = occurrence.origins.filter((origin) => origin.slotId === id);
  let cursor = span.start;
  for (const origin of origins) {
    if (origin.start !== cursor || origin.end > span.end) return false;
    cursor = origin.end;
  }
  return origins.length > 0 && cursor === span.end;
}

function sameSpan(left: FormulaSourceSpan, right: FormulaSourceSpan): boolean { return left.start === right.start && left.end === right.end; }

function analyzeSlot(slot: FormulaSlot, sheet: SheetDocument | undefined, workbook: Workbook): StoredSlotAnalysis {
  if (slot.status !== 'retained' || !sheet) return { slot, live: false };
  if (slot.kind === 'sheet') return { slot, live: true, name: sheet.name };
  if (slot.kind === 'row' || slot.kind === 'column') {
    const index = (slot.kind === 'row' ? sheet.content.rows : sheet.content.columns).indexOf(slot.targetIds[0]);
    return { slot, live: index >= 0, ...(index >= 0 ? { index } : {}) };
  }
  const property = sheet.modelId && workbook.dataModels?.[sheet.modelId]?.columns.find((property) => property.id === slot.targetIds[0]);
  const index = sheet.content.columns.indexOf(slot.targetIds[1]);
  const live = Boolean(property && index >= 0 && sheet.modelColumnBindings?.[slot.targetIds[0]] === slot.targetIds[1]);
  return { slot, live, ...(live && property ? { index, name: property.name } : {}) };
}

function canonicalReference(occurrence: FormulaOccurrence, lexeme: FormulaReferenceLexeme): StoredReferenceAnalysis['reference'] {
  const slot = (id: string) => occurrence.slots.find((slot) => slot.id === id)!;
  if (occurrence.slots.some((slot) => slot.status !== 'retained')) return undefined;
  const endpoints = occurrence.endpoints.map((endpoint) => ({
    coordinate: { columnId: slot(endpoint.columnSlotId).targetIds[slot(endpoint.columnSlotId).kind === 'property' ? 1 : 0], rowId: slot(endpoint.rowSlotId).targetIds[0] },
    propertyId: slot(endpoint.columnSlotId).kind === 'property' ? slot(endpoint.columnSlotId).targetIds[0] : undefined,
  }));
  const [first, second] = endpoints;
  return {
    kind: 'canonical', sheetId: slot(occurrence.sheetSlotId).targetIds[0], coordinate: first.coordinate,
    ...(first.propertyId ? { propertyId: first.propertyId } : {}), sourceSpan: lexeme.sourceSpan,
    ...(lexeme.qualifier ? { sheetReferenceSpan: lexeme.qualifier.sourceSpan } : {}),
    ...(second ? { range: { start: first.coordinate, end: second.coordinate, ...(first.propertyId ? { startPropertyId: first.propertyId } : {}), ...(second.propertyId ? { endPropertyId: second.propertyId } : {}) } } : {}),
  };
}

function overlayExpression(expression: FormulaExpression, references: StoredReferenceAnalysis[]): FormulaExpression {
  switch (expression.kind) {
    case 'cell': case 'range': case 'named': case 'canonical':
      {
        const reference = references.find(({ lexeme }) => sameSpan(lexeme.sourceSpan, expression.sourceSpan));
        return reference?.live && reference.reference ? reference.reference : { kind: 'invalid-reference', sourceSpan: expression.sourceSpan };
      }
    case 'group': return { ...expression, expression: overlayExpression(expression.expression, references) };
    case 'unary': return { ...expression, operand: overlayExpression(expression.operand, references) };
    case 'binary': return { ...expression, left: overlayExpression(expression.left, references), right: overlayExpression(expression.right, references) };
    case 'function': return { ...expression, arguments: expression.arguments.map((argument) => overlayExpression(argument, references)) };
    default: return expression;
  }
}
