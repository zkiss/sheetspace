import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreatingGridAxes, CreatingGridAxisSlot } from '@application/core/gridAxisCreationState';
import { findSheetById } from '@workbook/read/queries';
import { type Workbook } from '@workbook/core/model';
import { WorkbookApiError, workbookApi, type WorkbookApi } from '@infrastructure/persistence/workbookApi';
import type { SetWorkbook } from '@calculation/workbookCalculation';
import { WorkbookPersistenceCoordinator } from '@infrastructure/persistence/workbookPersistenceCoordinator';

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
  hasUnsettled() { return this.entries.some((entry) => ['queued', 'running', 'failed'].includes(entry.status)); }
  admitsOwner(operationId: string) {
    const owner = this.entries.find((entry) => entry.operationId === operationId);
    return !!owner && owner.status === 'running' && this.running.size === 1 && this.running.has(operationId)
      && !this.entries.some((entry) => entry.operationId !== operationId && (entry.status === 'failed' || (entry.status === 'queued' && entry.sequence < owner.sequence)));
  }
  canExecute(entry: AxisCreation) {
    return !this.deletingSheets.has(entry.sheetId) && !this.missingSheets.has(entry.sheetId)
      && this.entries.some((item) => item.operationId === entry.operationId && item.status === 'running');
  }
  hasUnsettledSheet(sheetId: string) { return this.entries.some((entry) => entry.sheetId === sheetId && ['queued', 'running', 'failed'].includes(entry.status)); }
  subscribe(listener: (entries: readonly AxisCreation[]) => void) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => { this.listeners.delete(listener); };
  }
  enqueue(entry: Omit<AxisCreation, 'sequence' | 'status'>) {
    if (this.deletingSheets.has(entry.sheetId) || this.missingSheets.has(entry.sheetId)) return;
    this.retireFailedPredecessors(entry.sheetId, this.nextSequence);
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
  admitRecreation(sheetId: string) { this.missingSheets.delete(sheetId); }
  executeAvailable(execute: (entry: AxisCreation) => Promise<void>) {
    const executions: Promise<void>[] = [];
    let entry = this.nextRunnable();
    while (entry) {
      this.retireFailedPredecessors(entry.sheetId, entry.sequence);
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
    if (this.running.size) return undefined;
    return this.entries.find((candidate) => candidate.status === 'queued'
      && !this.missingSheets.has(candidate.sheetId)
      && !this.entries.some((earlier) =>
      earlier.sequence < candidate.sequence
      && earlier.sheetId === candidate.sheetId
      && (earlier.status === 'queued' || earlier.status === 'running')));
  }
  private retireFailedPredecessors(sheetId: string, sequence: number) {
    for (const entry of this.entries) {
      if (entry.sheetId === sheetId && entry.sequence < sequence && entry.status === 'failed') entry.status = 'superseded';
    }
  }
  private hasRunningSheetEntry(sheetId: string) {
    return this.entries.some((entry) => entry.sheetId === sheetId && this.running.has(entry.operationId));
  }
  private resolveIdleWaiters(sheetId: string) {
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
  beforeCreate,
  createSorted,
  waitForAxisOrders,
  hasPendingRecreation,
  currentWorkbook,
  persistenceCoordinator,
  reconcile,
  resolvedApiClient,
  setWorkbook,
}: {
  autosaveEnabled: boolean;
  beforeCreate?: () => Promise<void> | undefined;
  createSorted?: (entry: { operationId: string; sheetId: string; axis: AxisKind }) => boolean | Promise<boolean>;
  waitForAxisOrders?: (sheetId: string) => Promise<void> | undefined;
  hasPendingRecreation?: (sheetId: string) => boolean;
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
    persistenceCoordinator.seedRevision(sheet.id, sheet.revision);
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
    const wait = beforeCreate?.();
    if (wait) await wait;
    const orders = waitForAxisOrders?.(entry.sheetId);
    if (orders) await orders;
    const sheet = findSheetById(currentWorkbook(), entry.sheetId);
    if (!queue.canExecute(entry) || persistenceCoordinator.isSheetMissing(entry.sheetId) || !sheet || sheet.modelId) return;
    const sorted = createSorted?.(entry);
    if (typeof sorted === 'boolean' ? sorted : sorted && await sorted) return;
    return persistenceCoordinator.serialize([entry.sheetId], async () => {
      const currentSheet = findSheetById(currentWorkbook(), entry.sheetId);
      if (!queue.canExecute(entry) || persistenceCoordinator.isSheetMissing(entry.sheetId) || !currentSheet || currentSheet.modelId) return;
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
    });
  }, [beforeCreate, createSorted, currentWorkbook, persistenceCoordinator, queue, recordRevision, resolvedApiClient, waitForAxisOrders]);

  const pump = useCallback(function pumpAvailable() {
    for (const execution of queue.executeAvailable(execute)) void execution.finally(pumpAvailable);
  }, [execute, queue]);

  const append = useCallback((sheetId: string, axis: AxisKind) => {
    const sheet = findSheetById(currentWorkbook(), sheetId);
    if (!autosaveEnabled || !sheet || sheet.modelId) return;
    if (persistenceCoordinator.isSheetMissing(sheetId)) {
      if (!hasPendingRecreation?.(sheetId)) return;
    }
    queue.admitRecreation(sheetId);
    queue.enqueue({ operationId: crypto.randomUUID(), sheetId, axis });
    pump();
  }, [autosaveEnabled, currentWorkbook, hasPendingRecreation, persistenceCoordinator, pump, queue]);

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
    hasUnsettled: () => queue.hasUnsettled(),
    admitsOwner: (operationId: string) => queue.admitsOwner(operationId),
    hasUnsettledSheet: (sheetId: string) => queue.hasUnsettledSheet(sheetId),
    prepareSheetDeletion: (sheetId: string) => queue.prepareSheetDeletion(sheetId),
    saveStatus: failed ? 'failed' as const : saving ? 'saving' as const : 'saved' as const,
  };
}
