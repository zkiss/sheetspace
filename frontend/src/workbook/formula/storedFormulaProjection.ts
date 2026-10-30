import { columnIndexToLabel } from '../core/address';
import type { Workbook } from '../core/model';
import { mapFormulaProjection, type FormulaProjectionEdit, type FormulaProjectionMapping } from './formulaProjectionMap';
import { analyzeStoredFormula, type StoredFormulaAnalysis } from './storedFormulaAnalysis';
import { type FormulaSlot, type FormulaSpan, type StoredFormula } from './storedFormula';
import { formatPropertyReferenceToken, formatSheetReferenceToken } from './syntax';

export type StoredFormulaProjection = {
  text: string;
  /** Draft text plus mapped nontext lineage, suitable for subsequent edit transactions. */
  formula: StoredFormula;
  mappings: FormulaProjectionMapping[];
  analysis: StoredFormulaAnalysis;
};

export function projectStoredFormula(content: string, workbook: Workbook, currentSheetId?: string): StoredFormulaProjection {
  const analysis = analyzeStoredFormula(content, workbook, currentSheetId);
  const edits: FormulaProjectionEdit[] = [];
  const keys = new Map<FormulaSlot, FormulaSlot['key']>();
  const addEdit = (occurrenceId: string, slot: FormulaSlot, span: FormulaSpan, text: string, payload: FormulaSpan, key: FormulaSlot['key']) => {
    keys.set(slot, key);
    if (analysis.formula.text.slice(span.start, span.end) !== text) edits.push({ ...span, text, payload, occurrenceId, slotId: slot.id });
  };
  const namedEdit = (occurrenceId: string, slot: FormulaSlot, span: FormulaSpan, token: string, key: string) => {
    const quoted = token.startsWith("'");
    addEdit(occurrenceId, slot, span, token, { start: quoted ? 1 : 0, end: token.length - (quoted ? 1 : 0) }, key);
  };
  for (const reference of analysis.references) {
    const { occurrence, lexeme } = reference;
    if (!occurrence) continue;
    const slot = (id: string) => reference.slots.find((slot) => slot.slot.id === id)!;
    const sheet = slot(occurrence.sheetSlotId);
    if (sheet.live && lexeme.qualifier) namedEdit(occurrence.id, sheet.slot, lexeme.qualifier.sourceSpan, formatSheetReferenceToken(sheet.name!), sheet.name!);
    lexeme.endpoints.forEach((endpoint, index) => {
      const stored = occurrence.endpoints[index];
      const column = slot(stored.columnSlotId), row = slot(stored.rowSlotId);
      if (column.live) {
        const payload = endpoint.payloadSpans.column;
        if (column.slot.kind === 'property') {
          const quoted = analysis.formula.text[payload.start - 1] === "'";
          namedEdit(occurrence.id, column.slot, { start: payload.start - (quoted ? 1 : 0), end: payload.end + (quoted ? 1 : 0) }, formatPropertyReferenceToken(column.name!), column.name!);
        } else {
          const text = columnIndexToLabel(column.index!);
          addEdit(occurrence.id, column.slot, payload, text, { start: 0, end: text.length }, column.index!);
        }
      }
      if (row.live) {
        const span = endpoint.payloadSpans.row;
        const text = String(row.index! + 1);
        const implicit = span.start === span.end;
        if (!implicit || row.index !== 0) addEdit(occurrence.id, row.slot, span, implicit ? `[${text}]` : text, { start: implicit ? 1 : 0, end: text.length + (implicit ? 1 : 0) }, row.index! + 1);
      }
    });
  }
  const mapped = mapFormulaProjection(analysis.formula, edits);
  const formula = { ...mapped.formula, occurrences: mapped.formula.occurrences.map((occurrence, index) => ({
    ...occurrence, endpoints: occurrence.endpoints.map((endpoint) => ({ ...endpoint, anchors: { ...endpoint.anchors } })),
    slots: occurrence.slots.map((slot, slotIndex) => ({ ...slot, key: keys.get(analysis.formula.occurrences[index].slots[slotIndex]) ?? slot.key, targetIds: [...slot.targetIds] })),
  })) };
  return { text: formula.text, formula, mappings: mapped.mappings, analysis };
}
