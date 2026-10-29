import { columnIndexToLabel } from '../core/address';
import type { Workbook } from '../core/model';
import { mapFormulaProjection, type FormulaProjectionEdit } from './formulaProjectionMap';
import { encodeStoredFormula, type FormulaSlot, type FormulaSpan } from './storedFormula';
import { analyzeStoredFormula, type StoredReferenceAnalysis } from './storedFormulaAnalysis';
import { formatPropertyReferenceToken, formatSheetReferenceToken } from './syntax';

/** Source-owned semantic edits: no input preparation, lookup by spelling, or rebinding. */
export function storedFormulaTransform(content: string, workbook: Workbook) {
  const analysis = analyzeStoredFormula(content, workbook);
  const edits: FormulaProjectionEdit[] = [];
  const replacements = new Map<FormulaSlot, FormulaSlot>();
  const replace = (reference: StoredReferenceAnalysis, slot: FormulaSlot, span: FormulaSpan, text: string, payload: FormulaSpan, next: FormulaSlot) => {
    replacements.set(slot, next);
    if (analysis.formula.text.slice(span.start, span.end) !== text) edits.push({ ...span, text, payload, occurrenceId: reference.occurrence!.id, slotId: slot.id });
  };
  const named = (reference: StoredReferenceAnalysis, slot: FormulaSlot, span: FormulaSpan, token: string, next: FormulaSlot) => {
    const quote = token.startsWith("'") ? 1 : 0;
    replace(reference, slot, span, token, { start: quote, end: token.length - quote }, next);
  };
  return {
    analysis,
    sheet(reference: StoredReferenceAnalysis, sheetId: string, qualify: boolean) {
      const slot = reference.slots.find(({ slot }) => slot.id === reference.occurrence!.sheetSlotId)!.slot;
      if (slot.targetIds[0] === sheetId && (!qualify || reference.lexeme.qualifier)) return;
      const name = workbook.documents[sheetId].name;
      const next = { ...slot, key: qualify ? name : null, targetIds: [sheetId] };
      if (!qualify) { replacements.set(slot, next); return; }
      const token = formatSheetReferenceToken(name);
      if (reference.lexeme.qualifier) named(reference, slot, reference.lexeme.qualifier.sourceSpan, token, next);
      else {
        const start = reference.lexeme.sourceSpan.start;
        const quote = token.startsWith("'") ? 1 : 0;
        replace(reference, slot, { start, end: start + 1 }, `@${token}!`, { start: 1 + quote, end: 1 + token.length - quote }, next);
      }
    },
    column(reference: StoredReferenceAnalysis, index: number, sheetId: string, columnId: string, property?: { propertyId: string; name: string }) {
      const endpoint = reference.lexeme.endpoints[index];
      const slot = reference.slots.find(({ slot }) => slot.id === reference.occurrence!.endpoints[index].columnSlotId)!.slot;
      const ids = property ? [property.propertyId, columnId] : [columnId];
      if (slot.targetIds.length === ids.length && slot.targetIds.every((id, index) => id === ids[index])) return;
      const key = property ? property.name : workbook.documents[sheetId].content.columns.indexOf(columnId);
      const next: FormulaSlot = { ...slot, kind: property ? 'property' : 'column', key, targetIds: ids };
      const span = endpoint.payloadSpans.column;
      const quoted = analysis.formula.text[span.start - 1] === "'";
      named(reference, slot, { start: span.start - (quoted ? 1 : 0), end: span.end + (quoted ? 1 : 0) }, property ? formatPropertyReferenceToken(property.name) : columnIndexToLabel(key as number), next);
    },
    row(reference: StoredReferenceAnalysis, index: number, sheetId: string, rowId: string | undefined, requireExplicit = false) {
      const endpoint = reference.lexeme.endpoints[index];
      const slot = reference.slots.find(({ slot }) => slot.id === reference.occurrence!.endpoints[index].rowSlotId)!.slot;
      const span = endpoint.payloadSpans.row;
      const implicit = span.start === span.end;
      if ((!rowId || slot.targetIds[0] === rowId) && !(implicit && requireExplicit)) return;
      const key = rowId ? workbook.documents[sheetId].content.rows.indexOf(rowId) + 1 : slot.key;
      const text = String(key);
      replace(reference, slot, span, implicit ? `[${text}]` : text, { start: implicit ? 1 : 0, end: text.length + (implicit ? 1 : 0) }, rowId ? { ...slot, key, targetIds: [rowId] } : slot);
    },
    finish() {
      if (!edits.length && [...replacements].every(([slot, next]) => JSON.stringify(slot) === JSON.stringify(next))) return content;
      const mapped = mapFormulaProjection(analysis.formula, edits).formula;
      mapped.occurrences = mapped.occurrences.map((occurrence, index) => ({ ...occurrence, slots: occurrence.slots.map((slot, slotIndex) => replacements.get(analysis.formula.occurrences[index].slots[slotIndex]) ?? slot) }));
      return encodeStoredFormula(mapped);
    },
  };
}
