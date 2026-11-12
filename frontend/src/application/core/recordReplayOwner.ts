import type { ContentHistory, ContentTransaction } from './contentHistory';
import { recordReplayDisposition, type ReplayOperation } from './replayEntryRecord';

export class RecordReplayOwner {
  private pending = false;
  private retained?: { identity: number; operation: ReplayOperation };

  constructor(private readonly history: ContentHistory) {}

  async replay(transaction: ContentTransaction, direction: 'undo' | 'redo', execute: (operation: ReplayOperation) => Promise<unknown>) {
    if (this.pending) throw new Error('Record replay is already pending.');
    const current = direction === 'undo' ? this.history.peekUndo() : this.history.peekRedo();
    if (current?.identity !== transaction.identity || !transaction.record) throw new Error('The history position changed.');
    if (this.retained && (this.retained.identity !== transaction.identity || this.retained.operation.direction !== direction)) {
      throw new Error('Resolve the pending record replay before continuing.');
    }
    const operation = this.retained?.operation ?? { ...transaction.record, direction, operationId: crypto.randomUUID() };
    this.retained = { identity: transaction.identity, operation };
    this.pending = true;
    try {
      await execute(operation);
      this.retained = undefined;
      if (!this.history.commitGuarded(direction, transaction.identity)) throw new Error('The history position changed during replay.');
    } catch (error) {
      if (recordReplayDisposition(operation) !== 'unresolved') this.retained = undefined;
      throw error;
    } finally {
      this.pending = false;
    }
  }
}
