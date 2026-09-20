import type { AffectedWorkbookEntities, CellPersistenceWrite } from './userActions';

export const CONTENT_HISTORY_MAX_ENTRIES = 100;
export const CONTENT_HISTORY_MAX_BYTES = 64 * 1024;

export type ContentTransaction = {
  writes: readonly CellPersistenceWrite[];
  affected: AffectedWorkbookEntities;
  bytes: number;
};

function cloneTransaction(transaction: ContentTransaction): ContentTransaction {
  return {
    writes: transaction.writes.map((write) => ({ ...write })),
    affected: {
      sheetIds: [...transaction.affected.sheetIds],
      cells: transaction.affected.cells.map(({ sheetId, cell }) => ({ sheetId, cell: { ...cell } })),
    },
    bytes: transaction.bytes,
  };
}

/** Session-local, bounded history. Oversized transactions are applied but not retained. */
export class ContentHistory {
  private undoStack: ContentTransaction[] = [];
  private redoStack: ContentTransaction[] = [];
  private undoBytes = 0;
  private redoBytes = 0;

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  /** Returns a copy so inspection cannot alter a transaction retained for replay. */
  peekUndo() { const transaction = this.undoStack[this.undoStack.length - 1]; return transaction && cloneTransaction(transaction); }
  /** Returns a copy so inspection cannot alter a transaction retained for replay. */
  peekRedo() { const transaction = this.redoStack[this.redoStack.length - 1]; return transaction && cloneTransaction(transaction); }

  record(writes: readonly CellPersistenceWrite[], affected: AffectedWorkbookEntities) {
    const transaction = cloneTransaction({
      writes,
      affected,
      bytes: new TextEncoder().encode(JSON.stringify({ writes, affected })).byteLength,
    });
    this.clearRedo();
    if (transaction.bytes > CONTENT_HISTORY_MAX_BYTES) return;
    this.undoStack.push(transaction); this.undoBytes += transaction.bytes;
    this.trimUndo();
  }
  commitUndo() { const transaction = this.undoStack.pop(); if (!transaction) return; this.undoBytes -= transaction.bytes; this.pushRedo(transaction); }
  commitRedo() { const transaction = this.redoStack.pop(); if (!transaction) return; this.redoBytes -= transaction.bytes; this.pushUndo(transaction); }

  private clearRedo() { this.redoStack = []; this.redoBytes = 0; }
  private pushUndo(transaction: ContentTransaction) { this.undoStack.push(transaction); this.undoBytes += transaction.bytes; this.trimUndo(); }
  private pushRedo(transaction: ContentTransaction) { this.redoStack.push(transaction); this.redoBytes += transaction.bytes; while (this.redoStack.length > CONTENT_HISTORY_MAX_ENTRIES || this.redoBytes > CONTENT_HISTORY_MAX_BYTES) { const evicted = this.redoStack.shift()!; this.redoBytes -= evicted.bytes; } }
  private trimUndo() { while (this.undoStack.length > CONTENT_HISTORY_MAX_ENTRIES || this.undoBytes > CONTENT_HISTORY_MAX_BYTES) { const evicted = this.undoStack.shift()!; this.undoBytes -= evicted.bytes; } }
}
