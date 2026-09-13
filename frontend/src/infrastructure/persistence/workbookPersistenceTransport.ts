import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { type SheetDocument, type SheetId } from '@workbook/core/model';
import type { WorkbookPersistenceIntent } from '@application/core/userActions';
import { WorkbookApiError, workbookApi, type WorkbookApi } from './workbookApi';
import { type OutboxEntry, type PersistenceTransport, type TransportResult } from './workbookOutbox';
import { WorkbookPersistenceCoordinator } from './workbookPersistenceCoordinator';

/** Concrete HTTP adapter for the framework-independent outbox state machine. */
export class WorkbookPersistenceTransport implements PersistenceTransport {
  constructor(
    private readonly api: Partial<WorkbookApi> = {},
    private readonly coordinator = new WorkbookPersistenceCoordinator(),
  ) {}
  revision(sheetId: SheetId) { return this.coordinator.revision(sheetId); }
  recordRevision(sheetId: SheetId, revision: number) { return this.coordinator.recordRevision(sheetId, revision); }

  async execute({ intent, affectedSheetIds }: Pick<OutboxEntry, 'intent' | 'affectedSheetIds'>): Promise<TransportResult> {
    try { return await this.coordinator.serialize(affectedSheetIds, () => this.executeKnownSheets(intent, affectedSheetIds)); }
    catch (failure) {
      if (isMissingSheet(failure) && affectedSheetIds.length === 1) return { kind: 'missing-sheet', sheetIds: [affectedSheetIds[0]] };
      throw failure;
    }
  }
  private async executeKnownSheets(intent: WorkbookPersistenceIntent, affectedSheetIds: readonly SheetId[]): Promise<TransportResult> {
    const missingSheetIds = affectedSheetIds.filter((sheetId) => this.coordinator.isSheetMissing(sheetId));
    if (missingSheetIds.length === 0) return this.executeWithRetry(intent, affectedSheetIds);
    if (intent.kind !== 'update-sheet-z-order') return { kind: 'missing-sheet', sheetIds: missingSheetIds };
    const updates = intent.updates.filter(({ sheetId }) => !missingSheetIds.includes(sheetId));
    if (updates.length === 0) return { kind: 'missing-sheet', sheetIds: missingSheetIds };
    const result = await this.executeWithRetry({ kind: 'update-sheet-z-order', updates }, updates.map(({ sheetId }) => sheetId));
    if (result.kind === 'saved') return { ...result, missingSheetIds: [...missingSheetIds, ...result.missingSheetIds ?? []] };
    if (result.kind === 'missing-sheet') return { ...result, sheetIds: [...missingSheetIds, ...result.sheetIds] };
    return result;
  }

  private async executeWithRetry(intent: WorkbookPersistenceIntent, affectedSheetIds: readonly SheetId[]) {
    try { return await this.request(intent); }
    catch (failure) {
      if (intent.kind === 'write-cells') return this.recoverCellWrite(intent, failure);
      if (!isRevisionConflict(failure)) throw failure;
      const latest = await this.loadSheets(affectedSheetIds);
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
  private async recoverCellWrite(intent: Extract<WorkbookPersistenceIntent, { kind: 'write-cells' }>, failure: unknown): Promise<TransportResult> {
    if (!isRevisionConflict(failure) && !isAmbiguousResponse(failure)) throw failure;
    const latest = await this.loadSheets([...new Set(intent.writes.map(({ sheetId }) => sheetId))]);
    const missingSheetIds = latest.flatMap((result) => result.kind === 'missing' ? [result.sheetId] : []);
    if (missingSheetIds.length > 0) return { kind: 'missing-sheet', sheetIds: missingSheetIds };
    const sheets = latest.flatMap((result) => result.kind === 'loaded' ? [result.sheet] : []);
    sheets.forEach((sheet) => this.recordRevision(sheet.id, sheet.revision));
    if (matchesCellStates(intent.writes, sheets, 'afterRaw')) {
      return this.recordMany(sheets.map((sheet) => ({ sheetId: sheet.id, revision: sheet.revision })));
    }
    if (isRevisionConflict(failure) && matchesCellStates(intent.writes, sheets, 'beforeRaw')) {
      return this.request(intent);
    }
    throw failure;
  }
  private async loadSheets(sheetIds: readonly SheetId[]) {
    return Promise.all(sheetIds.map(async (sheetId) => {
      try { return { kind: 'loaded' as const, sheet: await this.method('loadSheet')(sheetId) }; }
      catch (reloadFailure) { if (isMissingSheet(reloadFailure)) return { kind: 'missing' as const, sheetId }; throw reloadFailure; }
    }));
  }
  private async request(intent: WorkbookPersistenceIntent): Promise<TransportResult> {
    if (intent.kind === 'write-axis-sizes') return this.record(await this.method('writeAxisSizes')(intent.sheetId, intent.writes, { revision: this.revision(intent.sheetId) }));
    if (intent.kind === 'write-cells') {
      const expectedRevisions = [...new Set(intent.writes.map(({ sheetId }) => sheetId))].map((sheetId) => {
        const revision = this.revision(sheetId);
        return revision === undefined ? undefined : { sheetId, revision };
      });
      if (expectedRevisions.some((revision) => revision === undefined)) return { kind: 'blocked', reason: 'Missing revision for a cell patch.' };
      const response = await this.method('writeCells')(
        expectedRevisions as { sheetId: SheetId; revision: number }[],
        intent.writes.map(({ sheetId, rowId, columnId, afterRaw }) => ({ sheetId, rowId, columnId, raw: afterRaw ?? '' })),
      );
      return this.recordMany(response.sheets);
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
function isAmbiguousResponse(error: unknown) { return !(error instanceof WorkbookApiError); }
function matchesCellStates(
  writes: Extract<WorkbookPersistenceIntent, { kind: 'write-cells' }>['writes'],
  sheets: readonly SheetDocument[],
  state: 'beforeRaw' | 'afterRaw',
) {
  const byId = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  return writes.every((write) => {
    const sheet = byId.get(write.sheetId);
    if (!sheet) return false;
    return (sheet.content.cells[cellIdentityKey(write)] ?? null) === write[state];
  });
}
