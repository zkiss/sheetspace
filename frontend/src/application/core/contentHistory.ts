import type { AffectedWorkbookEntities, CellPersistenceWrite } from './userActions';
import type { Workbook } from '@workbook/core/model';
import type { LocalRecordDelta } from './localRecordReplay';

export const CONTENT_HISTORY_MAX_ENTRIES = 100;
export const CONTENT_HISTORY_MAX_BYTES = 64 * 1024;
export const EXTRACTION_HISTORY_MAX_BYTES = 16 * 1024 * 1024;

export type ContentTransaction = {
  identity: number;
  kind: 'cells' | 'extraction' | 'axis-order' | 'model-record';
  writes: readonly CellPersistenceWrite[];
  affected: AffectedWorkbookEntities;
  bytes: number;
  snapshots?: { before: Workbook; after: Workbook };
  order?: { sheetId: string; axis: 'row' | 'column'; before: readonly string[]; after: readonly string[] };
  record?: { sheetId: string; rowId: string };
  localRecord?: LocalRecordDelta;
};

function extractionBytes(before: Workbook, after: Workbook) {
  return new TextEncoder().encode(JSON.stringify({ before, after })).byteLength;
}

function cloneTransaction(transaction: ContentTransaction): ContentTransaction {
  return {
    identity: transaction.identity,
    kind: transaction.kind,
    writes: transaction.writes.map((write) => ({ ...write })),
    affected: {
      sheetIds: [...transaction.affected.sheetIds],
      cells: transaction.affected.cells.map(({ sheetId, cell }) => ({ sheetId, cell: { ...cell } })),
    },
    bytes: transaction.bytes,
    ...(transaction.snapshots && { snapshots: structuredClone(transaction.snapshots) }),
    ...(transaction.order && { order: structuredClone(transaction.order) }),
    ...(transaction.record && { record: { ...transaction.record } }),
    ...(transaction.localRecord && { localRecord: structuredClone(transaction.localRecord) }),
  };
}

/** Session-local, bounded history. Oversized cell transactions are not retained. */
export class ContentHistory {
  private nextIdentity = 0;
  private undoStack: ContentTransaction[] = [];
  private redoStack: ContentTransaction[] = [];
  private undoBytes = 0;
  private redoBytes = 0;

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  clear() { this.undoStack = []; this.undoBytes = 0; this.clearRedo(); }
  /** Returns a copy so inspection cannot alter a transaction retained for replay. */
  peekUndo() { const transaction = this.undoStack[this.undoStack.length - 1]; return transaction && cloneTransaction(transaction); }
  /** Returns a copy so inspection cannot alter a transaction retained for replay. */
  peekRedo() { const transaction = this.redoStack[this.redoStack.length - 1]; return transaction && cloneTransaction(transaction); }

  record(writes: readonly CellPersistenceWrite[], affected: AffectedWorkbookEntities) {
    const transaction = cloneTransaction({
      identity: this.nextIdentity++, kind: 'cells',
      writes,
      affected,
      bytes: new TextEncoder().encode(JSON.stringify({ writes, affected, identity: this.nextIdentity - 1 })).byteLength,
    });
    this.clearRedo();
    if (transaction.bytes > CONTENT_HISTORY_MAX_BYTES) { this.clear(); return; }
    this.undoStack.push(transaction); this.undoBytes += transaction.bytes;
    this.trimUndo();
  }
  /** Check before applying an extraction; serialize edits until it is recorded. */
  canRecordExtraction(before: Workbook, after: Workbook) {
    return extractionBytes(before, after) + this.identityBytes() <= EXTRACTION_HISTORY_MAX_BYTES;
  }
  recordExtraction(before: Workbook, after: Workbook) {
    const bytes = extractionBytes(before, after) + this.identityBytes();
    if (bytes > EXTRACTION_HISTORY_MAX_BYTES) return { ok: false, reason: 'extraction-history-too-large' } as const;
    const transaction: ContentTransaction = {
      identity: this.nextIdentity++, kind: 'extraction', writes: [], affected: { sheetIds: [...new Set([...before.manifest.sheetIds, ...after.manifest.sheetIds])], cells: [] },
      bytes, snapshots: structuredClone({ before, after }),
    };
    this.clearRedo();
    this.pushUndo(transaction);
    return { ok: true } as const;
  }
  recordOrder(order: NonNullable<ContentTransaction['order']>) {
    const bytes = new TextEncoder().encode(JSON.stringify(order)).byteLength + this.identityBytes();
    if (bytes > CONTENT_HISTORY_MAX_BYTES) return { ok: false, reason: 'order-history-too-large' } as const;
    this.clearRedo();
    this.pushUndo(cloneTransaction({ identity: this.nextIdentity++, kind: 'axis-order', order, writes: [], affected: { sheetIds: [order.sheetId], cells: [] }, bytes }));
    return { ok: true } as const;
  }
  recordModelRecord(record: NonNullable<ContentTransaction['record']>, localRecord?: LocalRecordDelta) {
    const bytes = new TextEncoder().encode(JSON.stringify({ record, localRecord })).byteLength + this.identityBytes();
    if (bytes > CONTENT_HISTORY_MAX_BYTES) { this.clear(); return; }
    this.clearRedo();
    this.pushUndo(cloneTransaction({ identity: this.nextIdentity++, kind: 'model-record', record, localRecord, writes: [], affected: { sheetIds: [record.sheetId], cells: [] }, bytes }));
  }
  commitUndo() { const transaction = this.undoStack.pop(); if (!transaction) return; this.undoBytes -= transaction.bytes; this.pushRedo(transaction); }
  commitRedo() { const transaction = this.redoStack.pop(); if (!transaction) return; this.redoBytes -= transaction.bytes; this.pushUndo(transaction); }

  commitGuarded(direction: 'undo' | 'redo', identity: number) {
    const current = direction === 'undo' ? this.peekUndo() : this.peekRedo();
    if (!current || current.identity !== identity) return false;
    if (direction === 'undo') this.commitUndo(); else this.commitRedo();
    return true;
  }

  private identityBytes() { return new TextEncoder().encode(JSON.stringify(this.nextIdentity)).byteLength; }
  private clearRedo() { this.redoStack = []; this.redoBytes = 0; }
  private pushUndo(transaction: ContentTransaction) { this.undoStack.push(transaction); this.undoBytes += transaction.bytes; this.trimUndo(); }
  private pushRedo(transaction: ContentTransaction) { this.redoStack.push(transaction); this.redoBytes += transaction.bytes; }
  private trimUndo() {
    const bytesFor = (kind: ContentTransaction['kind']) => this.undoStack.reduce((sum, entry) => sum + (entry.kind === kind ? entry.bytes : 0), 0);
    while (this.undoStack.length > CONTENT_HISTORY_MAX_ENTRIES || bytesFor('cells') + bytesFor('axis-order') + bytesFor('model-record') > CONTENT_HISTORY_MAX_BYTES || bytesFor('extraction') > EXTRACTION_HISTORY_MAX_BYTES) {
      const evicted = this.undoStack.shift()!; this.undoBytes -= evicted.bytes;
    }
  }
}
