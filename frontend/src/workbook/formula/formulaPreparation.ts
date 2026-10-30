import type { SheetDocument, Workbook } from '../core/model';
import { parseUserFormulaSyntax, type FormulaReferenceLexeme, type FormulaSourceSpan } from './syntax';
import { requireStoredFormula, type StoredFormulaContent } from './storedFormula';
import { escapeFormulaText } from './opaqueFormulaText';
import { formatCanonicalFormulaEndpoint } from './reference';
import { projectStoredFormula } from './storedFormulaProjection';

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

/** A model declaration supplies the row recipe even before its first output row exists. */
export function prepareModelFormulaContent(text: string, workbook: Workbook, currentSheetId: string): StoredFormulaContent {
  return prepare(text, workbook, currentSheetId, [], true);
}

function prepare(text: string, workbook: Workbook, currentSheetId: string | undefined, retained: Replacement[], modelTemplate = false): StoredFormulaContent {
  const sheetFor = (qualifier?: string) => qualifier === undefined
    ? currentSheetId === undefined ? undefined : workbook.documents[currentSheetId]
    : Object.values(workbook.documents).find((sheet) => sheet.name === qualifier);
  const propertiesFor = (sheet?: SheetDocument) => sheet?.modelId ? workbook.dataModels?.[sheet.modelId]?.columns : undefined;
  const syntax = parseUserFormulaSyntax(text, (qualifier, name) => Boolean(propertiesFor(sheetFor(qualifier))?.some((property) => property.name === name)));
  retained = retained.filter((span) => syntax.referenceLexemes.some((lexeme) => lexeme.sourceSpan.start === span.start && lexeme.sourceSpan.end === span.end));
  const replacements = [...retained];
  for (const lexeme of syntax.referenceLexemes) {
    if (retained.some((span) => span.start < lexeme.sourceSpan.end && span.end > lexeme.sourceSpan.start)) continue;
    const sheet = sheetFor(lexeme.qualifier?.value);
    const endpoints = lexeme.endpoints.map((endpoint) => bindEndpoint(endpoint, sheet, workbook, modelTemplate));
    if (sheet && endpoints.every((endpoint) => endpoint !== undefined)) {
      replacements.push({ ...lexeme.sourceSpan, text: `@${lexeme.qualifier ? `${sheet.id}!` : ''}${endpoints.join(':')}` });
    } else {
      replacements.push({ ...lexeme.sourceSpan, text: escapeFormulaText(text.slice(lexeme.sourceSpan.start, lexeme.sourceSpan.end)) });
    }
  }
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const bound = replacements.find((span) => span.start === index);
    if (bound) { index = bound.end - 1; continue; }
    if (text[index] === '"') {
      if (quoted && text[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && (text[index] === '@' || text.startsWith('~{', index))) {
      replacements.push({ start: index, end: index + 1, text: escapeFormulaText(text[index]) });
    }
  }
  return requireStoredFormula(replacements.sort((left, right) => right.start - left.start).reduce((value, span) => value.slice(0, span.start) + span.text + value.slice(span.end), text));
}

function bindEndpoint(endpoint: FormulaReferenceLexeme['endpoints'][number], sheet: SheetDocument | undefined, workbook: Workbook, modelTemplate: boolean): string | undefined {
  if (!sheet || endpoint.kind !== 'a1' && endpoint.kind !== 'named') return undefined;
  const property = endpoint.kind === 'named' && sheet.modelId ? workbook.dataModels?.[sheet.modelId]?.columns.find((property) => property.name === (endpoint.value as { propertyName: string }).propertyName) : undefined;
  const columnId = endpoint.kind === 'a1' ? sheet.content.columns[endpoint.value.columnIndex] : property && sheet.modelColumnBindings?.[property.id];
  const rowId = sheet.content.rows[endpoint.kind === 'a1' ? endpoint.value.rowIndex : endpoint.value.row - 1] ?? (modelTemplate ? 'unavailable-model-row' : undefined);
  if (!columnId || !rowId || !sheet.content.columns.includes(columnId)) return undefined;
  return formatCanonicalFormulaEndpoint({ columnId, rowId }, endpoint.anchors, property?.id);
}
