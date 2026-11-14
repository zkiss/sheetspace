import { cellIdentityFromKey } from '@workbook/core/cellIdentity';
import type { Workbook } from '@workbook/core/model';
import { validLifecycleBundle } from '@application/core/lifecycleFunctionValidation';
import { decodeWorkbookBundle, encodeWorkbookBundle } from './workbookApi';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function validLifecycleWorkbook(workbook: Workbook): boolean {
  try {
    if (!record(workbook) || !record(workbook.manifest) || !record(workbook.documents)
      || (workbook.dataModels !== undefined && !record(workbook.dataModels))) return false;
    const { manifest, documents } = workbook;
    if (!Array.isArray(manifest.sheetIds) || new Set(manifest.sheetIds).size !== manifest.sheetIds.length
      || Object.keys(documents).length !== manifest.sheetIds.length
      || manifest.sheetIds.some((id) => typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(documents, id))) return false;
    if (workbook.dataModels && Object.entries(workbook.dataModels).some(([id, model]) => !record(model) || model.id !== id)) return false;
    for (const id of manifest.sheetIds) {
      const sheet = documents[id];
      if (!record(sheet) || sheet.id !== id || typeof sheet.name !== 'string' || !record(sheet.frame)
        || !record(sheet.frame.position) || !record(sheet.frame.size)
        || ![sheet.frame.position.x, sheet.frame.position.y, sheet.frame.size.width, sheet.frame.size.height, sheet.frame.zIndex].every((n) => typeof n === 'number' && Number.isFinite(n))
        || !record(sheet.content) || sheet.content.kind !== 'tabular'
        || !Array.isArray(sheet.content.rows) || !sheet.content.rows.every((row) => typeof row === 'string')
        || !Array.isArray(sheet.content.columns) || !sheet.content.columns.every((column) => typeof column === 'string')
        || !record(sheet.content.cells) || Object.entries(sheet.content.cells).some(([key, value]) => !cellIdentityFromKey(key) || typeof value !== 'string')) return false;
    }
    const bundle = encodeWorkbookBundle(workbook);
    if (!validLifecycleBundle(bundle)) return false;
    decodeWorkbookBundle(bundle);
    return true;
  } catch {
    return false;
  }
}
