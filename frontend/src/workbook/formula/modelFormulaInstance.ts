import type { Workbook } from '../core/model';
import { decodeStoredFormula, encodeStoredFormula, type StoredFormulaContent } from './storedFormula';

/** Instantiate positional row recipes without changing the template's expression or other identities. */
export function instantiateStoredModelFormula(template: StoredFormulaContent, workbook: Workbook, rowIndex: number): StoredFormulaContent {
  const formula = decodeStoredFormula(template);
  for (const occurrence of formula.occurrences) {
    const sheetSlot = occurrence.slots.find((slot) => slot.id === occurrence.sheetSlotId)!;
    const sheet = sheetSlot.status === 'retained' ? workbook.documents[sheetSlot.targetIds[0]] : undefined;
    if (!sheet) continue;
    for (const endpoint of occurrence.endpoints) {
      const rowSlot = occurrence.slots.find((slot) => slot.id === endpoint.rowSlotId)!;
      if (typeof rowSlot.key !== 'number') continue;
      const index = rowSlot.key - 1 + (endpoint.anchors.row ? 0 : rowIndex);
      const rowId = sheet.content.rows[index];
      rowSlot.status = rowId ? 'retained' : 'unresolved';
      rowSlot.targetIds = rowId ? [rowId] : [];
    }
  }
  return encodeStoredFormula(formula);
}
