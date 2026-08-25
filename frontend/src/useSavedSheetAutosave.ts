import { useCallback, useRef, useState } from 'react';
import type { SaveStatus } from './appTypes';
import { findSheetById, type CellKey, type SheetDocument, type Workbook } from './workbook';
import type { SetWorkbook } from './workbookCalculation';
import {
  WorkbookApiError,
  workbookApi,
  type SheetRevisionResponse,
  type SheetZOrderUpdate,
  type UpdateSheetZOrderResponse,
  type WorkbookApi,
} from './workbookApi';

export type SavedSheetSaveTarget =
  | { kind: 'delete' }
  | { kind: 'rename' }
  | { kind: 'rows' }
  | { kind: 'columns' }
  | { kind: 'axis-append' }
  | { kind: 'cell-content'; cellKey: CellKey }
  | { kind: 'frame' }
  | { kind: 'z-index' };

const zOrderQueueOwner = Symbol('z-order-queue');
type QueueOwner = string | typeof zOrderQueueOwner;

type SavedSheetTask = {
  affectedSheetIds: ReadonlySet<string>;
  coalesceKey: string | null;
  execute: () => Promise<void>;
  ignoreFailure: (cause: unknown) => boolean;
  superseded: boolean;
};

type SavedSheetQueue = {
  running: SavedSheetTask | null;
  queued: SavedSheetTask[];
  sheetId: QueueOwner;
  target: SavedSheetSaveTarget;
};

type TargetQueues = Map<string | null, SavedSheetQueue>;
type SheetQueues = Map<SavedSheetSaveTarget['kind'], TargetQueues>;
type FailedTargets = Map<SavedSheetSaveTarget['kind'], Set<string | null>>;

function targetDetail(target: SavedSheetSaveTarget): string | null {
  if (target.kind === 'cell-content') return target.cellKey;
  return null;
}

function sheetHasWork(queues: SheetQueues | undefined): boolean {
  if (!queues) return false;
  for (const targetQueues of queues.values()) {
    for (const queue of targetQueues.values()) {
      if (queue.running || queue.queued.length > 0) return true;
    }
  }
  return false;
}

function sheetHasPreDeleteWork(queues: SheetQueues | undefined): boolean {
  if (!queues) return false;
  for (const [kind, targetQueues] of queues) {
    if (kind === 'delete') continue;
    for (const queue of targetQueues.values()) {
      if (queue.running || queue.queued.length > 0) return true;
    }
  }
  return false;
}

function removeSheet(workbook: Workbook, sheetId: string): Workbook {
  if (!findSheetById(workbook, sheetId)) return workbook;
  const documents = { ...workbook.documents };
  delete documents[sheetId];
  return {
    ...workbook,
    manifest: {
      ...workbook.manifest,
      sheetIds: workbook.manifest.sheetIds.filter((id) => id !== sheetId),
    },
    documents,
  };
}

export function useSavedSheetAutosave({
  autosaveEnabled,
  resolvedApiClient,
  setWorkbook,
  workbook,
}: {
  autosaveEnabled: boolean;
  resolvedApiClient: Partial<WorkbookApi>;
  setWorkbook: SetWorkbook;
  workbook: Workbook;
}) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const editQueues = useRef(new Map<QueueOwner, SheetQueues>());
  const failedTargets = useRef(new Map<QueueOwner, FailedTargets>());
  const knownSheetRevisions = useRef(new Map<string, number>());
  const sheetIdleWaiters = useRef(new Map<string, Array<() => void>>());

  const hasFailures = useCallback(() => {
    for (const sheetFailures of failedTargets.current.values()) {
      for (const details of sheetFailures.values()) {
        if (details.size > 0) return true;
      }
    }
    return false;
  }, []);

  const hasPendingEdits = useCallback(() => {
    for (const queues of editQueues.current.values()) {
      if (sheetHasWork(queues)) return true;
    }
    return false;
  }, []);

  const refreshSaveStatus = useCallback(() => {
    if (hasFailures()) {
      setSaveStatus('failed');
      return;
    }
    setSaveStatus(hasPendingEdits() ? 'saving' : 'saved');
  }, [hasFailures, hasPendingEdits]);

  const getQueue = useCallback((sheetId: QueueOwner, target: SavedSheetSaveTarget) => {
    const sheetQueues = editQueues.current.get(sheetId) ?? new Map();
    editQueues.current.set(sheetId, sheetQueues);
    const targetQueues = sheetQueues.get(target.kind) ?? new Map();
    sheetQueues.set(target.kind, targetQueues);
    const detail = targetDetail(target);
    let queue = targetQueues.get(detail);
    if (!queue) {
      queue = { running: null, queued: [], sheetId, target };
      targetQueues.set(detail, queue);
    }
    return queue;
  }, []);

  const removeQueue = useCallback((queue: SavedSheetQueue) => {
    const sheetQueues = editQueues.current.get(queue.sheetId);
    const targetQueues = sheetQueues?.get(queue.target.kind);
    const detail = targetDetail(queue.target);
    if (targetQueues?.get(detail) !== queue) return;
    targetQueues.delete(detail);
    if (targetQueues.size === 0) sheetQueues?.delete(queue.target.kind);
    if (sheetQueues?.size === 0) editQueues.current.delete(queue.sheetId);
  }, []);

  const clearFailure = useCallback((sheetId: QueueOwner, target: SavedSheetSaveTarget) => {
    const sheetFailures = failedTargets.current.get(sheetId);
    const details = sheetFailures?.get(target.kind);
    details?.delete(targetDetail(target));
    if (details?.size === 0) sheetFailures?.delete(target.kind);
    if (sheetFailures?.size === 0) failedTargets.current.delete(sheetId);
  }, []);

  const recordFailure = useCallback((sheetId: QueueOwner, target: SavedSheetSaveTarget) => {
    const sheetFailures = failedTargets.current.get(sheetId) ?? new Map();
    failedTargets.current.set(sheetId, sheetFailures);
    const details = sheetFailures.get(target.kind) ?? new Set();
    sheetFailures.set(target.kind, details);
    details.add(targetDetail(target));
  }, []);

  const notifySheetIdle = useCallback((sheetId: QueueOwner) => {
    if (typeof sheetId !== 'string') return;
    if (sheetHasPreDeleteWork(editQueues.current.get(sheetId))) return;
    const zOrderQueues = editQueues.current.get(zOrderQueueOwner);
    if (zOrderQueues) {
      for (const targetQueues of zOrderQueues.values()) {
        for (const queue of targetQueues.values()) {
          if (queue.running?.affectedSheetIds.has(sheetId)) return;
          if (queue.queued.some((task) => task.affectedSheetIds.has(sheetId))) return;
        }
      }
    }
    const waiters = sheetIdleWaiters.current.get(sheetId);
    if (!waiters) return;
    sheetIdleWaiters.current.delete(sheetId);
    for (const resolve of waiters) resolve();
  }, []);

  const startEditTask = useCallback(function start(
    queue: SavedSheetQueue,
    task: SavedSheetTask,
  ) {
    queue.running = task;
    task.execute()
      .catch((cause: unknown) => {
        if (!task.ignoreFailure(cause) && !task.superseded) recordFailure(queue.sheetId, queue.target);
      })
      .finally(() => {
        const nextTask = queue.queued.shift();
        queue.running = null;
        if (nextTask) {
          start(queue, nextTask);
          for (const sheetId of task.affectedSheetIds) notifySheetIdle(sheetId);
          refreshSaveStatus();
          return;
        }
        removeQueue(queue);
        for (const sheetId of task.affectedSheetIds) notifySheetIdle(sheetId);
        notifySheetIdle(queue.sheetId);
        refreshSaveStatus();
      });
  }, [notifySheetIdle, recordFailure, refreshSaveStatus, removeQueue]);

  const enqueueEdit = useCallback(<T,>({
    sheetId,
    target,
    run,
    reconcile,
    onFailure,
    coalesceKey = null,
    coalesce = true,
    affectedSheetIds,
    ignoreFailure = () => false,
  }: {
    sheetId: QueueOwner;
    target: SavedSheetSaveTarget;
    run: () => Promise<T>;
    reconcile?: (savedResult: T) => void;
    onFailure?: () => void;
    coalesceKey?: string | null;
    coalesce?: boolean;
    affectedSheetIds?: ReadonlySet<string>;
    ignoreFailure?: (cause: unknown) => boolean;
  }) => {
    if (!autosaveEnabled) return;
    const queue = getQueue(sheetId, target);
    clearFailure(sheetId, target);
    const task: SavedSheetTask = {
      affectedSheetIds: affectedSheetIds ?? new Set(typeof sheetId === 'string' ? [sheetId] : []),
      coalesceKey,
      execute: () => run()
        .then((savedResult) => {
          reconcile?.(savedResult);
        })
        .catch((cause: unknown) => {
          onFailure?.();
          throw cause;
        }),
      ignoreFailure,
      superseded: false,
    };
    if (queue.running) {
      if (coalesce && queue.running.coalesceKey === coalesceKey) {
        queue.running.superseded = true;
      }
      const lastQueued = queue.queued.at(-1);
      if (coalesce && lastQueued?.coalesceKey === coalesceKey) {
        queue.queued[queue.queued.length - 1] = task;
      } else {
        queue.queued.push(task);
      }
      refreshSaveStatus();
      return;
    }
    startEditTask(queue, task);
    refreshSaveStatus();
  }, [autosaveEnabled, clearFailure, getQueue, refreshSaveStatus, startEditTask]);

  const dropSheetQueuedTasks = useCallback((sheetId: string) => {
    const sheetQueues = editQueues.current.get(sheetId);
    if (sheetQueues) {
      for (const targetQueues of sheetQueues.values()) {
        for (const queue of targetQueues.values()) {
          queue.queued = [];
          if (!queue.running) removeQueue(queue);
        }
      }
    }
    failedTargets.current.delete(sheetId);
    notifySheetIdle(sheetId);
    refreshSaveStatus();
  }, [notifySheetIdle, refreshSaveStatus, removeQueue]);

  const waitForSheetIdle = useCallback((sheetId: string) => {
    const zOrderQueues = editQueues.current.get(zOrderQueueOwner);
    const hasZOrderWork = zOrderQueues && [...zOrderQueues.values()].some((targetQueues) =>
      [...targetQueues.values()].some((queue) =>
        queue.running?.affectedSheetIds.has(sheetId) ||
        queue.queued.some((task) => task.affectedSheetIds.has(sheetId))));
    if (!sheetHasPreDeleteWork(editQueues.current.get(sheetId)) && !hasZOrderWork) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const waiters = sheetIdleWaiters.current.get(sheetId) ?? [];
      waiters.push(resolve);
      sheetIdleWaiters.current.set(sheetId, waiters);
    });
  }, []);

  const recordRevision = useCallback((sheetId: string, revision: number) => {
    knownSheetRevisions.current.set(sheetId, revision);
    setWorkbook((currentWorkbook) => {
      const current = findSheetById(currentWorkbook, sheetId);
      if (!current) return currentWorkbook;
      return {
        ...currentWorkbook,
        documents: {
          ...currentWorkbook.documents,
          [sheetId]: { ...current, revision: Math.max(current.revision, revision) },
        },
      };
    }, { kind: 'none' });
  }, [setWorkbook]);

  const recordSheetRevision = useCallback((response: SheetRevisionResponse) => {
    recordRevision(response.sheetId, response.revision);
  }, [recordRevision]);

  const recordSheetDocumentRevision = useCallback((sheet: SheetDocument) => {
    recordRevision(sheet.id, sheet.revision);
  }, [recordRevision]);

  const currentSheetRevision = useCallback((sheetId: string) => {
    const localRevision = findSheetById(workbook, sheetId)?.revision;
    const knownRevision = knownSheetRevisions.current.get(sheetId);
    if (localRevision === undefined) return knownRevision;
    if (knownRevision === undefined) return localRevision;
    return Math.max(localRevision, knownRevision);
  }, [workbook.documents]);

  const runRevisionedEdit = useCallback(<T,>({
    sheetId,
    request,
    revisionOf,
  }: {
    sheetId: string;
    request: (revision: number | undefined) => Promise<T>;
    revisionOf: (response: T) => number | undefined;
  }): Promise<T | undefined> => {
    const startingRevision = currentSheetRevision(sheetId);
    const recordResponse = (response: T) => {
      const revision = revisionOf(response);
      if (revision !== undefined) recordRevision(sheetId, revision);
      return response;
    };
    return request(startingRevision).then(recordResponse).catch(async (cause: unknown) => {
      if (!(cause instanceof WorkbookApiError) || cause.status !== 409 || cause.code !== 'sheet-revision-conflict') {
        throw cause;
      }
      const loadSheet = resolvedApiClient.loadSheet ?? workbookApi.loadSheet;
      let latestSheet: SheetDocument;
      try {
        latestSheet = await loadSheet(sheetId);
      } catch (reloadCause: unknown) {
        if (
          reloadCause instanceof WorkbookApiError &&
          reloadCause.status === 404 &&
          reloadCause.code === 'sheet-not-found'
        ) {
          dropSheetQueuedTasks(sheetId);
          knownSheetRevisions.current.delete(sheetId);
          setWorkbook((currentWorkbook) => removeSheet(currentWorkbook, sheetId), { kind: 'structure' });
          return undefined;
        }
        throw reloadCause;
      }
      recordSheetDocumentRevision(latestSheet);
      return request(latestSheet.revision).then(recordResponse);
    });
  }, [currentSheetRevision, dropSheetQueuedTasks, recordRevision, recordSheetDocumentRevision, resolvedApiClient, setWorkbook]);

  const runRevisionedZOrder = useCallback(async ({
    updates,
    request,
  }: {
    updates: Array<{ sheetId: string; zIndex: number }>;
    request: (updates: SheetZOrderUpdate[]) => Promise<UpdateSheetZOrderResponse>;
  }): Promise<UpdateSheetZOrderResponse> => {
    const revisionedUpdates = (): SheetZOrderUpdate[] => updates.map((update) => {
      const expectedRevision = currentSheetRevision(update.sheetId);
      if (expectedRevision === undefined) {
        throw new Error(`Missing revision for saved sheet ${update.sheetId}.`);
      }
      return { ...update, expectedRevision };
    });
    const recordResponse = (response: UpdateSheetZOrderResponse) => {
      response.sheets.forEach(recordSheetRevision);
      return response;
    };

    try {
      return recordResponse(await request(revisionedUpdates()));
    } catch (cause: unknown) {
      if (!(cause instanceof WorkbookApiError) || cause.status !== 409 || cause.code !== 'sheet-revision-conflict') {
        throw cause;
      }
      const loadSheet = resolvedApiClient.loadSheet ?? workbookApi.loadSheet;
      const latestSheets = await Promise.all(updates.map((update) => loadSheet(update.sheetId)));
      latestSheets.forEach(recordSheetDocumentRevision);
      return recordResponse(await request(revisionedUpdates()));
    }
  }, [currentSheetRevision, recordSheetDocumentRevision, recordSheetRevision, resolvedApiClient]);

  const enqueueRevisionedEdit = useCallback(<T extends SheetRevisionResponse>({
    sheetId,
    target,
    request,
    coalesceKey,
    coalesce = true,
    reconcile,
    onFailure,
  }: {
    sheetId: string;
    target: SavedSheetSaveTarget;
    request: (sheetId: string, revision: number | undefined) => Promise<T>;
    coalesceKey?: string;
    coalesce?: boolean;
    reconcile?: (response: T | undefined) => void;
    onFailure?: () => void;
  }) => {
    enqueueEdit({
      sheetId,
      target,
      coalesceKey,
      coalesce,
      reconcile,
      onFailure,
      run: () => runRevisionedEdit({
        sheetId,
        request: (revision) => request(sheetId, revision),
        revisionOf: (response) => response.revision,
      }),
    });
  }, [enqueueEdit, runRevisionedEdit]);

  const enqueueZOrderEdit = useCallback(({
    affectedSheetIds,
    run,
    ignoreFailure = () => false,
  }: {
    affectedSheetIds: ReadonlySet<string>;
    run: () => Promise<unknown>;
    ignoreFailure?: (cause: unknown) => boolean;
  }) => {
    enqueueEdit({
      sheetId: zOrderQueueOwner,
      target: { kind: 'z-index' },
      affectedSheetIds,
      run,
      ignoreFailure,
      coalesce: false,
    });
  }, [enqueueEdit]);

  const enqueueRevisionedZOrder = useCallback(({
    updates,
    request,
  }: {
    updates: Array<{ sheetId: string; zIndex: number }>;
    request: (updates: SheetZOrderUpdate[]) => Promise<UpdateSheetZOrderResponse>;
  }) => {
    if (updates.length === 0) return;
    enqueueZOrderEdit({
      affectedSheetIds: new Set(updates.map((update) => update.sheetId)),
      run: () => runRevisionedZOrder({ updates, request }),
    });
  }, [enqueueZOrderEdit, runRevisionedZOrder]);

  const markSaved = useCallback(() => setSaveStatus('saved'), []);

  return {
    dropSheetQueuedTasks,
    enqueueEdit,
    enqueueRevisionedEdit,
    enqueueRevisionedZOrder,
    enqueueZOrderEdit,
    markSaved,
    recordSheetDocumentRevision,
    recordSheetRevision,
    runRevisionedEdit,
    runRevisionedZOrder,
    saveStatus,
    waitForSheetIdle,
  };
}
