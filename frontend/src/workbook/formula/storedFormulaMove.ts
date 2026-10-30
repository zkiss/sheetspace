import type { Workbook } from '../core/model';
import { moveCanonicalFormula, workbookFormulaReferenceResolver, type FormulaMoveMapping } from './reference';
import { requireStoredFormula } from './storedFormula';

export type StoredFormulaMoveResult = { ok: true; content: string } | { ok: false; reason: 'unrepresentable-range' };

export function moveStoredFormula(content: string, workbook: Workbook, currentSheetId: string, destinationSheetId = currentSheetId, mappings: readonly FormulaMoveMapping[] = []): StoredFormulaMoveResult {
  requireStoredFormula(content);
  const result = moveCanonicalFormula(content, workbookFormulaReferenceResolver(workbook, currentSheetId), destinationSheetId, mappings);
  return result.ok ? { ok: true, content: result.raw } : result;
}
