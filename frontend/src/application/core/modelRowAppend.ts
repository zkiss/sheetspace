import type { RowId, SheetId, Workbook } from '@workbook/core/model';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { instantiateModelFormula } from '@workbook/formula/modelTemplate';

/**
 * Mirrors the derived contents that the backend materializes for an appended row.
 *
 * The append route owns that calculation and persists it, so the frontend only reflects
 * the derived instance locally. A protected write is never sent on the ordinary route,
 * and a property without a persisted template keeps its cell untouched.
 */
export function materializeAppendedModelRow(workbook: Workbook, sheetId: SheetId, rowId: RowId): Workbook {
  const sheet = workbook.documents[sheetId];
  const model = sheet?.modelId === undefined ? undefined : workbook.dataModels?.[sheet.modelId];
  const templates = sheet?.modelFormulaBindings;
  if (!sheet || !model || !templates) return workbook;
  const rowIndex = sheet.content.rows.indexOf(rowId);
  if (rowIndex < 0) return workbook;
  const cells = { ...sheet.content.cells };
  let changed = false;
  for (const property of model.columns) {
    if (property.kind !== 'calculated') continue;
    const columnId = sheet.modelColumnBindings?.[property.id];
    const template = templates[property.id];
    if (!columnId || !template || !sheet.content.columns.includes(columnId)) continue;
    const key = cellIdentityKey({ rowId, columnId });
    const raw = instantiateModelFormula(template, workbook, rowIndex, property.formula, sheetId);
    if (cells[key] === raw) continue;
    cells[key] = raw;
    changed = true;
  }
  if (!changed) return workbook;
  return { ...workbook, documents: { ...workbook.documents, [sheetId]: { ...sheet, content: { ...sheet.content, cells } } } };
}
