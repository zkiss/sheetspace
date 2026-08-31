import type { CalculationImpact } from './calculationProjection';
import { cellAddressOf, cellIdentityKey } from './stableCellIdentity';
import { cellKey } from './cellAddress';
import { findSheetById, sheetsInOrder } from './workbookQueries';
import { formulaRawForStorage } from './formulaReference';
import { moveSheetZOrder, validateSheetName } from './workbookOperations';
import { type ColumnId, type FrameState, type RowId, type SheetDocument, type SheetFrameSize, type SheetId, type SheetZOrderDirection, type StableCellIdentity, type Workbook, type WorkspacePosition } from './workbookModel';

export type WorkbookOperationId = string;
export type CellWrite = { cell: StableCellIdentity; raw: string };

/** Plain durable data. Operations cannot carry code, promises, state, or transport clients. */
export type WorkbookOperation =
  | { kind: 'delete-sheet'; operationId: WorkbookOperationId; sheetId: SheetId }
  | { kind: 'rename-sheet'; operationId: WorkbookOperationId; sheetId: SheetId; name: string }
  | { kind: 'write-cells'; operationId: WorkbookOperationId; sheetId: SheetId; writes: readonly CellWrite[] }
  | { kind: 'move-sheet-frame'; operationId: WorkbookOperationId; sheetId: SheetId; position: WorkspacePosition }
  | { kind: 'resize-sheet-frame'; operationId: WorkbookOperationId; sheetId: SheetId; position: WorkspacePosition; size: SheetFrameSize }
  | { kind: 'change-sheet-z-order'; operationId: WorkbookOperationId; sheetId: SheetId; direction: SheetZOrderDirection };

/** These originate in backend responses and are not optimistic durable operations. */
export type BackendWorkbookReconciliation =
  | { kind: 'append-row'; sheetId: SheetId; rowId: RowId }
  | { kind: 'append-column'; sheetId: SheetId; columnId: ColumnId };

export type WorkbookPersistenceIntent =
  | { kind: 'delete-sheet'; sheetId: SheetId }
  | { kind: 'rename-sheet'; sheetId: SheetId; name: string }
  | { kind: 'update-sheet-position'; sheetId: SheetId; position: WorkspacePosition }
  | { kind: 'update-sheet-frame-layout'; sheetId: SheetId; position: WorkspacePosition; size: SheetFrameSize }
  | { kind: 'update-sheet-z-order'; updates: readonly { sheetId: SheetId; zIndex: number }[] }
  | { kind: 'write-cells'; sheetId: SheetId; writes: readonly CellWrite[] };

export type AffectedWorkbookEntities = {
  sheetIds: readonly SheetId[];
  cells: readonly { sheetId: SheetId; cell: StableCellIdentity }[];
};

/** Inverse data is operation-ID free; an undo operation receives a new durable ID later. */
export type WorkbookOperationInverse =
  | { kind: 'rename-sheet'; sheetId: SheetId; name: string }
  | { kind: 'write-cells'; sheetId: SheetId; writes: readonly CellWrite[] }
  | { kind: 'move-sheet-frame'; sheetId: SheetId; position: WorkspacePosition }
  | { kind: 'resize-sheet-frame'; sheetId: SheetId; position: WorkspacePosition; size: SheetFrameSize }
  | { kind: 'change-sheet-z-order'; updates: readonly { sheetId: SheetId; zIndex: number }[] };

export type AppliedWorkbookOperation = {
  nextWorkbook: Workbook;
  changed: boolean;
  calculationImpact: CalculationImpact;
  persistence: WorkbookPersistenceIntent | undefined;
  affected: AffectedWorkbookEntities;
  inverse: WorkbookOperationInverse | undefined;
};
export type WorkbookOperationFailureReason = 'duplicate-column-id' | 'duplicate-row-id' | 'duplicate-sheet-name' | 'empty-sheet-name' | 'invalid-cell' | 'unknown-sheet';
export type WorkbookOperationResult = { ok: true; value: AppliedWorkbookOperation } | { ok: false; reason: WorkbookOperationFailureReason };

export function applyWorkbookOperation(workbook: Workbook, operation: WorkbookOperation): WorkbookOperationResult {
  switch (operation.kind) {
    case 'delete-sheet': return applyDeleteSheet(workbook, operation);
    case 'rename-sheet': return applyRenameSheet(workbook, operation);
    case 'write-cells': return applyCellWrites(workbook, operation);
    case 'move-sheet-frame': return applyFrameChange(workbook, operation, (sheet) => ({ ...sheet.frame, position: operation.position }));
    case 'resize-sheet-frame': return applyFrameChange(workbook, operation, (sheet) => ({ position: operation.position, size: operation.size, zIndex: sheet.frame.zIndex }));
    case 'change-sheet-z-order': return applyZOrderChange(workbook, operation);
  }
}

export function applyBackendWorkbookReconciliation(workbook: Workbook, reconciliation: BackendWorkbookReconciliation): WorkbookOperationResult {
  const sheet = findSheetById(workbook, reconciliation.sheetId);
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  if (reconciliation.kind === 'append-row') {
    if (sheet.content.rows.includes(reconciliation.rowId)) return { ok: false, reason: 'duplicate-row-id' };
    return sheetSuccess(workbook, { ...sheet, content: { ...sheet.content, rows: [...sheet.content.rows, reconciliation.rowId] } }, { kind: 'structure' });
  }
  if (sheet.content.columns.includes(reconciliation.columnId)) return { ok: false, reason: 'duplicate-column-id' };
  return sheetSuccess(workbook, { ...sheet, content: { ...sheet.content, columns: [...sheet.content.columns, reconciliation.columnId] } }, { kind: 'structure' });
}

function applyDeleteSheet(workbook: Workbook, operation: Extract<WorkbookOperation, { kind: 'delete-sheet' }>): WorkbookOperationResult {
  if (!findSheetById(workbook, operation.sheetId)) return { ok: false, reason: 'unknown-sheet' };
  const documents = { ...workbook.documents }; delete documents[operation.sheetId];
  return success({ ...workbook, manifest: { ...workbook.manifest, sheetIds: workbook.manifest.sheetIds.filter((id) => id !== operation.sheetId) }, documents }, { kind: 'structure' }, { kind: 'delete-sheet', sheetId: operation.sheetId }, affectedSheets(operation.sheetId));
}

function applyRenameSheet(workbook: Workbook, operation: Extract<WorkbookOperation, { kind: 'rename-sheet' }>): WorkbookOperationResult {
  const sheet = findSheetById(workbook, operation.sheetId);
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  const validation = validateSheetName(operation.name, sheetsInOrder(workbook), sheet.id);
  if (!validation.ok) return { ok: false, reason: validation.reason === 'empty' ? 'empty-sheet-name' : 'duplicate-sheet-name' };
  if (validation.name === sheet.name) return noChange(workbook);
  return sheetSuccess(workbook, { ...sheet, name: validation.name }, { kind: 'none' }, { kind: 'rename-sheet', sheetId: sheet.id, name: validation.name }, { kind: 'rename-sheet', sheetId: sheet.id, name: sheet.name });
}

function applyCellWrites(workbook: Workbook, operation: Extract<WorkbookOperation, { kind: 'write-cells' }>): WorkbookOperationResult {
  const sheet = findSheetById(workbook, operation.sheetId);
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  const resolved = operation.writes.map((write) => ({ write, address: cellAddressOf(sheet.content, write.cell) }));
  if (resolved.some(({ address }) => !address)) return { ok: false, reason: 'invalid-cell' };
  const cells = { ...sheet.content.cells };
  const inverseWrites: CellWrite[] = [], changedWrites: CellWrite[] = [];
  const impacts: { sheetId: SheetId; key: string }[] = [];
  const affected: { sheetId: SheetId; cell: StableCellIdentity }[] = [];
  for (const entry of resolved) {
    const address = entry.address!;
    const identityKey = cellIdentityKey(entry.write.cell);
    const before = cells[identityKey];
    const raw = formulaRawForStorage(entry.write.raw, workbook, sheet.id);
    if ((entry.write.raw.length === 0 && before === undefined) || (entry.write.raw.length > 0 && before === raw)) continue;
    inverseWrites.unshift({ cell: entry.write.cell, raw: before ?? '' });
    changedWrites.push({ cell: entry.write.cell, raw: entry.write.raw.length === 0 ? '' : raw });
    impacts.push({ sheetId: sheet.id, key: cellKey(address) });
    affected.push({ sheetId: sheet.id, cell: entry.write.cell });
    if (entry.write.raw.length === 0) delete cells[identityKey]; else cells[identityKey] = raw;
  }
  if (changedWrites.length === 0) return noChange(workbook);
  return sheetSuccess(workbook, { ...sheet, content: { ...sheet.content, cells } }, { kind: 'cells', cells: impacts }, { kind: 'write-cells', sheetId: sheet.id, writes: changedWrites }, { kind: 'write-cells', sheetId: sheet.id, writes: inverseWrites }, affected);
}

function applyFrameChange(workbook: Workbook, operation: Extract<WorkbookOperation, { kind: 'move-sheet-frame' | 'resize-sheet-frame' }>, change: (sheet: SheetDocument) => FrameState): WorkbookOperationResult {
  const sheet = findSheetById(workbook, operation.sheetId);
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  const frame = change(sheet);
  if (frame.position.x === sheet.frame.position.x && frame.position.y === sheet.frame.position.y && frame.size.width === sheet.frame.size.width && frame.size.height === sheet.frame.size.height) return noChange(workbook);
  const persistence: WorkbookPersistenceIntent = operation.kind === 'move-sheet-frame' ? { kind: 'update-sheet-position', sheetId: sheet.id, position: frame.position } : { kind: 'update-sheet-frame-layout', sheetId: sheet.id, position: frame.position, size: frame.size };
  const inverse: WorkbookOperationInverse = operation.kind === 'move-sheet-frame' ? { kind: 'move-sheet-frame', sheetId: sheet.id, position: sheet.frame.position } : { kind: 'resize-sheet-frame', sheetId: sheet.id, position: sheet.frame.position, size: sheet.frame.size };
  return sheetSuccess(workbook, { ...sheet, frame }, { kind: 'none' }, persistence, inverse);
}

function applyZOrderChange(workbook: Workbook, operation: Extract<WorkbookOperation, { kind: 'change-sheet-z-order' }>): WorkbookOperationResult {
  const moved = moveSheetZOrder(workbook, operation.sheetId, operation.direction);
  if (!moved.ok) return { ok: false, reason: 'unknown-sheet' };
  const updates = sheetsInOrder(moved.value).flatMap((sheet) => sheet.frame.zIndex !== workbook.documents[sheet.id]?.frame.zIndex ? [{ sheetId: sheet.id, zIndex: sheet.frame.zIndex }] : []);
  if (updates.length === 0) return noChange(workbook);
  return success(moved.value, { kind: 'none' }, { kind: 'update-sheet-z-order', updates }, affectedSheets(...updates.map(({ sheetId }) => sheetId)), { kind: 'change-sheet-z-order', updates: updates.map(({ sheetId }) => ({ sheetId, zIndex: workbook.documents[sheetId]!.frame.zIndex })) });
}

function sheetSuccess(workbook: Workbook, nextSheet: SheetDocument, calculationImpact: CalculationImpact, persistence?: WorkbookPersistenceIntent, inverse?: WorkbookOperationInverse, cells: AffectedWorkbookEntities['cells'] = []): WorkbookOperationResult {
  return success({ ...workbook, documents: { ...workbook.documents, [nextSheet.id]: nextSheet } }, calculationImpact, persistence, { sheetIds: [nextSheet.id], cells }, inverse);
}
function success(nextWorkbook: Workbook, calculationImpact: CalculationImpact, persistence?: WorkbookPersistenceIntent, affected: AffectedWorkbookEntities = { sheetIds: [], cells: [] }, inverse?: WorkbookOperationInverse): WorkbookOperationResult {
  return { ok: true, value: { nextWorkbook, changed: true, calculationImpact, persistence, affected, inverse } };
}
function noChange(workbook: Workbook): WorkbookOperationResult {
  return { ok: true, value: { nextWorkbook: workbook, changed: false, calculationImpact: { kind: 'none' }, persistence: undefined, affected: { sheetIds: [], cells: [] }, inverse: undefined } };
}
function affectedSheets(...sheetIds: SheetId[]): AffectedWorkbookEntities { return { sheetIds, cells: [] }; }
