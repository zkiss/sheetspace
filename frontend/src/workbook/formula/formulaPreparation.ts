import type { SheetDocument, Workbook } from '../core/model';
import { namedColumns } from '../core/columnNames';
import { parseFormulaSyntax, type FormulaReferenceLexeme, type FormulaSourceSpan } from './syntax';
import { requireStoredFormula } from './storedFormula';
import type { StoredFormulaContent } from '../core/storedFormulaContent';
import { escapeFormulaText, opaqueFormulaText } from './opaqueFormulaText';
import { formatCanonicalFormulaEndpoint } from './reference';
import { projectStoredFormula } from './storedFormulaProjection';
import { analyzeStoredFormula } from './storedFormulaAnalysis';

type Replacement = FormulaSourceSpan & { text: string };

/** Reparse raw fragments on every explicit commit; retain unchanged canonical tokens. */
export function prepareFormulaEdit(text: string, original: StoredFormulaContent, workbook: Workbook, currentSheetId?: string): StoredFormulaContent {
  const projected = projectStoredFormula(original, workbook, currentSheetId);
  let prefix = 0;
  while (prefix < text.length && prefix < projected.text.length && text[prefix] === projected.text[prefix]) prefix++;
  let suffix = 0;
  while (suffix < text.length - prefix && suffix < projected.text.length - prefix
    && text[text.length - suffix - 1] === projected.text[projected.text.length - suffix - 1]) suffix++;
  const delta = text.length - projected.text.length;
  const retained = projected.references.flatMap(({ sourceSpan, displaySpan }): Replacement[] => {
    const start = displaySpan.end <= prefix ? displaySpan.start : displaySpan.start >= projected.text.length - suffix ? displaySpan.start + delta : -1;
    return start < 0 ? [] : [{ start, end: start + displaySpan.end - displaySpan.start, text: original.slice(sourceSpan.start, sourceSpan.end) }];
  });
  return prepare(text, workbook, currentSheetId, retained);
}

/** Literal internal-looking input has no authority to supply stored identities. */
export function prepareUserFormula(text: string, workbook: Workbook, currentSheetId?: string): StoredFormulaContent {
  return prepare(text, workbook, currentSheetId, []);
}

export function prepareFunctionBody(text: string, workbook: Workbook, currentSheetId: string, parameters: readonly string[], excludedQualifiedSheetId?: string): StoredFormulaContent {
  return prepare(text, workbook, currentSheetId, [], false, parameters, excludedQualifiedSheetId);
}

export function functionBodyReferences(text: string, content: StoredFormulaContent, workbook: Workbook, sheetId: string, parameters: readonly string[]) {
  const raw = parseFormulaSyntax(text, { referenceMode: 'user', parameters, isNamedColumn: () => true }).referenceLexemes;
  const stored = analyzeStoredFormula(content, workbook, sheetId, parameters).references.map(({ lexeme, live }) => ({ ...lexeme.sourceSpan, live }));
  const opaque = opaqueFormulaText(content);
  const replacements = [...stored.map((span) => ({ ...span, text: undefined as string | undefined })), ...opaque.map((span) => ({ ...span, live: false }))].sort((a, b) => a.start - b.start);
  let cursor = 0, rawCursor = 0;
  const mapped: { raw: FormulaSourceSpan; stored: FormulaSourceSpan; live: boolean }[] = [];
  for (const replacement of replacements) {
    rawCursor += replacement.start - cursor;
    const lexeme = raw.find((item) => item.sourceSpan.start === rawCursor);
    const length = replacement.text?.length ?? (lexeme ? lexeme.sourceSpan.end - lexeme.sourceSpan.start : 0);
    if (lexeme && length === lexeme.sourceSpan.end - lexeme.sourceSpan.start) mapped.push({ raw: lexeme.sourceSpan, stored: replacement, live: replacement.live });
    rawCursor += length;
    cursor = replacement.end;
  }
  return mapped;
}

export type ReconciliationWork = { plans: number; visits: number; comparisons: number; copied: number };

export type FunctionBodyEditPlan = { work?: ReconciliationWork; pairs: { old: FormulaSourceSpan; next: FormulaSourceSpan }[]; oldReferences: FormulaSourceSpan[] };

export function planFunctionBodyEdit(text: string, previousText: string, parameters: readonly string[], previousParameters: readonly string[], work?: ReconciliationWork): FunctionBodyEditPlan {
  if (work) work.plans++;
  const lexemes = (source: string, names: readonly string[]) => parseFormulaSyntax(source, { referenceMode: 'user', parameters: names, isNamedColumn: () => true }).referenceLexemes;
  const occurrences = new Map<string, FormulaSourceSpan[]>();
  const oldReferences = lexemes(previousText, previousParameters).map(({ sourceSpan }) => sourceSpan);
  for (const sourceSpan of oldReferences) {
    if (work) { work.visits++; work.copied += sourceSpan.end - sourceSpan.start; }
    const key = previousText.slice(sourceSpan.start, sourceSpan.end);
    const spans = occurrences.get(key) ?? [];
    spans.push(sourceSpan);
    occurrences.set(key, spans);
  }
  const cursors = new Map<string, number>();
  const pairs: FunctionBodyEditPlan['pairs'] = [];
  // Identical spellings are paired by occurrence, not by inferred edit intent.
  for (const { sourceSpan } of lexemes(text, parameters)) {
    if (work) { work.visits++; work.copied += sourceSpan.end - sourceSpan.start; }
    const key = text.slice(sourceSpan.start, sourceSpan.end);
    const index = cursors.get(key) ?? 0;
    const old = occurrences.get(key)?.[index];
    cursors.set(key, index + 1);
    if (old) pairs.push({ old, next: sourceSpan });
  }
  return { pairs, oldReferences, work };
}

export function prepareFunctionBodyEdit(text: string, previousText: string, original: StoredFormulaContent, workbook: Workbook, sheetId: string, parameters: readonly string[], previousParameters: readonly string[], excludedQualifiedSheetId?: string, plan = planFunctionBodyEdit(text, previousText, parameters, previousParameters)): StoredFormulaContent {
  const stored = parseFormulaSyntax(original, { stored: true, parameters: previousParameters }).referenceLexemes.map(({ sourceSpan }) => {
    if (plan.work) plan.work.visits++;
    return { ...sourceSpan, text: undefined as string | undefined };
  });
  const replacements = [...stored, ...opaqueFormulaText(original)].sort((a, b) => { if (plan.work) plan.work.comparisons++; return a.start - b.start; });
  const rawByStart = new Map<number, FormulaSourceSpan>();
  for (const span of plan.oldReferences) {
    if (plan.work) plan.work.visits++;
    rawByStart.set(span.start, span);
  }
  const mapped = new Map<number, FormulaSourceSpan>();
  let cursor = 0, rawCursor = 0;
  for (const replacement of replacements) {
    if (plan.work) plan.work.visits++;
    rawCursor += replacement.start - cursor;
    const lexeme = rawByStart.get(rawCursor);
    const length = replacement.text?.length ?? (lexeme ? lexeme.end - lexeme.start : 0);
    if (lexeme && length === lexeme.end - lexeme.start) mapped.set(lexeme.start, replacement);
    rawCursor += length;
    cursor = replacement.end;
  }
  const retained: Replacement[] = [];
  for (const { old, next } of plan.pairs) {
    if (plan.work) plan.work.visits++;
    const span = mapped.get(old.start);
    if (span) {
      if (plan.work) plan.work.copied += span.end - span.start;
      retained.push({ ...next, text: original.slice(span.start, span.end) });
    }
  }
  return prepare(text, workbook, sheetId, retained, false, parameters, excludedQualifiedSheetId, plan.work);
}

/** A model declaration supplies the row recipe even before its first output row exists. */
export function prepareModelFormulaContent(text: string, workbook: Workbook, currentSheetId: string): StoredFormulaContent {
  return prepare(text, workbook, currentSheetId, [], true);
}

function prepare(text: string, workbook: Workbook, currentSheetId: string | undefined, retained: Replacement[], modelTemplate = false, parameters?: readonly string[], excludedQualifiedSheetId?: string, work?: ReconciliationWork): StoredFormulaContent {
  const sheetFor = (qualifier?: string) => qualifier === undefined
    ? currentSheetId === undefined ? undefined : workbook.documents[currentSheetId]
    : Object.values(workbook.documents).find((sheet) => sheet.id !== excludedQualifiedSheetId && sheet.name === qualifier);
  const propertiesFor = (sheet?: SheetDocument) => sheet ? namedColumns(workbook, sheet) : [];
  const retainedByStart = new Map<number, Replacement>();
  for (const span of retained) {
    if (work) work.visits++;
    retainedByStart.set(span.start, span);
  }
  const retainedInOrder = [...retained].sort((a, b) => { if (work) work.comparisons++; return a.start - b.start; });
  const containsRetained = (span: FormulaSourceSpan) => {
    let low = 0, high = retainedInOrder.length;
    while (low < high) {
      if (work) work.comparisons++;
      const middle = Math.floor((low + high) / 2);
      if (retainedInOrder[middle].start <= span.start) low = middle + 1;
      else high = middle;
    }
    return low > 0 && retainedInOrder[low - 1].end >= span.end;
  };
  const syntax = parseFormulaSyntax(text, { referenceMode: 'user', parameters, isNamedColumn: (qualifier, name, span) => {
    return containsRetained(span) || propertiesFor(sheetFor(qualifier)).some((property) => property.name === name);
  } });
  const replacements: Replacement[] = [];
  for (const lexeme of syntax.referenceLexemes) {
    if (work) work.visits++;
    const retainedSpan = retainedByStart.get(lexeme.sourceSpan.start);
    if (retainedSpan && retainedSpan.end === lexeme.sourceSpan.end) { replacements.push(retainedSpan); continue; }
    const sheet = sheetFor(lexeme.qualifier?.value);
    const endpoints = lexeme.endpoints.map((endpoint) => bindEndpoint(endpoint, sheet, workbook, modelTemplate));
    if (sheet && endpoints.every((endpoint) => endpoint !== undefined)) {
      replacements.push({ ...lexeme.sourceSpan, text: `@${lexeme.qualifier ? `${sheet.id}!` : ''}${endpoints.join(':')}` });
    } else {
      replacements.push({ ...lexeme.sourceSpan, text: escapeFormulaText(text.slice(lexeme.sourceSpan.start, lexeme.sourceSpan.end)) });
    }
  }
  let quoted = false, replacementIndex = 0;
  const escapes: Replacement[] = [];
  for (let index = 0; index < text.length; index++) {
    if (work) work.visits++;
    const bound = replacements[replacementIndex];
    if (bound?.start === index) { index = bound.end - 1; replacementIndex++; continue; }
    if (text[index] === '"') {
      if (quoted && text[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && (text[index] === '@' || text.startsWith('~{', index))) {
      escapes.push({ start: index, end: index + 1, text: escapeFormulaText(text[index]) });
    }
  }
  const all = [...replacements, ...escapes].sort((a, b) => { if (work) work.comparisons++; return a.start - b.start; });
  const parts: string[] = [];
  let cursor = 0;
  for (const span of all) {
    if (work) { work.visits++; work.copied += span.start - cursor + span.text.length; }
    parts.push(text.slice(cursor, span.start), span.text); cursor = span.end;
  }
  if (work) work.copied += text.length - cursor;
  parts.push(text.slice(cursor));
  return requireStoredFormula(parts.join(''));
}

function bindEndpoint(endpoint: FormulaReferenceLexeme['endpoints'][number], sheet: SheetDocument | undefined, workbook: Workbook, modelTemplate: boolean): string | undefined {
  if (!sheet || endpoint.kind !== 'a1' && endpoint.kind !== 'named') return undefined;
  if (!endpoint.open && endpoint.rowMode !== 'positional' && (endpoint.kind === 'a1' ? endpoint.value.rowIndex : endpoint.value.row - 1) >= 2147483647) return undefined;
  const property = endpoint.kind === 'named' ? namedColumns(workbook, sheet).find((property) => property.name === (endpoint.value as { propertyName: string }).propertyName) : undefined;
  const columnId = endpoint.kind === 'a1' ? sheet.content.columns[endpoint.value.columnIndex] : property?.columnId;
  const rowIndex = endpoint.kind === 'a1' ? endpoint.value.rowIndex : endpoint.value.row - 1;
  if (columnId && sheet.content.columns.includes(columnId) && (endpoint.open || endpoint.rowMode === 'positional')) return formatCanonicalFormulaEndpoint({ columnId, rowIndex }, endpoint.anchors, property?.id, endpoint.open);
  const rowId = sheet.content.rows[rowIndex] ?? (modelTemplate ? 'unavailable-model-row' : undefined);
  if (!columnId || !rowId || !sheet.content.columns.includes(columnId)) return undefined;
  return formatCanonicalFormulaEndpoint({ columnId, rowId }, endpoint.anchors, property?.id, endpoint.open);
}
