import type { CalculationImpact } from './calculationProjection';
import {
  cellKey,
  cellAddressOf,
  cellIdentityKey,
  findSheetById,
  formulaRawForStorage,
  moveSheetZOrder,
  sheetsInOrder,
  validateSheetName,
  type ColumnId,
  type FrameState,
  type RowId,
  type SheetDocument,
  type SheetFrameSize,
  type SheetId,
  type SheetZOrderDirection,
  type StableCellIdentity,
  type Workbook,
  type WorkspacePosition,
} from './workbook';

// Inverse actions are intentionally absent: current behavior has no undo path.
// Phase 3 will add inverse data only for actions that its undo contract supports.
export type UserAction =
  | {
      kind: 'create-sheet';
      sheet: SheetDocument;
    }
  | {
      kind: 'delete-sheet';
      sheetId: SheetId;
    }
  | {
      kind: 'rename-sheet';
      sheetId: SheetId;
      name: string;
    }
  | {
      kind: 'set-cell-content';
      sheetId: SheetId;
      cell: StableCellIdentity;
      raw: string;
    }
  | {
      kind: 'append-row';
      sheetId: SheetId;
      rowId: RowId;
    }
  | {
      kind: 'append-column';
      sheetId: SheetId;
      columnId: ColumnId;
    }
  | {
      kind: 'move-sheet-frame';
      sheetId: SheetId;
      position: WorkspacePosition;
    }
  | {
      kind: 'resize-sheet-frame';
      sheetId: SheetId;
      position: WorkspacePosition;
      size: SheetFrameSize;
    }
  | {
      kind: 'change-sheet-z-order';
      sheetId: SheetId;
      direction: SheetZOrderDirection;
    };

export type AppliedUserAction = {
  nextWorkbook: Workbook;
  changed: boolean;
  calculationImpact: CalculationImpact;
};

export type UserActionFailureReason =
  | 'duplicate-column-id'
  | 'duplicate-row-id'
  | 'duplicate-sheet'
  | 'duplicate-sheet-name'
  | 'empty-sheet-name'
  | 'invalid-cell'
  | 'unknown-sheet';

export type UserActionResult =
  | { ok: true; value: AppliedUserAction }
  | { ok: false; reason: UserActionFailureReason };

export function applyUserAction(workbook: Workbook, action: UserAction): UserActionResult {
  switch (action.kind) {
    case 'create-sheet':
      return applyCreateSheet(workbook, action);
    case 'delete-sheet':
      return applyDeleteSheet(workbook, action);
    case 'rename-sheet':
      return applyRenameSheet(workbook, action);
    case 'set-cell-content':
      return applySetCellContent(workbook, action);
    case 'append-row':
      return applyAppendRow(workbook, action);
    case 'append-column':
      return applyAppendColumn(workbook, action);
    case 'move-sheet-frame':
      return applyFrameChange(workbook, action, (sheet) => ({ ...sheet.frame, position: action.position }));
    case 'resize-sheet-frame':
      return applyFrameChange(workbook, action, (sheet) => ({ position: action.position, size: action.size, zIndex: sheet.frame.zIndex }));
    case 'change-sheet-z-order':
      return applyZOrderChange(workbook, action);
  }
}

function applyCreateSheet(workbook: Workbook, action: Extract<UserAction, { kind: 'create-sheet' }>): UserActionResult {
  if (findSheetById(workbook, action.sheet.id)) return { ok: false, reason: 'duplicate-sheet' };
  const validation = validateSheetName(action.sheet.name, sheetsInOrder(workbook));
  if (!validation.ok) return { ok: false, reason: validation.reason === 'empty' ? 'empty-sheet-name' : 'duplicate-sheet-name' };
  const nextZIndex = Math.max(0, ...sheetsInOrder(workbook).map((sheet) => sheet.frame.zIndex)) + 1;
  const sheet = {
    ...action.sheet,
    name: validation.name,
    frame: { ...action.sheet.frame, zIndex: nextZIndex },
  };
  const nextWorkbook: Workbook = {
    ...workbook,
    manifest: { ...workbook.manifest, sheetIds: [...workbook.manifest.sheetIds, sheet.id] },
    documents: { ...workbook.documents, [sheet.id]: sheet },
  };
  return success(nextWorkbook, { kind: 'structure' });
}

function applyDeleteSheet(workbook: Workbook, action: Extract<UserAction, { kind: 'delete-sheet' }>): UserActionResult {
  const sheet = findSheetById(workbook, action.sheetId);
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  const documents = { ...workbook.documents };
  delete documents[action.sheetId];
  return success({
    ...workbook,
    manifest: { ...workbook.manifest, sheetIds: workbook.manifest.sheetIds.filter((id) => id !== action.sheetId) },
    documents,
  }, { kind: 'structure' });
}

function applyRenameSheet(workbook: Workbook, action: Extract<UserAction, { kind: 'rename-sheet' }>): UserActionResult {
  const sheet = findSheetById(workbook, action.sheetId);
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  const validation = validateSheetName(action.name, sheetsInOrder(workbook), sheet.id);
  if (!validation.ok) return { ok: false, reason: validation.reason === 'empty' ? 'empty-sheet-name' : 'duplicate-sheet-name' };
  if (validation.name === sheet.name) return noChange(workbook);
  const nextSheet = { ...sheet, name: validation.name };
  return sheetSuccess(workbook, nextSheet, { kind: 'none' });
}

function applySetCellContent(workbook: Workbook, action: Extract<UserAction, { kind: 'set-cell-content' }>): UserActionResult {
  const sheet = findSheetById(workbook, action.sheetId);
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  const address = cellAddressOf(sheet.content, action.cell);
  if (!address) return { ok: false, reason: 'invalid-cell' };
  const identityKey = cellIdentityKey(action.cell);
  const raw = formulaRawForStorage(action.raw, workbook);
  const currentRaw = sheet.content.cells[identityKey];
  if ((action.raw.length === 0 && currentRaw === undefined) || (action.raw.length > 0 && currentRaw === raw)) {
    return noChange(workbook);
  }
  const cells = { ...sheet.content.cells };
  if (action.raw.length === 0) delete cells[identityKey]; else cells[identityKey] = raw;
  const nextSheet = { ...sheet, content: { ...sheet.content, cells } };
  return sheetSuccess(workbook, nextSheet, {
    kind: 'cells',
    cells: [{ sheetId: sheet.id, key: cellKey(address) }],
  });
}

function applyAppendRow(workbook: Workbook, action: Extract<UserAction, { kind: 'append-row' }>): UserActionResult {
  const sheet = findSheetById(workbook, action.sheetId);
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  if (sheet.content.rows.includes(action.rowId)) return { ok: false, reason: 'duplicate-row-id' };
  const nextSheet = { ...sheet, content: { ...sheet.content, rows: [...sheet.content.rows, action.rowId] } };
  return sheetSuccess(workbook, nextSheet, { kind: 'structure' });
}

function applyAppendColumn(workbook: Workbook, action: Extract<UserAction, { kind: 'append-column' }>): UserActionResult {
  const sheet = findSheetById(workbook, action.sheetId);
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  if (sheet.content.columns.includes(action.columnId)) return { ok: false, reason: 'duplicate-column-id' };
  const nextSheet = { ...sheet, content: { ...sheet.content, columns: [...sheet.content.columns, action.columnId] } };
  return sheetSuccess(workbook, nextSheet, { kind: 'structure' });
}

function applyFrameChange(
  workbook: Workbook,
  action: Extract<UserAction, { kind: 'move-sheet-frame' | 'resize-sheet-frame' }>,
  change: (sheet: SheetDocument) => FrameState,
): UserActionResult {
  const sheet = findSheetById(workbook, action.sheetId);
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  const frame = change(sheet);
  const nextSheet = { ...sheet, frame };
  return sheetSuccess(workbook, nextSheet, { kind: 'none' });
}

function applyZOrderChange(workbook: Workbook, action: Extract<UserAction, { kind: 'change-sheet-z-order' }>): UserActionResult {
  const moved = moveSheetZOrder(workbook, action.sheetId, action.direction);
  if (!moved.ok) return { ok: false, reason: 'unknown-sheet' };
  const changed = sheetsInOrder(moved.value).some(
    (sheet) => sheet.frame.zIndex !== workbook.documents[sheet.id]?.frame.zIndex,
  );
  if (!changed) return noChange(workbook);
  return success(moved.value, { kind: 'none' });
}

function sheetSuccess(
  workbook: Workbook,
  nextSheet: SheetDocument,
  calculationImpact: CalculationImpact,
): UserActionResult {
  return success({ ...workbook, documents: { ...workbook.documents, [nextSheet.id]: nextSheet } }, calculationImpact);
}

function success(nextWorkbook: Workbook, calculationImpact: CalculationImpact): UserActionResult {
  return { ok: true, value: { nextWorkbook, changed: true, calculationImpact } };
}

function noChange(workbook: Workbook): UserActionResult {
  return { ok: true, value: { nextWorkbook: workbook, changed: false, calculationImpact: { kind: 'none' } } };
}
