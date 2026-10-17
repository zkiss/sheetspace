import type { CellKey } from '../core/address';
import { cellIdentityAt, cellIdentityKey } from '../core/cellIdentity';
import { WORKBOOK_SCHEMA_VERSION, type ColumnId, type MutationResult, type RowId, type SheetDocument, type SheetZOrderDirection, type ValidationResult, type Workbook } from '../core/model';
import { copyCanonicalFormula, formulaRawForStorage, workbookFormulaReferenceResolver } from '../formula/reference';
import type { DataModel } from '../core/model';
import { findSheetById, sheetsInOrder } from '../read/queries';

export function createEmptyWorkbook(): Workbook { return { manifest: { version: WORKBOOK_SCHEMA_VERSION, revision: 0, sheetIds: [] }, documents: {} }; }
export function validateSheetName(name: string, existingSheets: Pick<SheetDocument, 'id' | 'name'>[], currentSheetId?: string): ValidationResult { const trimmedName = name.trim(); if (!trimmedName) return { ok: false, reason: 'empty' }; return existingSheets.some((sheet) => sheet.id !== currentSheetId && sheet.name === trimmedName) ? { ok: false, reason: 'duplicate' } : { ok: true, name: trimmedName }; }
export function renameSheet(workbook: Workbook, sheetId: string, nextName: string): MutationResult<Workbook> { const sheet = findSheetById(workbook, sheetId); if (!sheet) return { ok: false, reason: 'unknown-sheet' }; const validation = validateSheetName(nextName, sheetsInOrder(workbook), sheetId); return !validation.ok ? validation : { ok: true, value: { ...workbook, documents: { ...workbook.documents, [sheetId]: { ...sheet, name: validation.name } } } }; }
export function appendRow(sheet: SheetDocument, rowId: RowId, model?: DataModel, workbook?: Workbook): SheetDocument {
  let next = { ...sheet, content: { ...sheet.content, rows: [...sheet.content.rows, rowId] } };
  if (!model || sheet.content.rows.length === 0) return next;
  for (const [index, property] of model.properties.entries()) {
    if (property.kind !== 'calculated') continue;
    const columnId = sheet.content.columns[index];
    const sourceRowId = sheet.content.rows[0];
    if (!columnId || !sourceRowId) continue;
    const source = { rowId: sourceRowId, columnId };
    const sourceWorkbook: Workbook = workbook
      ? { ...workbook, documents: { ...workbook.documents, [sheet.id]: next } }
      : { manifest: { version: WORKBOOK_SCHEMA_VERSION, revision: 0, sheetIds: [sheet.id] }, documents: { [sheet.id]: next } };
    const raw = next.content.cells[cellIdentityKey(source)] ?? formulaRawForStorage(property.formula, sourceWorkbook, sheet.id);
    if (!raw.startsWith('=')) continue;
    const copied = copyCanonicalFormula(raw, source, { rowId, columnId }, workbookFormulaReferenceResolver(sourceWorkbook, sheet.id));
    if (copied.ok) next = { ...next, content: { ...next.content, cells: { ...next.content.cells, [cellIdentityKey({ rowId, columnId })]: copied.raw } } };
  }
  return next;
}
export function appendColumn(sheet: SheetDocument, columnId: ColumnId): SheetDocument { return { ...sheet, content: { ...sheet.content, columns: [...sheet.content.columns, columnId] } }; }
export function commitCellRawContent(workbook: Workbook, sheetId: string, key: CellKey, raw: string): Workbook { const sheet = findSheetById(workbook, sheetId); const identity = sheet && cellIdentityAt(sheet.content, key); if (!sheet || !identity) return workbook; const model = sheet.dataModelId === undefined ? undefined : workbook.dataModels?.[sheet.dataModelId]; const columnIndex = sheet.content.columns.indexOf(identity.columnId); if (model?.properties[columnIndex]?.kind === 'calculated') return workbook; const canonicalRaw = formulaRawForStorage(raw, workbook, sheet.id); const identityKey = cellIdentityKey(identity); const current = sheet.content.cells[identityKey]; if ((raw.length === 0 && current === undefined) || (raw.length > 0 && current === canonicalRaw)) return workbook; const cells = { ...sheet.content.cells, [identityKey]: canonicalRaw }; if (raw.length === 0) delete cells[identityKey]; return { ...workbook, documents: { ...workbook.documents, [sheetId]: { ...sheet, content: { ...sheet.content, cells } } } }; }
export function moveSheetZOrder(workbook: Workbook, sheetId: string, direction: SheetZOrderDirection): MutationResult<Workbook> { if (!findSheetById(workbook, sheetId)) return { ok: false, reason: 'unknown-sheet' }; const ordered = [...sheetsInOrder(workbook)].sort((a, b) => a.frame.zIndex - b.frame.zIndex); const currentIndex = ordered.findIndex((sheet) => sheet.id === sheetId); const targetIndex = direction === 'top' ? ordered.length - 1 : direction === 'bottom' ? 0 : direction === 'up' ? Math.min(ordered.length - 1, currentIndex + 1) : Math.max(0, currentIndex - 1); if (targetIndex !== currentIndex) { const [moved] = ordered.splice(currentIndex, 1); ordered.splice(targetIndex, 0, moved); } return { ok: true, value: applyZOrder(workbook, ordered) }; }
export function normalizeSheetZOrder(workbook: Workbook): Workbook { return applyZOrder(workbook, [...sheetsInOrder(workbook)].sort((a, b) => a.frame.zIndex - b.frame.zIndex)); }
function applyZOrder(workbook: Workbook, ordered: SheetDocument[]): Workbook { const zById = new Map(ordered.map((sheet, index) => [sheet.id, index + 1])); let changed = false; const documents = Object.fromEntries(Object.entries(workbook.documents).map(([id, sheet]) => { const zIndex = zById.get(sheet.id) ?? sheet.frame.zIndex; const next = zIndex === sheet.frame.zIndex ? sheet : { ...sheet, frame: { ...sheet.frame, zIndex } }; changed ||= next !== sheet; return [id, next]; })); return changed ? { ...workbook, documents } : workbook; }
