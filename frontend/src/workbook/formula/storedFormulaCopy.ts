import type { Workbook } from '../core/model';
import { copyCanonicalFormula, workbookFormulaReferenceResolver, type FormulaCoordinate, type FormulaCopyContext } from './reference';
import { requireStoredFormula } from './storedFormula';

export type StoredFormulaCopyResult = { ok: true; content: string } | { ok: false; reason: 'unresolved-coordinate' };

export function copyStoredFormula(content: string, source: FormulaCoordinate, destination: FormulaCoordinate, workbook: Workbook, context: Required<FormulaCopyContext>): StoredFormulaCopyResult {
  requireStoredFormula(content);
  const result = copyCanonicalFormula(content, source, destination, workbookFormulaReferenceResolver(workbook, context.sourceSheetId), context);
  return result.ok ? { ok: true, content: result.raw } : result;
}
