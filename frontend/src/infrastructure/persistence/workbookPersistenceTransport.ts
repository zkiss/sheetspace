import { type SheetId, type StableCellIdentity } from '@workbook/core/model';
import type { WorkbookPersistenceIntent } from '@application/core/userActions';
import { WorkbookApiError, workbookApi, type WorkbookApi } from './workbookApi';
import { type OutboxEntry, type PersistenceTransport, type TransportResult } from './workbookOutbox';
import { WorkbookPersistenceCoordinator } from './workbookPersistenceCoordinator';

/** Concrete HTTP adapter for the framework-independent outbox state machine. */
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
      if (isMissingSheet(failure) && affectedSheetIds.length === 1) return { kind: 'missing-sheet', sheetIds: [affectedSheetIds[0]] };
      throw failure;
    }
  }
  private async executeWithRetry(intent: WorkbookPersistenceIntent, affectedSheetIds: readonly SheetId[]) {
    try { return await this.request(intent); }
    catch (failure) {
      if (!isRevisionConflict(failure)) throw failure;
      const latest = await Promise.all(affectedSheetIds.map(async (sheetId) => {
        try { return { kind: 'loaded' as const, sheet: await this.method('loadSheet')(sheetId) }; }
        catch (reloadFailure) { if (isMissingSheet(reloadFailure)) return { kind: 'missing' as const, sheetId }; throw reloadFailure; }
      }));
      const missingSheetIds = latest.flatMap((result) => result.kind === 'missing' ? [result.sheetId] : []);
      latest.forEach((result) => { if (result.kind === 'loaded') this.recordRevision(result.sheet.id, result.sheet.revision); });
      if (missingSheetIds.length > 0) {
        if (intent.kind !== 'update-sheet-z-order') return { kind: 'missing-sheet' as const, sheetIds: missingSheetIds };
        const missing = new Set(missingSheetIds);
        const updates = intent.updates.filter(({ sheetId }) => !missing.has(sheetId));
        if (updates.length === 0) return { kind: 'missing-sheet' as const, sheetIds: missingSheetIds };
        const saved = await this.request({ kind: 'update-sheet-z-order', updates });
        return saved.kind === 'saved' ? { ...saved, missingSheetIds } : saved;
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
    const updates = intent.updates.map((update) => { const expectedRevision = this.revision(update.sheetId); return expectedRevision === undefined ? undefined : { ...update, expectedRevision }; });
    if (updates.some((update) => update === undefined)) return { kind: 'blocked', reason: 'Missing revision for a z-order update.' };
    return this.recordMany((await this.method('updateSheetZOrder')(updates as { sheetId: SheetId; zIndex: number; expectedRevision: number }[])).sheets);
  }
  private record(response: { sheetId: SheetId; revision: number }) { return this.recordMany([response]); }
  private recordMany(revisions: readonly { sheetId: SheetId; revision: number }[]): TransportResult { return { kind: 'saved', revisions: this.coordinator.recordRevisions(revisions) }; }
  private method<K extends keyof WorkbookApi>(name: K): WorkbookApi[K] { return (this.api[name] ?? workbookApi[name]) as WorkbookApi[K]; }
}

function isRevisionConflict(error: unknown) { return error instanceof WorkbookApiError && error.status === 409 && error.code === 'sheet-revision-conflict'; }
function isMissingSheet(error: unknown) { return error instanceof WorkbookApiError && error.status === 404 && error.code === 'sheet-not-found'; }
