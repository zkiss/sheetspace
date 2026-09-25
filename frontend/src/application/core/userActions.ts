import { applyAxisSizeWrites, validAxisSizeWrites } from '@workbook/core/axisSizePolicy';
import type { AxisSizeWrite } from '@workbook/core/model';
import { applyFormatWrites, emptySheetFormatOverrides, validFormatWrites } from '@workbook/core/numberFormat';
import type { FormatWrite } from '@workbook/core/model';
import type { CalculationImpact } from '@workbook/read/calculationProjection';
import { cellAddressOf, cellIdentityKey } from '@workbook/core/cellIdentity';
import { cellKey } from '@workbook/core/address';
import { findSheetById, sheetsInOrder } from '@workbook/read/queries';
import { formulaRawForStorage } from '@workbook/formula/reference';
import { copyCanonicalFormula, workbookFormulaReferenceResolver } from '@workbook/formula/reference';
import type { ClipboardParseResult, ClipboardSourceSnapshot } from './clipboardPayload';
import { moveSheetZOrder, validateSheetName } from '@workbook/mutations/operations';
import { isValidSheetVisualScale, type ColumnId, type FrameState, type RowId, type SheetDocument, type SheetFrameSize, type SheetId, type SheetZOrderDirection, type StableCellIdentity, type Workbook, type WorkspacePosition } from '@workbook/core/model';

export type WorkbookOperationId = string;
/** A stable workbook-wide cell target. The raw content is the final persisted value. */
export type CellWrite = { sheetId: SheetId; rowId: RowId; columnId: ColumnId; raw: string };
/** A durable cell state transition. `null` explicitly represents a sparse (absent) cell. */
export type CellPersistenceWrite = {
  sheetId: SheetId;
  rowId: RowId;
  columnId: ColumnId;
  beforeRaw: string | null;
  afterRaw: string | null;
};

/** Plain durable data. Operations cannot carry code, promises, state, or transport clients. */
export type WorkbookOperation =
  | { kind: 'write-axis-sizes'; operationId: WorkbookOperationId; sheetId: SheetId; writes: readonly AxisSizeWrite[] }
  | { kind: 'write-number-formats'; operationId: WorkbookOperationId; sheetId: SheetId; writes: readonly FormatWrite[] }
  | { kind: 'delete-sheet'; operationId: WorkbookOperationId; sheetId: SheetId }
  | { kind: 'rename-sheet'; operationId: WorkbookOperationId; sheetId: SheetId; name: string }
  | { kind: 'write-cells'; operationId: WorkbookOperationId; writes: readonly CellWrite[] }
  | { kind: 'move-sheet-frame'; operationId: WorkbookOperationId; sheetId: SheetId; position: WorkspacePosition }
  | { kind: 'resize-sheet-frame'; operationId: WorkbookOperationId; sheetId: SheetId; position: WorkspacePosition; size: SheetFrameSize }
  | { kind: 'set-sheet-visual-scale'; operationId: WorkbookOperationId; sheetId: SheetId; visualScale: number }
  | { kind: 'change-sheet-z-order'; operationId: WorkbookOperationId; sheetId: SheetId; direction: SheetZOrderDirection };

/** These originate in backend responses and are not optimistic durable operations. */
export type BackendWorkbookReconciliation =
  | { kind: 'append-row'; sheetId: SheetId; rowId: RowId }
  | { kind: 'append-column'; sheetId: SheetId; columnId: ColumnId };

export type WorkbookPersistenceIntent =
  | { kind: 'write-axis-sizes'; sheetId: SheetId; writes: readonly AxisSizeWrite[] }
  | { kind: 'write-number-formats'; sheetId: SheetId; writes: readonly FormatWrite[] }
  | { kind: 'delete-sheet'; sheetId: SheetId }
  | { kind: 'rename-sheet'; sheetId: SheetId; name: string }
  | { kind: 'update-sheet-position'; sheetId: SheetId; position: WorkspacePosition }
  | { kind: 'update-sheet-frame-layout'; sheetId: SheetId; position: WorkspacePosition; size: SheetFrameSize }
  | { kind: 'update-sheet-visual-scale'; sheetId: SheetId; visualScale: number }
  | { kind: 'update-sheet-z-order'; updates: readonly { sheetId: SheetId; zIndex: number }[] }
  | { kind: 'write-cells'; writes: readonly CellPersistenceWrite[] };

export type AffectedWorkbookEntities = {
  sheetIds: readonly SheetId[];
  cells: readonly { sheetId: SheetId; cell: StableCellIdentity }[];
};

/** Inverse data is operation-ID free; an undo operation receives a new durable ID later. */
export type WorkbookOperationInverse =
  | { kind: 'write-axis-sizes'; sheetId: SheetId; writes: readonly AxisSizeWrite[] }
  | { kind: 'write-number-formats'; sheetId: SheetId; writes: readonly FormatWrite[] }
  | { kind: 'rename-sheet'; sheetId: SheetId; name: string }
  | { kind: 'write-cells'; writes: readonly CellWrite[] }
  | { kind: 'move-sheet-frame'; sheetId: SheetId; position: WorkspacePosition }
  | { kind: 'resize-sheet-frame'; sheetId: SheetId; position: WorkspacePosition; size: SheetFrameSize }
  | { kind: 'set-sheet-visual-scale'; sheetId: SheetId; visualScale: number }
  | { kind: 'change-sheet-z-order'; updates: readonly { sheetId: SheetId; zIndex: number }[] };

export type AppliedWorkbookOperation = {
  nextWorkbook: Workbook;
  changed: boolean;
  calculationImpact: CalculationImpact;
  persistence: WorkbookPersistenceIntent | undefined;
  affected: AffectedWorkbookEntities;
  inverse: WorkbookOperationInverse | undefined;
};
export type WorkbookOperationFailureReason = 'duplicate-cell' | 'duplicate-column-id' | 'duplicate-row-id' | 'duplicate-sheet-name' | 'empty-sheet-name' | 'invalid-cell' | 'invalid-axis-size' | 'invalid-number-format' | 'invalid-visual-scale' | 'unknown-sheet';
export type WorkbookOperationResult = { ok: true; value: AppliedWorkbookOperation } | { ok: false; reason: WorkbookOperationFailureReason };
/** Plain decoded clipboard data; UI code owns decoding and application code owns mutation. */
export type PastePreparationFailureReason = 'malformed-tsv' | 'invalid-destination' | 'invalid-paste-footprint' | 'invalid-internal-source' | 'formula-transform-failed';
export type PastePreparationResult = { ok: true; writes: readonly CellWrite[] } | { ok: false; reason: PastePreparationFailureReason };
export type MovePreparationFailureReason = 'invalid-destination' | 'invalid-move-footprint' | 'invalid-move-source' | 'stale-move-source';
export type MoveCellIdentityMapping = {
  source: { sheetId: SheetId; cell: StableCellIdentity };
  destination: { sheetId: SheetId; cell: StableCellIdentity };
};
export type MovePreparationResult = {
  ok: true;
  writes: readonly CellWrite[];
  mappings: readonly MoveCellIdentityMapping[];
} | { ok: false; reason: MovePreparationFailureReason };

/**
 * Validates and materializes a clipboard range before handing it to the normal single write
 * operation. Keeping this separate means a bad footprint or formula can never partially paste.
 */
export function preparePasteCellWrites(
  workbook: Workbook,
  destinationSheetId: SheetId,
  destination: StableCellIdentity,
  clipboard: ClipboardParseResult,
): PastePreparationResult {
  if (!clipboard.ok) return clipboard;
  const destinationSheet = findSheetById(workbook, destinationSheetId);
  if (!destinationSheet || !cellAddressOf(destinationSheet.content, destination)) {
    return { ok: false, reason: 'invalid-destination' };
  }
  const { grid } = clipboard.value;
  if (grid.rowCount < 1 || grid.columnCount < 1 || grid.rows.length !== grid.rowCount
    || grid.rows.some((row) => row.length !== grid.columnCount)) {
    return { ok: false, reason: 'invalid-paste-footprint' };
  }
  const destinationRow = destinationSheet.content.rows.indexOf(destination.rowId);
  const destinationColumn = destinationSheet.content.columns.indexOf(destination.columnId);
  if (destinationRow < 0 || destinationColumn < 0
    || destinationRow + grid.rowCount > destinationSheet.content.rows.length
    || destinationColumn + grid.columnCount > destinationSheet.content.columns.length) {
    return { ok: false, reason: 'invalid-paste-footprint' };
  }

  const source = clipboard.value.kind === 'internal' ? clipboard.value.source : undefined;
  if (source && (source.dimensions.rowCount !== grid.rowCount || source.dimensions.columnCount !== grid.columnCount
    || source.cells.length !== grid.rowCount || source.cells.some((row) => row.length !== grid.columnCount))) {
    return { ok: false, reason: 'invalid-internal-source' };
  }
  const sourceSheet = source && findSheetById(workbook, source.sheetId);
  if (source && !sourceSheet) return { ok: false, reason: 'invalid-internal-source' };

  const writes: CellWrite[] = [];
  const targetIdentities = new Set<string>();
  const sourceIdentities = new Set<string>();
  const resolver = workbookFormulaReferenceResolver(workbook, destinationSheetId);
  for (let rowOffset = 0; rowOffset < grid.rowCount; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < grid.columnCount; columnOffset += 1) {
      const rowId = destinationSheet.content.rows[destinationRow + rowOffset]!;
      const columnId = destinationSheet.content.columns[destinationColumn + columnOffset]!;
      const targetIdentity = `${destinationSheetId}\u0000${rowId}\u0000${columnId}`;
      if (targetIdentities.has(targetIdentity)) return { ok: false, reason: 'invalid-paste-footprint' };
      targetIdentities.add(targetIdentity);
      let raw = grid.rows[rowOffset]![columnOffset]!;
      if (source) {
        const sourceCell = source.cells[rowOffset]![columnOffset]!;
        const sourceIdentity = `${source.sheetId}\u0000${sourceCell.identity.rowId}\u0000${sourceCell.identity.columnId}`;
        if (sourceIdentities.has(sourceIdentity)) return { ok: false, reason: 'invalid-internal-source' };
        sourceIdentities.add(sourceIdentity);
        const sourceAddress = cellAddressOf(sourceSheet!.content, sourceCell.identity);
        if (!sourceAddress) return { ok: false, reason: 'invalid-internal-source' };
        if (sourceCell.raw.startsWith('=')) {
          const transformed = copyCanonicalFormula(
            sourceCell.raw,
            sourceCell.identity,
            { rowId, columnId },
            resolver,
            { sourceSheetId: source.sheetId, destinationSheetId },
          );
          if (!transformed.ok) return { ok: false, reason: 'formula-transform-failed' };
          raw = transformed.raw;
        } else raw = sourceCell.raw;
      }
      writes.push({ sheetId: destinationSheetId, rowId, columnId, raw });
    }
  }
  return { ok: true, writes };
}

/**
 * Plans a cut/move as one unique final write set. Moved raw text stays
 * verbatim (no copy transform); recalculation follows from new locations.
 * Cutting alone changes nothing: staleness is checked against live contents
 * so a changed source can never be cleared by a stale snapshot.
 */
export function prepareMoveCellWrites(
  workbook: Workbook,
  destinationSheetId: SheetId,
  destination: StableCellIdentity,
  source: ClipboardSourceSnapshot,
): MovePreparationResult {
  const destinationSheet = findSheetById(workbook, destinationSheetId);
  const sourceSheet = findSheetById(workbook, source.sheetId);
  if (!destinationSheet || !cellAddressOf(destinationSheet.content, destination)) {
    return { ok: false, reason: 'invalid-destination' };
  }
  if (!sourceSheet
    || source.dimensions.rowCount < 1 || source.dimensions.columnCount < 1
    || source.cells.length !== source.dimensions.rowCount
    || source.cells.some((row) => row.length !== source.dimensions.columnCount)) {
    return { ok: false, reason: 'invalid-move-source' };
  }
  const destinationRow = destinationSheet.content.rows.indexOf(destination.rowId);
  const destinationColumn = destinationSheet.content.columns.indexOf(destination.columnId);
  if (destinationRow < 0 || destinationColumn < 0
    || destinationRow + source.dimensions.rowCount > destinationSheet.content.rows.length
    || destinationColumn + source.dimensions.columnCount > destinationSheet.content.columns.length) {
    return { ok: false, reason: 'invalid-move-footprint' };
  }
  // Validate every source identity before reading live contents.
  for (const row of source.cells) {
    for (const cell of row) {
      if (!cellAddressOf(sourceSheet.content, cell.identity)) {
        return { ok: false, reason: 'invalid-move-source' };
      }
    }
  }
  // Stale snapshot must leave both sides unchanged.
  for (const row of source.cells) {
    for (const cell of row) {
      const live = sourceSheet.content.cells[cellIdentityKey(cell.identity)] ?? '';
      if (live !== cell.raw) return { ok: false, reason: 'stale-move-source' };
    }
  }

  const destinationCells: StableCellIdentity[] = [];
  for (let rowOffset = 0; rowOffset < source.dimensions.rowCount; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < source.dimensions.columnCount; columnOffset += 1) {
      const rowId = destinationSheet.content.rows[destinationRow + rowOffset]!;
      const columnId = destinationSheet.content.columns[destinationColumn + columnOffset]!;
      destinationCells.push({ rowId, columnId });
    }
  }
  const sourceKeys = source.cells.flatMap((row) => row.map((cell) =>
    `${source.sheetId}\u0000${cell.identity.rowId}\u0000${cell.identity.columnId}`));
  if (new Set(sourceKeys).size !== sourceKeys.length) return { ok: false, reason: 'invalid-move-source' };

  // Same-origin no-op: identical ordered identity set → exact contents kept.
  const destinationKeys = destinationCells.map(({ rowId, columnId }) =>
    `${destinationSheetId}\u0000${rowId}\u0000${columnId}`);
  if (new Set(destinationKeys).size !== destinationKeys.length) return { ok: false, reason: 'invalid-move-footprint' };
  const mappings: MoveCellIdentityMapping[] = [];
  for (let index = 0; index < destinationCells.length; index += 1) {
    const sourceCell = source.cells[Math.floor(index / source.dimensions.columnCount)]![index % source.dimensions.columnCount]!;
    mappings.push({
      source: { sheetId: source.sheetId, cell: { ...sourceCell.identity } },
      destination: { sheetId: destinationSheetId, cell: { ...destinationCells[index]! } },
    });
  }
  if (destinationSheetId === source.sheetId
    && destinationKeys.length === sourceKeys.length
    && destinationKeys.every((key, index) => key === sourceKeys[index])) {
    return { ok: true, writes: [], mappings };
  }

  const destinationKeySet = new Set(destinationKeys);
  const writes: CellWrite[] = [];
  let flat = 0;
  for (let rowOffset = 0; rowOffset < source.dimensions.rowCount; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < source.dimensions.columnCount; columnOffset += 1) {
      const target = destinationCells[flat]!;
      const snapshotCell = source.cells[rowOffset]![columnOffset]!;
      writes.push({ sheetId: destinationSheetId, rowId: target.rowId, columnId: target.columnId, raw: snapshotCell.raw });
      flat += 1;
    }
  }
  // Overlapping destination wins; only non-overlapping source cells clear.
  for (const row of source.cells) {
    for (const cell of row) {
      const key = `${source.sheetId}\u0000${cell.identity.rowId}\u0000${cell.identity.columnId}`;
      if (destinationKeySet.has(key)) continue;
      writes.push({ sheetId: source.sheetId, rowId: cell.identity.rowId, columnId: cell.identity.columnId, raw: '' });
    }
  }
  return { ok: true, writes, mappings };
}

/**
 * Replays durable cell data without interpreting formulas again.  The caller supplies the
 * state it expects to replace, so an undo/redo can never partially overwrite a later edit.
 */
export function replayCellPersistenceWrites(
  workbook: Workbook,
  writes: readonly CellPersistenceWrite[],
  expected: 'before' | 'after',
): WorkbookOperationResult {
  const resolved = writes.map((write) => {
    const sheet = findSheetById(workbook, write.sheetId);
    const cell = { rowId: write.rowId, columnId: write.columnId };
    return { write, sheet, cell, address: sheet && cellAddressOf(sheet.content, cell) };
  });
  if (resolved.some(({ sheet }) => !sheet)) return { ok: false, reason: 'unknown-sheet' };
  if (resolved.some(({ address }) => !address)) return { ok: false, reason: 'invalid-cell' };
  const identities = new Set<string>();
  for (const { write } of resolved) {
    const identity = `${write.sheetId}\u0000${write.rowId}\u0000${write.columnId}`;
    if (identities.has(identity)) return { ok: false, reason: 'duplicate-cell' };
    identities.add(identity);
  }
  // Validate the whole transaction before changing anything.
  if (resolved.some(({ write, sheet, cell }) =>
    (sheet!.content.cells[cellIdentityKey(cell)] ?? null) !== write[`${expected}Raw`],
  )) return { ok: false, reason: 'invalid-cell' };

  const cellsBySheet = new Map<SheetId, Record<string, string>>();
  const impacts: { sheetId: SheetId; key: string }[] = [];
  const affected: { sheetId: SheetId; cell: StableCellIdentity }[] = [];
  const replayed: CellPersistenceWrite[] = [];
  const target = expected === 'before' ? 'afterRaw' : 'beforeRaw';
  for (const { write, sheet, cell, address } of resolved) {
    const cells = cellsBySheet.get(sheet!.id) ?? { ...sheet!.content.cells };
    cellsBySheet.set(sheet!.id, cells);
    const key = cellIdentityKey(cell);
    const beforeRaw = cells[key] ?? null;
    const afterRaw = write[target];
    if (afterRaw === null) delete cells[key]; else cells[key] = afterRaw;
    replayed.push({ ...write, beforeRaw, afterRaw });
    impacts.push({ sheetId: sheet!.id, key: cellKey(address!) });
    affected.push({ sheetId: sheet!.id, cell });
  }
  const documents = { ...workbook.documents };
  for (const [sheetId, cells] of cellsBySheet) {
    const sheet = workbook.documents[sheetId]!;
    documents[sheetId] = { ...sheet, content: { ...sheet.content, cells } };
  }
  return success(
    { ...workbook, documents },
    { kind: 'cells', cells: impacts },
    { kind: 'write-cells', writes: replayed },
    { sheetIds: [...new Set(affected.map(({ sheetId }) => sheetId))], cells: affected },
  );
}

export function applyWorkbookOperation(workbook: Workbook, operation: WorkbookOperation): WorkbookOperationResult {
  switch (operation.kind) {
    case 'write-axis-sizes': return applyAxisSizes(workbook, operation);
    case 'write-number-formats': return applyNumberFormats(workbook, operation);
    case 'delete-sheet': return applyDeleteSheet(workbook, operation);
    case 'rename-sheet': return applyRenameSheet(workbook, operation);
    case 'write-cells': return applyCellWrites(workbook, operation);
    case 'move-sheet-frame': return applyFrameChange(workbook, operation, (sheet) => ({ ...sheet.frame, position: operation.position }));
    case 'resize-sheet-frame': return applyFrameChange(workbook, operation, (sheet) => ({ ...sheet.frame, position: operation.position, size: operation.size }));
    case 'set-sheet-visual-scale': return applyVisualScaleChange(workbook, operation);
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
  const resolved = operation.writes.map((write) => {
    const sheet = findSheetById(workbook, write.sheetId);
    const cell = { rowId: write.rowId, columnId: write.columnId };
    return { write, sheet, cell, address: sheet && cellAddressOf(sheet.content, cell) };
  });
  if (resolved.some(({ sheet }) => !sheet)) return { ok: false, reason: 'unknown-sheet' };
  if (resolved.some(({ address }) => !address)) return { ok: false, reason: 'invalid-cell' };
  const identities = new Set<string>();
  for (const { write } of resolved) {
    const identity = `${write.sheetId}\u0000${write.rowId}\u0000${write.columnId}`;
    if (identities.has(identity)) return { ok: false, reason: 'duplicate-cell' };
    identities.add(identity);
  }

  const cellsBySheet = new Map<SheetId, Record<string, string>>();
  const inverseWrites: CellWrite[] = [], persistenceWrites: CellPersistenceWrite[] = [];
  const impacts: { sheetId: SheetId; key: string }[] = [];
  const affected: { sheetId: SheetId; cell: StableCellIdentity }[] = [];
  for (const entry of resolved) {
    const sheet = entry.sheet!;
    const address = entry.address!;
    const identityKey = cellIdentityKey(entry.cell);
    const cells = cellsBySheet.get(sheet.id) ?? { ...sheet.content.cells };
    cellsBySheet.set(sheet.id, cells);
    const before = cells[identityKey];
    // Resolve every editor formula against the original workbook, before any write is applied.
    const raw = entry.write.raw.length === 0 ? '' : formulaRawForStorage(entry.write.raw, workbook, sheet.id);
    if ((raw.length === 0 && before === undefined) || (raw.length > 0 && before === raw)) continue;
    inverseWrites.push({ ...entry.write, raw: before ?? '' });
    persistenceWrites.push({
      sheetId: entry.write.sheetId,
      rowId: entry.write.rowId,
      columnId: entry.write.columnId,
      beforeRaw: before ?? null,
      afterRaw: raw.length === 0 ? null : raw,
    });
    impacts.push({ sheetId: sheet.id, key: cellKey(address) });
    affected.push({ sheetId: sheet.id, cell: entry.cell });
    if (raw.length === 0) delete cells[identityKey]; else cells[identityKey] = raw;
  }
  if (persistenceWrites.length === 0) return noChange(workbook);
  const documents = { ...workbook.documents };
  for (const [sheetId, cells] of cellsBySheet) {
    const sheet = workbook.documents[sheetId]!;
    documents[sheetId] = { ...sheet, content: { ...sheet.content, cells } };
  }
  return success({ ...workbook, documents }, { kind: 'cells', cells: impacts }, { kind: 'write-cells', writes: persistenceWrites }, { sheetIds: [...new Set(affected.map(({ sheetId }) => sheetId))], cells: affected }, { kind: 'write-cells', writes: inverseWrites });
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

function applyVisualScaleChange(workbook: Workbook, operation: Extract<WorkbookOperation, { kind: 'set-sheet-visual-scale' }>): WorkbookOperationResult {
  const sheet = findSheetById(workbook, operation.sheetId);
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  if (!isValidSheetVisualScale(operation.visualScale)) return { ok: false, reason: 'invalid-visual-scale' };
  if (operation.visualScale === sheet.frame.visualScale) return noChange(workbook);
  const frame = { ...sheet.frame, visualScale: operation.visualScale };
  return sheetSuccess(workbook, { ...sheet, frame }, { kind: 'none' },
    { kind: 'update-sheet-visual-scale', sheetId: sheet.id, visualScale: operation.visualScale },
    { kind: 'set-sheet-visual-scale', sheetId: sheet.id, visualScale: sheet.frame.visualScale });
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

function applyAxisSizes(workbook: Workbook, operation: Extract<WorkbookOperation, { kind: 'write-axis-sizes' }>): WorkbookOperationResult {
  const sheet = findSheetById(workbook, operation.sheetId);
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  if (!validAxisSizeWrites(sheet.content, operation.writes)) return { ok: false, reason: 'invalid-axis-size' };
  const priorSize = (write: AxisSizeWrite) => {
    const overrides = write.axis === 'row' ? sheet.presentation.rowHeights : sheet.presentation.columnWidths;
    return Object.prototype.hasOwnProperty.call(overrides, write.axisId) ? overrides[write.axisId] : null;
  };
  const writes = operation.writes.filter((write) => priorSize(write) !== write.size);
  if (writes.length === 0) return noChange(workbook);
  const inverse = writes.map((write) => ({ ...write, size: priorSize(write) }));
  return sheetSuccess(workbook, { ...sheet, presentation: applyAxisSizeWrites(sheet.presentation, writes) }, { kind: 'none' },
    { kind: 'write-axis-sizes', sheetId: sheet.id, writes: writes.map((write) => ({ ...write })) },
    { kind: 'write-axis-sizes', sheetId: sheet.id, writes: inverse });
}

function applyNumberFormats(workbook: Workbook, operation: Extract<WorkbookOperation, { kind: 'write-number-formats' }>): WorkbookOperationResult {
  const sheet = findSheetById(workbook, operation.sheetId);
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  if (!validFormatWrites(sheet.content, operation.writes)) return { ok: false, reason: 'invalid-number-format' };
  const current = sheet.presentation.formatOverrides ?? emptySheetFormatOverrides();
  const previous = (write: FormatWrite) => (write.scope === 'row' ? current.rows : write.scope === 'column' ? current.columns : current.cells)[write.targetId]?.numberFormat ?? null;
  const writes = operation.writes.filter((write) => JSON.stringify(previous(write)) !== JSON.stringify(write.numberFormat));
  if (writes.length === 0) return noChange(workbook);
  const inverse = writes.map((write) => ({ ...write, numberFormat: previous(write) }));
  return sheetSuccess(workbook, { ...sheet, presentation: { ...sheet.presentation, formatOverrides: applyFormatWrites(current, writes) } }, { kind: 'none' },
    { kind: 'write-number-formats', sheetId: sheet.id, writes: writes.map((write) => ({ ...write, numberFormat: write.numberFormat && { ...write.numberFormat } })) },
    { kind: 'write-number-formats', sheetId: sheet.id, writes: inverse });
}
