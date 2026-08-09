import { useCallback, useRef, useState } from 'react';
import type { SaveStatus } from './appTypes';
import { findSheetById, type CellKey, type SheetDocument, type Workbook } from './workbook';
import type { SetWorkbook } from './workbookCalculation';
import {
  WorkbookApiError,
  workbookApi,
  type SheetRevisionResponse,
  type WorkbookApi,
} from './workbookApi';

export type SavedSheetSaveTarget =
  | { kind: 'create'; name: string }
  | { kind: 'delete' }
  | { kind: 'rename' }
  | { kind: 'rows' }
  | { kind: 'columns' }
  | { kind: 'cell-content'; cellKey: CellKey }
  | { kind: 'position' }
  | { kind: 'frame-size' }
  | { kind: 'z-index' };

type SavedSheetTask = {
  execute: () => Promise<void>;
  ignoreFailure: (cause: unknown) => boolean;
};

type SavedSheetQueue = {
  running: SavedSheetTask | null;
  queued: SavedSheetTask | null;
  sheetId: string;
  target: SavedSheetSaveTarget;
};

type TargetQueues = Map<string | null, SavedSheetQueue>;
type SheetQueues = Map<SavedSheetSaveTarget['kind'], TargetQueues>;
type FailedTargets = Map<SavedSheetSaveTarget['kind'], Set<string | null>>;

function targetDetail(target: SavedSheetSaveTarget): string | null {
  if (target.kind === 'cell-content') return target.cellKey;
  if (target.kind === 'create') return target.name;
  return null;
}

function sheetHasWork(queues: SheetQueues | undefined): boolean {
  if (!queues) return false;
  for (const targetQueues of queues.values()) {
    for (const queue of targetQueues.values()) {
      if (queue.running || queue.queued) return true;
    }
  }
  return false;
}

function sheetHasPreDeleteWork(queues: SheetQueues | undefined): boolean {
  if (!queues) return false;
  for (const [kind, targetQueues] of queues) {
    if (kind === 'delete') continue;
    for (const queue of targetQueues.values()) {
      if (queue.running || queue.queued) return true;
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
  const editQueues = useRef(new Map<string, SheetQueues>());
  const failedTargets = useRef(new Map<string, FailedTargets>());
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

  const getQueue = useCallback((sheetId: string, target: SavedSheetSaveTarget) => {
    const sheetQueues = editQueues.current.get(sheetId) ?? new Map();
    editQueues.current.set(sheetId, sheetQueues);
    const targetQueues = sheetQueues.get(target.kind) ?? new Map();
    sheetQueues.set(target.kind, targetQueues);
    const detail = targetDetail(target);
    let queue = targetQueues.get(detail);
    if (!queue) {
      queue = { running: null, queued: null, sheetId, target };
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

  const clearFailure = useCallback((sheetId: string, target: SavedSheetSaveTarget) => {
    const sheetFailures = failedTargets.current.get(sheetId);
    const details = sheetFailures?.get(target.kind);
    details?.delete(targetDetail(target));
    if (details?.size === 0) sheetFailures?.delete(target.kind);
    if (sheetFailures?.size === 0) failedTargets.current.delete(sheetId);
  }, []);

  const recordFailure = useCallback((sheetId: string, target: SavedSheetSaveTarget) => {
    const sheetFailures = failedTargets.current.get(sheetId) ?? new Map();
    failedTargets.current.set(sheetId, sheetFailures);
    const details = sheetFailures.get(target.kind) ?? new Set();
    sheetFailures.set(target.kind, details);
    details.add(targetDetail(target));
  }, []);

  const notifySheetIdle = useCallback((sheetId: string) => {
    if (sheetHasPreDeleteWork(editQueues.current.get(sheetId))) return;
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
        if (!task.ignoreFailure(cause) && !queue.queued) recordFailure(queue.sheetId, queue.target);
      })
      .finally(() => {
        const nextTask = queue.queued;
        queue.running = null;
        queue.queued = null;
        if (nextTask) {
          start(queue, nextTask);
          refreshSaveStatus();
          return;
        }
        removeQueue(queue);
        notifySheetIdle(queue.sheetId);
        refreshSaveStatus();
      });
  }, [notifySheetIdle, recordFailure, refreshSaveStatus, removeQueue]);

  const enqueueEdit = useCallback(<T,>({
    sheetId,
    target,
    run,
    reconcile,
    ignoreFailure = () => false,
  }: {
    sheetId: string;
    target: SavedSheetSaveTarget;
    run: () => Promise<T>;
    reconcile?: (savedResult: T) => void;
    ignoreFailure?: (cause: unknown) => boolean;
  }) => {
    if (!autosaveEnabled) return;
    const queue = getQueue(sheetId, target);
    clearFailure(sheetId, target);
    const task: SavedSheetTask = {
      execute: () => run().then((savedResult) => {
        reconcile?.(savedResult);
      }),
      ignoreFailure,
    };
    if (queue.running) {
      queue.queued = task;
      refreshSaveStatus();
      return;
    }
    startEditTask(queue, task);
    refreshSaveStatus();
  }, [autosaveEnabled, clearFailure, getQueue, refreshSaveStatus, startEditTask]);

  const clearTargetFailures = useCallback((target: SavedSheetSaveTarget) => {
    for (const [sheetId, sheetFailures] of failedTargets.current) {
      const details = sheetFailures.get(target.kind);
      details?.delete(targetDetail(target));
      if (details?.size === 0) sheetFailures.delete(target.kind);
      if (sheetFailures.size === 0) failedTargets.current.delete(sheetId);
    }
    refreshSaveStatus();
  }, [refreshSaveStatus]);

  const dropSheetQueuedTasks = useCallback((sheetId: string) => {
    const sheetQueues = editQueues.current.get(sheetId);
    if (sheetQueues) {
      for (const targetQueues of sheetQueues.values()) {
        for (const queue of targetQueues.values()) {
          queue.queued = null;
          if (!queue.running) removeQueue(queue);
        }
      }
    }
    failedTargets.current.delete(sheetId);
    notifySheetIdle(sheetId);
    refreshSaveStatus();
  }, [notifySheetIdle, refreshSaveStatus, removeQueue]);

  const waitForSheetIdle = useCallback((sheetId: string) => {
    if (!sheetHasPreDeleteWork(editQueues.current.get(sheetId))) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const waiters = sheetIdleWaiters.current.get(sheetId) ?? [];
      waiters.push(resolve);
      sheetIdleWaiters.current.set(sheetId, waiters);
    });
  }, []);

  const remapSheetQueues = useCallback((fromSheetId: string, toSheetId: string) => {
    if (fromSheetId === toSheetId) return;
    const source = editQueues.current.get(fromSheetId);
    if (source) {
      const destination = editQueues.current.get(toSheetId) ?? new Map();
      editQueues.current.set(toSheetId, destination);
      for (const [kind, sourceTargets] of source) {
        const destinationTargets = destination.get(kind) ?? new Map();
        destination.set(kind, destinationTargets);
        for (const [detail, queue] of sourceTargets) {
          queue.sheetId = toSheetId;
          destinationTargets.set(detail, queue);
        }
      }
      editQueues.current.delete(fromSheetId);
    }
    const failures = failedTargets.current.get(fromSheetId);
    if (failures) {
      failedTargets.current.set(toSheetId, failures);
      failedTargets.current.delete(fromSheetId);
    }
    const revision = knownSheetRevisions.current.get(fromSheetId);
    if (revision !== undefined) {
      knownSheetRevisions.current.set(toSheetId, revision);
      knownSheetRevisions.current.delete(fromSheetId);
    }
    const waiters = sheetIdleWaiters.current.get(fromSheetId);
    if (waiters) {
      sheetIdleWaiters.current.set(toSheetId, [
        ...(sheetIdleWaiters.current.get(toSheetId) ?? []),
        ...waiters,
      ]);
      sheetIdleWaiters.current.delete(fromSheetId);
    }
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

  const markSaved = useCallback(() => setSaveStatus('saved'), []);

  return {
    dropSheetQueuedTasks,
    clearTargetFailures,
    enqueueEdit,
    markSaved,
    recordSheetDocumentRevision,
    recordSheetRevision,
    remapSheetQueues,
    runRevisionedEdit,
    saveStatus,
    waitForSheetIdle,
  };
}
