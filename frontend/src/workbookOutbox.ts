import { SheetId, StableCellIdentity } from './workbook/core/model';
import { WorkbookApiError, workbookApi, type WorkbookApi } from './workbookApi';
import { WorkbookPersistenceCoordinator } from './workbookPersistenceCoordinator';
import type { WorkbookOperationId, WorkbookPersistenceIntent } from './userActions';

export type OutboxStatus = 'queued' | 'running' | 'failed' | 'succeeded' | 'superseded' | 'blocked';
export type OutboxEntry = {
  operationId: WorkbookOperationId;
  intent: WorkbookPersistenceIntent;
  affectedSheetIds: readonly SheetId[];
  policy: 'replace-queued' | 'append';
  coalesceKey: string | undefined;
  status: OutboxStatus;
  failure: unknown | undefined;
  sequence: number;
};

export type OutboxSnapshot = readonly OutboxEntry[];
export type TransportResult =
  | {
    kind: 'saved';
    revisions: readonly { sheetId: SheetId; revision: number }[];
    missingSheetIds?: readonly SheetId[];
  }
  | { kind: 'missing-sheet'; sheetIds: readonly SheetId[] }
  | { kind: 'blocked'; reason: string };

export interface PersistenceTransport {
  execute(entry: Pick<OutboxEntry, 'operationId' | 'intent' | 'affectedSheetIds'>): Promise<TransportResult>;
}

/** In-memory, framework-independent persistence work. Entries never capture executable requests. */
export class WorkbookOutbox {
  private entries: OutboxEntry[] = [];
  private listeners = new Set<(snapshot: OutboxSnapshot) => void>();
  private nextSequence = 1;
  private running = new Set<WorkbookOperationId>();

  snapshot(): OutboxSnapshot { return this.entries.map(cloneEntry); }
  subscribe(listener: (snapshot: OutboxSnapshot) => void): () => void {
    this.listeners.add(listener); listener(this.snapshot()); return () => this.listeners.delete(listener);
  }
  inspect(operationId: WorkbookOperationId): OutboxEntry | undefined {
    const entry = this.find(operationId);
    return entry && cloneEntry(entry);
  }

  enqueue(operationId: WorkbookOperationId, intent: WorkbookPersistenceIntent): OutboxEntry {
    if (this.inspect(operationId)) throw new Error(`Duplicate outbox operation ${operationId}.`);
    const policy = policyFor(intent);
    const coalesceKey = coalesceKeyFor(intent);
    if (policy === 'replace-queued' && coalesceKey) {
      for (const entry of this.entries) {
        if (entry.status === 'queued' && entry.coalesceKey === coalesceKey) entry.status = 'superseded';
        if (entry.status === 'running' && entry.coalesceKey === coalesceKey) entry.status = 'superseded';
        // A later frame move replaces a failed predecessor too. Keep its failure
        // for inspection, but do not let the stale payload block the new intent.
        if (entry.status === 'failed' && entry.coalesceKey === coalesceKey) entry.status = 'superseded';
      }
    }
    const entry: OutboxEntry = { operationId, intent: cloneIntent(intent), affectedSheetIds: affectedSheets(intent), policy, coalesceKey, status: 'queued', failure: undefined, sequence: this.nextSequence++ };
    this.entries.push(entry); this.publish(); return cloneEntry(entry);
  }

  remove(operationId: WorkbookOperationId) { this.entries = this.entries.filter((entry) => entry.operationId !== operationId); this.publish(); }
  retry(operationId: WorkbookOperationId) {
    const entry = this.require(operationId);
    if (entry.status !== 'failed' && entry.status !== 'blocked') throw new Error(`Operation ${operationId} is not retryable.`);
    entry.status = 'queued'; this.publish();
  }

  /** Cancel replayable work made obsolete by deleting a sheet, without interrupting in-flight transport. */
  supersedeSheetOperations(sheetId: SheetId, exceptOperationId?: WorkbookOperationId) {
    let changed = false;
    for (const entry of this.entries) {
      if (entry.operationId === exceptOperationId || !entry.affectedSheetIds.includes(sheetId)) continue;
      if (entry.intent.kind === 'update-sheet-z-order') continue;
      if (entry.status === 'queued' || entry.status === 'running' || entry.status === 'failed' || entry.status === 'blocked') {
        entry.status = 'superseded';
        changed = true;
      }
    }
    if (changed) this.publish();
  }

  /** Cancel all work that cannot succeed after the backend confirms a sheet is absent. */
  supersedeMissingSheetOperations(sheetId: SheetId, exceptOperationId?: WorkbookOperationId) {
    let changed = false;
    for (const entry of this.entries) {
      if (entry.operationId === exceptOperationId || !entry.affectedSheetIds.includes(sheetId)) continue;
      if (entry.status === 'queued' || entry.status === 'running' || entry.status === 'failed' || entry.status === 'blocked') {
        entry.status = 'superseded';
        changed = true;
      }
    }
    if (changed) this.publish();
  }

  /** Start every operation that is currently independent and runnable. */
  executeAvailable(transport: PersistenceTransport): readonly Promise<OutboxEntry>[] {
    const executions: Promise<OutboxEntry>[] = [];
    let entry = this.nextRunnable();
    while (entry) {
      executions.push(this.executeEntry(entry, transport));
      entry = this.nextRunnable();
    }
    return executions;
  }

  async executeNext(transport: PersistenceTransport): Promise<OutboxEntry | undefined> {
    const entry = this.nextRunnable();
    if (!entry) return undefined;
    return this.executeEntry(entry, transport);
  }

  private async executeEntry(entry: OutboxEntry, transport: PersistenceTransport): Promise<OutboxEntry> {
    entry.status = 'running'; this.running.add(entry.operationId); this.publish();
    try {
      const result = await transport.execute({ operationId: entry.operationId, intent: cloneIntent(entry.intent), affectedSheetIds: [...entry.affectedSheetIds] });
      // A newer intent may have superseded this payload while it was in flight.
      if (!this.isSuperseded(entry)) {
        entry.status = result.kind === 'blocked' ? 'blocked' : 'succeeded';
        entry.failure = result.kind === 'blocked' ? new Error(result.reason) : undefined;
      }
    } catch (failure) {
      if (!this.isSuperseded(entry)) { entry.status = 'failed'; entry.failure = failure; }
    }
    this.running.delete(entry.operationId); this.publish(); return cloneEntry(entry);
  }

  private nextRunnable() { return this.entries.find((candidate) => candidate.status === 'queued' && this.canRun(candidate)); }
  private canRun(entry: OutboxEntry) {
    return !this.entries.some((earlier) => {
      if (earlier.sequence >= entry.sequence || !intersects(earlier.affectedSheetIds, entry.affectedSheetIds)) return false;
      if (earlier.status === 'succeeded') return false;
      if (earlier.status === 'superseded') return this.running.has(earlier.operationId);
      if (entry.intent.kind === 'delete-sheet' && (earlier.status === 'failed' || earlier.status === 'blocked')) return false;
      return true;
    });
  }
  private find(operationId: WorkbookOperationId) { return this.entries.find((entry) => entry.operationId === operationId); }
  private require(operationId: WorkbookOperationId) { const entry = this.find(operationId); if (!entry) throw new Error(`Unknown outbox operation ${operationId}.`); return entry; }
  private isSuperseded(entry: OutboxEntry) { return entry.status === 'superseded'; }
  private publish() { const snapshot = this.snapshot(); this.listeners.forEach((listener) => listener(snapshot)); }
}

export class WorkbookPersistenceTransport implements PersistenceTransport {
  constructor(
    private readonly api: Partial<WorkbookApi> = {},
    private readonly resolveCellAddress?: (sheetId: SheetId, cell: StableCellIdentity) => string | undefined,
    private readonly coordinator = new WorkbookPersistenceCoordinator(),
  ) {}
  revision(sheetId: SheetId) { return this.coordinator.revision(sheetId); }
  recordRevision(sheetId: SheetId, revision: number) { return this.coordinator.recordRevision(sheetId, revision); }

  async execute({ intent, affectedSheetIds }: Pick<OutboxEntry, 'intent' | 'affectedSheetIds'>): Promise<TransportResult> {
    try { return await this.executeWithRetry(intent, affectedSheetIds); }
    catch (failure) {
      if (isMissingSheet(failure) && affectedSheetIds.length === 1) {
        return { kind: 'missing-sheet', sheetIds: [affectedSheetIds[0]] };
      }
      throw failure;
    }
  }
  private async executeWithRetry(intent: WorkbookPersistenceIntent, affectedSheetIds: readonly SheetId[]) {
    try { return await this.request(intent); }
    catch (failure) {
      if (!isRevisionConflict(failure)) throw failure;
      const latest = await Promise.all(affectedSheetIds.map(async (sheetId) => {
        try { return { kind: 'loaded' as const, sheet: await this.method('loadSheet')(sheetId) }; }
        catch (reloadFailure) {
          if (isMissingSheet(reloadFailure)) return { kind: 'missing' as const, sheetId };
          throw reloadFailure;
        }
      }));
      const missingSheetIds = latest.flatMap((result) => result.kind === 'missing' ? [result.sheetId] : []);
      latest.forEach((result) => {
        if (result.kind === 'loaded') this.recordRevision(result.sheet.id, result.sheet.revision);
      });
      if (missingSheetIds.length > 0) {
        if (intent.kind !== 'update-sheet-z-order') {
          return { kind: 'missing-sheet' as const, sheetIds: missingSheetIds };
        }
        const missing = new Set(missingSheetIds);
        const survivingUpdates = intent.updates.filter(({ sheetId }) => !missing.has(sheetId));
        if (survivingUpdates.length === 0) {
          return { kind: 'missing-sheet' as const, sheetIds: missingSheetIds };
        }
        const survivorResult = await this.request({
          kind: 'update-sheet-z-order',
          updates: survivingUpdates,
        });
        if (survivorResult.kind !== 'saved') return survivorResult;
        return { ...survivorResult, missingSheetIds };
      }
      return this.request(intent);
    }
  }
  private async request(intent: WorkbookPersistenceIntent): Promise<TransportResult> {
    if (intent.kind === 'write-cells') {
      if (intent.writes.length !== 1) return { kind: 'blocked', reason: 'Batch cell persistence requires a batch endpoint.' };
      const address = this.resolveCellAddress?.(intent.sheetId, intent.writes[0].cell);
      if (!address) return { kind: 'blocked', reason: 'Cannot resolve a stable cell identity to a transport address.' };
      return this.record(await this.method('updateCellContent')(intent.sheetId, address, intent.writes[0].raw, { revision: this.revision(intent.sheetId) }));
    }
    if (intent.kind === 'delete-sheet') { await this.method('deleteSheet')(intent.sheetId, { revision: this.revision(intent.sheetId) }); return { kind: 'saved', revisions: [] }; }
    if (intent.kind === 'rename-sheet') return this.record(await this.method('renameSheet')(intent.sheetId, intent.name, { revision: this.revision(intent.sheetId) }));
    if (intent.kind === 'update-sheet-position') return this.record(await this.method('updateSheetPosition')(intent.sheetId, intent.position, { revision: this.revision(intent.sheetId) }));
    if (intent.kind === 'update-sheet-frame-layout') return this.record(await this.method('updateSheetFrameLayout')(intent.sheetId, intent.position, intent.size, { revision: this.revision(intent.sheetId) }));
    const updates = intent.updates.map((update) => {
      const expectedRevision = this.revision(update.sheetId);
      return expectedRevision === undefined ? undefined : { ...update, expectedRevision };
    });
    if (updates.some((update) => update === undefined)) return { kind: 'blocked', reason: 'Missing revision for a z-order update.' };
    const response = await this.method('updateSheetZOrder')(updates as { sheetId: SheetId; zIndex: number; expectedRevision: number }[]);
    return this.recordMany(response.sheets);
  }
  private record(response: { sheetId: SheetId; revision: number }) { return this.recordMany([response]); }
  private recordMany(revisions: readonly { sheetId: SheetId; revision: number }[]): TransportResult {
    return { kind: 'saved', revisions: this.coordinator.recordRevisions(revisions) };
  }
  private method<K extends keyof WorkbookApi>(name: K): WorkbookApi[K] { return (this.api[name] ?? workbookApi[name]) as WorkbookApi[K]; }
}

function affectedSheets(intent: WorkbookPersistenceIntent): SheetId[] { return intent.kind === 'update-sheet-z-order' ? [...new Set(intent.updates.map(({ sheetId }) => sheetId))] : [intent.sheetId]; }
function cloneEntry(entry: OutboxEntry): OutboxEntry { return { ...entry, intent: cloneIntent(entry.intent), affectedSheetIds: [...entry.affectedSheetIds] }; }
function cloneIntent(intent: WorkbookPersistenceIntent): WorkbookPersistenceIntent {
  switch (intent.kind) {
    case 'delete-sheet': return { ...intent };
    case 'rename-sheet': return { ...intent };
    case 'update-sheet-position': return { ...intent, position: { ...intent.position } };
    case 'update-sheet-frame-layout': return { ...intent, position: { ...intent.position }, size: { ...intent.size } };
    case 'update-sheet-z-order': return { ...intent, updates: intent.updates.map((update) => ({ ...update })) };
    case 'write-cells': return { ...intent, writes: intent.writes.map((write) => ({ ...write, cell: { ...write.cell } })) };
  }
}
function policyFor(intent: WorkbookPersistenceIntent): OutboxEntry['policy'] {
  return intent.kind === 'update-sheet-position' || intent.kind === 'update-sheet-frame-layout'
    ? 'replace-queued'
    : 'append';
}
function coalesceKeyFor(intent: WorkbookPersistenceIntent): string | undefined {
  if (intent.kind === 'update-sheet-position') return `position:${intent.sheetId}`;
  if (intent.kind === 'update-sheet-frame-layout') return `layout:${intent.sheetId}`;
  return undefined;
}
function intersects(left: readonly string[], right: readonly string[]) { return left.some((value) => right.includes(value)); }
function isRevisionConflict(error: unknown) { return error instanceof WorkbookApiError && error.status === 409 && error.code === 'sheet-revision-conflict'; }
function isMissingSheet(error: unknown) { return error instanceof WorkbookApiError && error.status === 404 && error.code === 'sheet-not-found'; }
