import type { SheetDocument, Workbook } from '../core/model';
import { parseUserFormulaSyntax, type FormulaReferenceLexeme, type FormulaSourceSpan } from './syntax';
import { decodeStoredFormula, encodeStoredFormula, type FormulaOccurrence, type FormulaOrigin, type FormulaSlot, type StoredFormulaContent } from './storedFormula';
import { projectStoredFormula } from './storedFormulaProjection';

/** Prepare an editor draft, retaining unchanged projected reference occurrences where possible. */
export function prepareFormulaEdit(text: string, original: StoredFormulaContent, workbook: Workbook, currentSheetId?: string): StoredFormulaContent {
  const projected = projectStoredFormula(original, workbook, currentSheetId);
  if (text === projected.text) return original;
  const prepared = decodeStoredFormula(prepareUserFormula(text, workbook, currentSheetId));
  let prefix = 0;
  while (prefix < text.length && prefix < projected.text.length && text[prefix] === projected.text[prefix]) prefix++;
  let suffix = 0;
  while (suffix < text.length - prefix && suffix < projected.text.length - prefix
    && text[text.length - suffix - 1] === projected.text[projected.text.length - suffix - 1]) suffix++;
  const delta = text.length - projected.text.length;
  prepared.occurrences = prepared.occurrences.map((occurrence) => {
    const { start, end } = occurrence.guard;
    const oldStart = end <= prefix ? start : start >= text.length - suffix ? start - delta : -1;
    const oldEnd = oldStart + end - start;
    const previous = projected.formula.occurrences.find((candidate) => candidate.guard.start === oldStart && candidate.guard.end === oldEnd);
    if (!previous || previous.slots.length !== occurrence.slots.length
      || previous.slots.some((slot, index) => slot.id !== occurrence.slots[index].id || slot.kind !== occurrence.slots[index].kind)) return occurrence;
    return { ...occurrence, slots: previous.slots.map((slot) => ({ ...slot, targetIds: [...slot.targetIds] })) };
  });
  return encodeStoredFormula(prepared);
}

/** A fresh-input boundary. Even exact serialized spellings are treated as user text. */
export function prepareUserFormula(text: string, workbook: Workbook, currentSheetId?: string): StoredFormulaContent {
  const sheetFor = (qualifier?: string) => qualifier === undefined
    ? currentSheetId === undefined ? undefined : workbook.documents[currentSheetId]
    : Object.values(workbook.documents).find((sheet) => sheet.name === qualifier);
  const propertiesFor = (sheet?: SheetDocument) => sheet?.modelId ? workbook.dataModels?.[sheet.modelId]?.columns : undefined;
  const syntax = parseUserFormulaSyntax(text, (qualifier, name) => Boolean(propertiesFor(sheetFor(qualifier))?.some((property) => property.name === name)));
  const occurrences = syntax.referenceLexemes.map((lexeme, index): FormulaOccurrence => {
    const sheet = sheetFor(lexeme.qualifier?.value);
    const slots: FormulaSlot[] = [slot('sheet', 'sheet', lexeme.qualifier?.value ?? null, sheet ? [sheet.id] : [])];
    const payloads: FormulaOrigin[] = [{ ...(lexeme.qualifier?.payloadSpan ?? { start: lexeme.sourceSpan.start, end: lexeme.sourceSpan.start }), slotId: 'sheet' }];
    const endpoints = lexeme.endpoints.map((endpoint, index) => {
      const { columnKey, rowKey, kind } = endpointKeys(endpoint);
      const columnSlotId = `c${index}`, rowSlotId = `r${index}`;
      const property = kind === 'property' ? propertiesFor(sheet)?.find((property) => property.name === columnKey) : undefined;
      const columnId = kind === 'column' ? sheet?.content.columns[columnKey as number] : property && sheet?.modelColumnBindings?.[property.id];
      const columnTargets = columnId && sheet?.content.columns.includes(columnId) ? property ? [property.id, columnId] : [columnId] : [];
      const rowId = sheet?.content.rows[rowKey - 1];
      slots.push(slot(columnSlotId, kind, columnKey, columnTargets), slot(rowSlotId, 'row', rowKey, rowId ? [rowId] : []));
      payloads.push({ ...endpoint.payloadSpans.column, slotId: columnSlotId }, { ...endpoint.payloadSpans.row, slotId: rowSlotId });
      return { id: `e${index}`, columnSlotId, rowSlotId, anchors: endpoint.anchors };
    });
    return { id: `f${index}`, guard: lexeme.sourceSpan, sheetSlotId: 'sheet', endpoints, slots, origins: referenceOrigins(lexeme.sourceSpan, payloads) };
  });
  return encodeStoredFormula({ text, occurrences });
}

function slot(id: string, kind: FormulaSlot['kind'], key: FormulaSlot['key'], targetIds: string[]): FormulaSlot {
  return { id, kind, key, status: targetIds.length ? 'retained' : 'unresolved', targetIds };
}

function endpointKeys(endpoint: FormulaReferenceLexeme['endpoints'][number]): { kind: 'column' | 'property'; columnKey: string | number; rowKey: number } {
  if (endpoint.kind === 'a1') return { kind: 'column', columnKey: endpoint.value.columnIndex, rowKey: endpoint.value.rowIndex + 1 };
  if (endpoint.kind === 'named') return { kind: 'property', columnKey: endpoint.value.propertyName, rowKey: endpoint.value.row };
  throw new Error('User syntax cannot supply stored reference identities');
}

function referenceOrigins(guard: FormulaSourceSpan, payloads: FormulaOrigin[]): FormulaOrigin[] {
  const origins: FormulaOrigin[] = [];
  let cursor = guard.start;
  for (const payload of payloads.sort((left, right) => left.start - right.start || left.end - right.end || left.slotId!.localeCompare(right.slotId!))) {
    if (cursor < payload.start) origins.push({ start: cursor, end: payload.start, slotId: null });
    origins.push(payload);
    cursor = payload.end;
  }
  if (cursor < guard.end) origins.push({ start: cursor, end: guard.end, slotId: null });
  return origins;
}
