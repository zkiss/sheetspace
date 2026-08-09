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

export type ClientActionId = string;

// Inverse actions are intentionally absent: current behavior has no undo path.
// Phase 3 will add inverse data only for actions that its undo contract supports.
export type UserAction =
  | {
      kind: 'create-sheet';
      clientActionId: ClientActionId;
      sheet: SheetDocument;
    }
  | {
      kind: 'delete-sheet';
      clientActionId: ClientActionId;
      sheetId: SheetId;
    }
  | {
      kind: 'rename-sheet';
      clientActionId: ClientActionId;
      sheetId: SheetId;
      name: string;
    }
  | {
      kind: 'set-cell-content';
      clientActionId: ClientActionId;
      sheetId: SheetId;
      cell: StableCellIdentity;
      raw: string;
    }
  | {
      kind: 'append-row';
      clientActionId: ClientActionId;
      sheetId: SheetId;
      rowId: RowId;
    }
  | {
      kind: 'append-column';
      clientActionId: ClientActionId;
      sheetId: SheetId;
      columnId: ColumnId;
    }
  | {
      kind: 'move-sheet-frame';
      clientActionId: ClientActionId;
      sheetId: SheetId;
      position: WorkspacePosition;
    }
  | {
      kind: 'resize-sheet-frame';
      clientActionId: ClientActionId;
      sheetId: SheetId;
      position: WorkspacePosition;
      size: SheetFrameSize;
    }
  | {
      kind: 'change-sheet-z-order';
      clientActionId: ClientActionId;
      sheetId: SheetId;
      direction: SheetZOrderDirection;
    };

export type DurableOperation =
  | { kind: 'create-sheet'; sheet: SheetDocument }
  | { kind: 'delete-sheet'; sheetId: SheetId }
  | { kind: 'rename-sheet'; sheetId: SheetId; name: string }
  | { kind: 'set-cell-content'; sheetId: SheetId; cell: StableCellIdentity; raw: string }
  | { kind: 'append-row'; sheetId: SheetId; rowId: RowId }
  | { kind: 'append-column'; sheetId: SheetId; columnId: ColumnId }
  | { kind: 'set-sheet-frame'; sheetId: SheetId; frame: FrameState }
  | { kind: 'set-sheet-z-index'; sheetId: SheetId; zIndex: number };

export type SheetRevisionExpectation = {
  sheetId: SheetId;
  revision: number;
};

export type SheetScopedDurableChangeSet = {
  scope: 'sheet';
  clientActionId: ClientActionId;
  expectedRevision: SheetRevisionExpectation;
  operations: readonly DurableOperation[];
};

export type MultiSheetDurableChangeSet = {
  scope: 'multi-sheet';
  clientActionId: ClientActionId;
  expectedManifestRevision: number;
  expectedSheetRevisions: readonly SheetRevisionExpectation[];
  operations: readonly DurableOperation[];
};

export type DurableChangeSet = SheetScopedDurableChangeSet | MultiSheetDurableChangeSet;

export type AppliedUserAction = {
  nextWorkbook: Workbook;
  changeSet: DurableChangeSet;
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
  return success(nextWorkbook, {
    scope: 'multi-sheet',
    clientActionId: action.clientActionId,
    expectedManifestRevision: workbook.manifest.revision,
    expectedSheetRevisions: [],
    operations: [{ kind: 'create-sheet', sheet }],
  }, { kind: 'structure' });
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
  }, {
    scope: 'multi-sheet',
    clientActionId: action.clientActionId,
    expectedManifestRevision: workbook.manifest.revision,
    expectedSheetRevisions: [expectedRevision(sheet)],
    operations: [{ kind: 'delete-sheet', sheetId: sheet.id }],
  }, { kind: 'structure' });
}

function applyRenameSheet(workbook: Workbook, action: Extract<UserAction, { kind: 'rename-sheet' }>): UserActionResult {
  const sheet = findSheetById(workbook, action.sheetId);
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  const validation = validateSheetName(action.name, sheetsInOrder(workbook), sheet.id);
  if (!validation.ok) return { ok: false, reason: validation.reason === 'empty' ? 'empty-sheet-name' : 'duplicate-sheet-name' };
  const nextSheet = validation.name === sheet.name ? sheet : { ...sheet, name: validation.name };
  return sheetSuccess(workbook, nextSheet, action.clientActionId, [{ kind: 'rename-sheet', sheetId: sheet.id, name: validation.name }], { kind: 'none' });
}

function applySetCellContent(workbook: Workbook, action: Extract<UserAction, { kind: 'set-cell-content' }>): UserActionResult {
  const sheet = findSheetById(workbook, action.sheetId);
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  const address = cellAddressOf(sheet.content, action.cell);
  if (!address) return { ok: false, reason: 'invalid-cell' };
  const identityKey = cellIdentityKey(action.cell);
  const raw = formulaRawForStorage(action.raw, workbook);
  const cells = { ...sheet.content.cells };
  if (action.raw.length === 0) delete cells[identityKey]; else cells[identityKey] = raw;
  const nextSheet = { ...sheet, content: { ...sheet.content, cells } };
  return sheetSuccess(workbook, nextSheet, action.clientActionId, [{ kind: 'set-cell-content', sheetId: sheet.id, cell: action.cell, raw }], {
    kind: 'cells',
    cells: [{ sheetId: sheet.id, key: cellKey(address) }],
  });
}

function applyAppendRow(workbook: Workbook, action: Extract<UserAction, { kind: 'append-row' }>): UserActionResult {
  const sheet = findSheetById(workbook, action.sheetId);
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  if (sheet.content.rows.includes(action.rowId)) return { ok: false, reason: 'duplicate-row-id' };
  const nextSheet = { ...sheet, content: { ...sheet.content, rows: [...sheet.content.rows, action.rowId] } };
  return sheetSuccess(workbook, nextSheet, action.clientActionId, [{ kind: 'append-row', sheetId: sheet.id, rowId: action.rowId }], { kind: 'structure' });
}

function applyAppendColumn(workbook: Workbook, action: Extract<UserAction, { kind: 'append-column' }>): UserActionResult {
  const sheet = findSheetById(workbook, action.sheetId);
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  if (sheet.content.columns.includes(action.columnId)) return { ok: false, reason: 'duplicate-column-id' };
  const nextSheet = { ...sheet, content: { ...sheet.content, columns: [...sheet.content.columns, action.columnId] } };
  return sheetSuccess(workbook, nextSheet, action.clientActionId, [{ kind: 'append-column', sheetId: sheet.id, columnId: action.columnId }], { kind: 'structure' });
}

function applyFrameChange(
  workbook: Workbook,
  action: Extract<UserAction, { kind: 'move-sheet-frame' | 'resize-sheet-frame' }>,
  change: (sheet: SheetDocument) => FrameState,
): UserActionResult {
  const sheet = findSheetById(workbook, action.sheetId);
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  const nextSheet = { ...sheet, frame: change(sheet) };
  return sheetSuccess(workbook, nextSheet, action.clientActionId, [{ kind: 'set-sheet-frame', sheetId: sheet.id, frame: nextSheet.frame }], { kind: 'none' });
}

function applyZOrderChange(workbook: Workbook, action: Extract<UserAction, { kind: 'change-sheet-z-order' }>): UserActionResult {
  const moved = moveSheetZOrder(workbook, action.sheetId, action.direction);
  if (!moved.ok) return { ok: false, reason: 'unknown-sheet' };
  const changedSheets = sheetsInOrder(moved.value).filter((sheet) => sheet.frame.zIndex !== workbook.documents[sheet.id]?.frame.zIndex);
  return success(moved.value, {
    scope: 'multi-sheet',
    clientActionId: action.clientActionId,
    expectedManifestRevision: workbook.manifest.revision,
    expectedSheetRevisions: changedSheets.map((sheet) => expectedRevision(workbook.documents[sheet.id])),
    operations: changedSheets.map((sheet) => ({ kind: 'set-sheet-z-index' as const, sheetId: sheet.id, zIndex: sheet.frame.zIndex })),
  }, { kind: 'none' });
}

function sheetSuccess(
  workbook: Workbook,
  nextSheet: SheetDocument,
  clientActionId: ClientActionId,
  operations: readonly DurableOperation[],
  calculationImpact: CalculationImpact,
): UserActionResult {
  return success({ ...workbook, documents: { ...workbook.documents, [nextSheet.id]: nextSheet } }, {
    scope: 'sheet',
    clientActionId,
    expectedRevision: expectedRevision(workbook.documents[nextSheet.id]),
    operations,
  }, calculationImpact);
}

function expectedRevision(sheet: SheetDocument): SheetRevisionExpectation {
  return { sheetId: sheet.id, revision: sheet.revision };
}

function success(nextWorkbook: Workbook, changeSet: DurableChangeSet, calculationImpact: CalculationImpact): UserActionResult {
  return { ok: true, value: { nextWorkbook, changeSet, calculationImpact } };
}
