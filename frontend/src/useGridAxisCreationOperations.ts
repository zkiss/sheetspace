import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreatingGridAxes, CreatingGridAxisSlot } from './gridAxisProjection';
import { findSheetById } from './workbookQueries';
import { type Workbook } from './workbookModel';
import { WorkbookApiError, workbookApi, type WorkbookApi } from './workbookApi';
import type { SetWorkbook } from './workbookCalculation';
import { WorkbookPersistenceCoordinator } from './workbookPersistenceCoordinator';

type AxisKind = 'row' | 'column';
type AxisCreationStatus = 'queued' | 'running' | 'failed' | 'succeeded' | 'superseded';
type AxisCreation = {
  operationId: string;
  sheetId: string;
  axis: AxisKind;
  status: AxisCreationStatus;
  sequence: number;
  failure?: unknown;
};

class GridAxisCreationQueue {
  private entries: AxisCreation[] = [];
  private listeners = new Set<(entries: readonly AxisCreation[]) => void>();
  private nextSequence = 1;
  private deletingSheets = new Set<string>();
  private missingSheets = new Set<string>();
  private running = new Set<string>();
  private idleWaiters: Array<{ sheetId: string; resolve: () => void }> = [];

  snapshot() { return this.entries.map((entry) => ({ ...entry })); }
  subscribe(listener: (entries: readonly AxisCreation[]) => void) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => { this.listeners.delete(listener); };
  }
  enqueue(entry: Omit<AxisCreation, 'sequence' | 'status'>) {
    if (this.deletingSheets.has(entry.sheetId) || this.missingSheets.has(entry.sheetId)) return;
    for (const existing of this.entries) {
      if (existing.status === 'failed' && existing.sheetId === entry.sheetId) existing.status = 'superseded';
    }
    this.entries.push({ ...entry, sequence: this.nextSequence++, status: 'queued' });
    this.publish();
  }
  prepareSheetDeletion(sheetId: string): Promise<void> | undefined {
    this.deletingSheets.add(sheetId);
    let changed = false;
    for (const entry of this.entries) {
      if (entry.sheetId !== sheetId || (entry.status !== 'queued' && entry.status !== 'failed')) continue;
      entry.status = 'superseded';
      changed = true;
    }
    if (changed) this.publish();
    if (!this.hasRunningSheetEntry(sheetId)) return undefined;
    return new Promise((resolve) => this.idleWaiters.push({ sheetId, resolve }));
  }
  confirmSheetMissing(sheetId: string, exceptOperationId?: string) {
    this.missingSheets.add(sheetId);
    let changed = false;
    for (const entry of this.entries) {
      if (entry.sheetId !== sheetId || entry.operationId === exceptOperationId) continue;
      if (entry.status === 'queued' || entry.status === 'running' || entry.status === 'failed') {
        entry.status = 'superseded';
        changed = true;
      }
    }
    if (changed) this.publish();
  }
  executeAvailable(execute: (entry: AxisCreation) => Promise<void>) {
    const executions: Promise<void>[] = [];
    let entry = this.nextRunnable();
    while (entry) {
      entry.status = 'running';
      this.running.add(entry.operationId);
      this.publish();
      const runningEntry = entry;
      executions.push(execute({ ...runningEntry }).then(
        () => {
          if (runningEntry.status !== 'superseded') runningEntry.status = 'succeeded';
        },
        (failure) => {
          if (runningEntry.status === 'superseded' || this.deletingSheets.has(runningEntry.sheetId)) runningEntry.status = 'superseded';
          else { runningEntry.status = 'failed'; runningEntry.failure = failure; }
        },
      ).finally(() => {
        this.running.delete(runningEntry.operationId);
        this.publish();
        this.resolveIdleWaiters(runningEntry.sheetId);
      }));
      entry = this.nextRunnable();
    }
    return executions;
  }
  private nextRunnable() {
    return this.entries.find((candidate) => candidate.status === 'queued'
      && !this.missingSheets.has(candidate.sheetId)
      && !this.entries.some((earlier) =>
      earlier.sequence < candidate.sequence
      && earlier.sheetId === candidate.sheetId
      && (earlier.status === 'queued' || earlier.status === 'running')));
  }
  private hasRunningSheetEntry(sheetId: string) {
    return this.entries.some((entry) => entry.sheetId === sheetId && this.running.has(entry.operationId));
  }
  private resolveIdleWaiters(sheetId: string) {
    if (this.hasRunningSheetEntry(sheetId)) return;
    const ready = this.idleWaiters.filter((waiter) => waiter.sheetId === sheetId);
    this.idleWaiters = this.idleWaiters.filter((waiter) => waiter.sheetId !== sheetId);
    ready.forEach(({ resolve }) => resolve());
  }
  private publish() {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

/** Backend-authoritative row/column creation, kept separate from replayable workbook operations. */
export function useGridAxisCreationOperations({
  autosaveEnabled,
  currentWorkbook,
  persistenceCoordinator,
  reconcile,
  resolvedApiClient,
  setWorkbook,
}: {
  autosaveEnabled: boolean;
  currentWorkbook: () => Workbook;
  persistenceCoordinator: WorkbookPersistenceCoordinator;
  reconcile: (entry: { kind: 'append-row'; sheetId: string; rowId: string } | { kind: 'append-column'; sheetId: string; columnId: string }) => void;
  resolvedApiClient: Partial<WorkbookApi>;
  setWorkbook: SetWorkbook;
}) {
  const queueRef = useRef<GridAxisCreationQueue | undefined>(undefined);
  queueRef.current ??= new GridAxisCreationQueue();
  const queue = queueRef.current;
  const [snapshot, setSnapshot] = useState<readonly AxisCreation[]>(() => queue.snapshot());
  const reconcileRef = useRef(reconcile);
  reconcileRef.current = reconcile;

  for (const sheet of Object.values(currentWorkbook().documents)) {
    persistenceCoordinator.recordRevision(sheet.id, sheet.revision);
  }

  useEffect(() => queue.subscribe(setSnapshot), [queue]);
  useEffect(() => persistenceCoordinator.subscribeToMissingSheets((sheetId, source) => {
    queue.confirmSheetMissing(sheetId, source.axisOperationId);
  }), [persistenceCoordinator, queue]);

  const recordRevision = useCallback((sheetId: string, revision: number) => {
    const recordedRevision = persistenceCoordinator.recordRevision(sheetId, revision);
    setWorkbook((workbook) => {
      const sheet = findSheetById(workbook, sheetId);
      if (!sheet || sheet.revision >= recordedRevision) return workbook;
      return { ...workbook, documents: { ...workbook.documents, [sheetId]: { ...sheet, revision: recordedRevision } } };
    }, { kind: 'none' });
  }, [persistenceCoordinator, setWorkbook]);

  const execute = useCallback(async (entry: AxisCreation) => {
    const request = async (revision: number | undefined) => entry.axis === 'row'
      ? (resolvedApiClient.appendRow ?? workbookApi.appendRow)(entry.sheetId, { revision })
      : (resolvedApiClient.appendColumn ?? workbookApi.appendColumn)(entry.sheetId, { revision });
    const revision = () => persistenceCoordinator.revision(entry.sheetId)
      ?? findSheetById(currentWorkbook(), entry.sheetId)?.revision;
    let response;
    try {
      response = await request(revision());
    } catch (failure) {
      if (!(failure instanceof WorkbookApiError) || failure.status !== 409 || failure.code !== 'sheet-revision-conflict') throw failure;
      try {
        const latest = await (resolvedApiClient.loadSheet ?? workbookApi.loadSheet)(entry.sheetId);
        recordRevision(latest.id, latest.revision);
        response = await request(revision());
      } catch (reloadFailure) {
        if (reloadFailure instanceof WorkbookApiError && reloadFailure.status === 404 && reloadFailure.code === 'sheet-not-found') {
          persistenceCoordinator.confirmSheetMissing(entry.sheetId, { axisOperationId: entry.operationId });
          return;
        }
        throw reloadFailure;
      }
    }
    recordRevision(response.sheetId, response.revision);
    if ('rowId' in response) reconcileRef.current({ kind: 'append-row', sheetId: entry.sheetId, rowId: response.rowId });
    else reconcileRef.current({ kind: 'append-column', sheetId: entry.sheetId, columnId: response.columnId });
  }, [currentWorkbook, persistenceCoordinator, recordRevision, resolvedApiClient]);

  const pump = useCallback(function pumpAvailable() {
    for (const execution of queue.executeAvailable(execute)) void execution.finally(pumpAvailable);
  }, [execute, queue]);

  const append = useCallback((sheetId: string, axis: AxisKind) => {
    if (!autosaveEnabled || persistenceCoordinator.isSheetMissing(sheetId) || !findSheetById(currentWorkbook(), sheetId)) return;
    queue.enqueue({ operationId: crypto.randomUUID(), sheetId, axis });
    pump();
  }, [autosaveEnabled, currentWorkbook, persistenceCoordinator, pump, queue]);

  const creatingAxes: Record<string, CreatingGridAxes> = {};
  for (const entry of snapshot) {
    if (entry.status !== 'queued' && entry.status !== 'running') continue;
    const axes = creatingAxes[entry.sheetId] ?? { rows: [], columns: [] };
    const slot: CreatingGridAxisSlot = { kind: 'creating', operationId: entry.operationId, boundary: Number.MAX_SAFE_INTEGER };
    creatingAxes[entry.sheetId] = entry.axis === 'row'
      ? { ...axes, rows: [...axes.rows, slot] }
      : { ...axes, columns: [...axes.columns, slot] };
  }
  const failed = snapshot.some((entry) => entry.status === 'failed');
  const saving = snapshot.some((entry) => entry.status === 'queued' || entry.status === 'running');

  return {
    appendColumn: (sheetId: string) => append(sheetId, 'column'),
    appendRow: (sheetId: string) => append(sheetId, 'row'),
    creatingAxes,
    prepareSheetDeletion: (sheetId: string) => queue.prepareSheetDeletion(sheetId),
    saveStatus: failed ? 'failed' as const : saving ? 'saving' as const : 'saved' as const,
  };
}
