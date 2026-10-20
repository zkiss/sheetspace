import type { Workbook } from '@workbook/core/model';
import { cellIdentityFromKey } from '@workbook/core/cellIdentity';
import { bindModelFormulas, instantiateModelFormulas } from '@workbook/formula/modelTemplate';
import type { CellPersistenceWrite } from './userActions';

/** Reinstantiate from declarations, never from an editable row, after backend axis reconciliation. */
export function refreshAppendedModelRows(workbook: Workbook): { nextWorkbook: Workbook; writes: CellPersistenceWrite[] } {
  let nextWorkbook = workbook;
  const writes: CellPersistenceWrite[] = [];
  for (const sheet of Object.values(workbook.documents)) {
    if (!sheet.modelId) continue;
    const bindings = { ...bindModelFormulas(workbook, sheet.id), ...sheet.modelFormulaBindings };
    const refreshed = instantiateModelFormulas(workbook, sheet.id, bindings);
    for (const [key, raw] of Object.entries(refreshed.content.cells)) {
      const beforeRaw = sheet.content.cells[key] ?? null;
      if (raw !== beforeRaw) writes.push({ sheetId: sheet.id, ...cellIdentityFromKey(key)!, beforeRaw, afterRaw: raw });
    }
    nextWorkbook = { ...nextWorkbook, documents: { ...nextWorkbook.documents, [sheet.id]: { ...refreshed, modelFormulaBindings: bindings } } };
  }
  return { nextWorkbook, writes };
}
