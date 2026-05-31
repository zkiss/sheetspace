import { Dispatch, SetStateAction, useCallback, useRef, useState } from 'react';
import { WorkbookApiError, workbookApi, type WorkbookApi } from './workbookApi';
import type { SaveStatus } from './appTypes';
import type { Workbook } from './workbook';

type EditQueueTask = {
  key: string;
  run: () => Promise<Workbook>;
  reconcile: (savedWorkbook: Workbook) => void;
  sheetId?: string;
};

type EditQueue = {
  running: EditQueueTask | null;
  queued: EditQueueTask | null;
};

type PendingSheetCreate = {
  deleted: boolean;
  promise: Promise<string>;
  reject: (cause: unknown) => void;
  resolve: (savedSheetId: string) => void;
  started: boolean;
};

class PendingSheetDeletedError extends Error {
  constructor() {
    super('Pending sheet was deleted before it became durable.');
    this.name = 'PendingSheetDeletedError';
  }
}

class PendingSheetCreateFailedError extends Error {
  constructor() {
    super('Pending sheet creation failed.');
    this.name = 'PendingSheetCreateFailedError';
  }
}

export function useEditQueue({
  autosaveEnabled,
  resolvedApiClient,
  setWorkbook,
  workbook,
}: {
  autosaveEnabled: boolean;
  resolvedApiClient: Partial<WorkbookApi>;
  setWorkbook: Dispatch<SetStateAction<Workbook>>;
  workbook: Workbook;
}) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [sheetIdRemaps, setSheetIdRemaps] = useState<Readonly<Record<string, string>>>({});
  const editQueues = useRef(new Map<string, EditQueue>());
  const failedEditKeys = useRef(new Set<string>());
  const knownSheetRevisions = useRef(new Map<string, number>());
  const pendingSheetCreates = useRef(new Map<string, PendingSheetCreate>());
  const sheetIdAliases = useRef(new Map<string, string>());

  const getApiMethod = useCallback(
    <K extends keyof WorkbookApi>(method: K): WorkbookApi[K] => resolvedApiClient[method] ?? workbookApi[method],
    [resolvedApiClient],
  );

  const hasPendingEdits = useCallback(() => {
    for (const queue of editQueues.current.values()) {
      if (queue.running || queue.queued) {
        return true;
      }
    }

    return false;
  }, []);

  const refreshSaveStatus = useCallback(() => {
    if (failedEditKeys.current.size > 0) {
      setSaveStatus('failed');
      return;
    }

    setSaveStatus(hasPendingEdits() ? 'saving' : 'saved');
  }, [hasPendingEdits]);

  const mergeSheetRevisions = useCallback(
    (savedWorkbook: Workbook) => {
      for (const sheet of savedWorkbook.sheets) {
        knownSheetRevisions.current.set(sheet.id, sheet.revision);
      }
      setWorkbook((currentWorkbook) => ({
        ...currentWorkbook,
        sheets: currentWorkbook.sheets.map((sheet) => {
          const savedSheet = savedWorkbook.sheets.find((candidate) => candidate.id === sheet.id);
          return savedSheet ? { ...sheet, revision: Math.max(sheet.revision, savedSheet.revision) } : sheet;
        }),
      }));
    },
    [setWorkbook],
  );

  const mergeCreatedSheets = useCallback(
    (savedWorkbook: Workbook) => {
      setWorkbook((currentWorkbook) => {
        const currentSheetIds = new Set(currentWorkbook.sheets.map((sheet) => sheet.id));
        return {
          ...currentWorkbook,
          sheets: [
            ...currentWorkbook.sheets.map((sheet) => {
              const savedSheet = savedWorkbook.sheets.find((candidate) => candidate.id === sheet.id);
              return savedSheet ? { ...sheet, revision: Math.max(sheet.revision, savedSheet.revision) } : sheet;
            }),
            ...savedWorkbook.sheets.filter((sheet) => !currentSheetIds.has(sheet.id)),
          ],
        };
      });
    },
    [setWorkbook],
  );

  const resolveSheetId = useCallback((sheetId: string) => sheetIdAliases.current.get(sheetId) ?? sheetId, []);

  const remapPendingSheetQueues = useCallback((pendingSheetId: string, savedSheetId: string) => {
    for (const [key, queue] of [...editQueues.current]) {
      const tasks = [queue.running, queue.queued].filter((task): task is EditQueueTask => task?.sheetId === pendingSheetId);
      if (tasks.length === 0) {
        continue;
      }

      const savedKey = key.replace(pendingSheetId, savedSheetId);
      for (const task of tasks) {
        task.key = task.key.replace(pendingSheetId, savedSheetId);
        task.sheetId = savedSheetId;
      }

      if (savedKey !== key) {
        editQueues.current.delete(key);
        editQueues.current.set(savedKey, queue);
      }
    }
  }, []);

  const startEditTask = useCallback(
    (queue: EditQueue, task: EditQueueTask) => {
      queue.running = task;
      task
        .run()
        .then(task.reconcile)
        .catch((cause: unknown) => {
          if (
            !(cause instanceof PendingSheetDeletedError) &&
            !(cause instanceof PendingSheetCreateFailedError) &&
            !queue.queued
          ) {
            failedEditKeys.current.add(task.key);
          }
        })
        .finally(() => {
          const nextTask = queue.queued;
          queue.running = null;
          queue.queued = null;

          if (nextTask) {
            startEditTask(queue, nextTask);
            return;
          }

          editQueues.current.delete(task.key);
          refreshSaveStatus();
        });
    },
    [mergeSheetRevisions, refreshSaveStatus],
  );

  const enqueueEdit = useCallback(
    (key: string, run: () => Promise<Workbook>, reconcile = mergeSheetRevisions, sheetId?: string) => {
      if (!autosaveEnabled) {
        return;
      }

      const savedSheetId = sheetId && resolveSheetId(sheetId);
      const resolvedKey = sheetId && savedSheetId ? key.replace(sheetId, savedSheetId) : key;
      const task = {
        key: resolvedKey,
        run,
        reconcile,
        sheetId: savedSheetId,
      };
      failedEditKeys.current.delete(resolvedKey);

      const queue = editQueues.current.get(resolvedKey) ?? { running: null, queued: null };
      editQueues.current.set(resolvedKey, queue);

      if (queue.running) {
        queue.queued = task;
        refreshSaveStatus();
        return;
      }

      startEditTask(queue, task);
      refreshSaveStatus();
    },
    [autosaveEnabled, mergeSheetRevisions, refreshSaveStatus, resolveSheetId, startEditTask],
  );

  const registerPendingSheet = useCallback((pendingSheetId: string) => {
    let resolve!: (savedSheetId: string) => void;
    let reject!: (cause: unknown) => void;
    const promise = new Promise<string>((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });
    void promise.catch(() => undefined);
    pendingSheetCreates.current.set(pendingSheetId, {
      deleted: false,
      promise,
      reject,
      resolve,
      started: false,
    });
  }, []);

  const dropPendingSheetQueuedTasks = useCallback((pendingSheetId: string) => {
    for (const [key, queue] of editQueues.current) {
      if (queue.queued?.sheetId === pendingSheetId) {
        queue.queued = null;
      }
      if (!queue.running && !queue.queued) {
        editQueues.current.delete(key);
      }
    }
  }, []);

  const enqueuePendingSheetCreate = useCallback(
    (
      pendingSheetId: string,
      createKey: string,
      run: () => Promise<Workbook>,
      getCreatedSheetId: (savedWorkbook: Workbook) => string | undefined,
      reconcile: (savedWorkbook: Workbook, savedSheetId: string, deleted: boolean) => void | Promise<void>,
      onFailure: () => void,
    ) => {
      enqueueEdit(
        createKey,
        async () => {
          await Promise.resolve();
          const pendingCreate = pendingSheetCreates.current.get(pendingSheetId);
          if (!pendingCreate || pendingCreate.deleted) {
            pendingSheetCreates.current.delete(pendingSheetId);
            throw new PendingSheetDeletedError();
          }

          pendingCreate.started = true;
          let savedWorkbook: Workbook;
          try {
            savedWorkbook = await run();
          } catch (cause: unknown) {
            pendingCreate.reject(new PendingSheetCreateFailedError());
            dropPendingSheetQueuedTasks(pendingSheetId);
            pendingSheetCreates.current.delete(pendingSheetId);
            onFailure();
            throw cause;
          }

          const savedSheetId = getCreatedSheetId(savedWorkbook);
          if (!savedSheetId) {
            const cause = new Error('Created sheet was missing from the saved workbook.');
            pendingCreate.reject(new PendingSheetCreateFailedError());
            dropPendingSheetQueuedTasks(pendingSheetId);
            pendingSheetCreates.current.delete(pendingSheetId);
            onFailure();
            throw cause;
          }

          sheetIdAliases.current.set(pendingSheetId, savedSheetId);
          remapPendingSheetQueues(pendingSheetId, savedSheetId);
          for (const sheet of savedWorkbook.sheets) {
            knownSheetRevisions.current.set(sheet.id, sheet.revision);
          }
          setSheetIdRemaps((currentRemaps) => ({ ...currentRemaps, [pendingSheetId]: savedSheetId }));
          if (pendingCreate.deleted) {
            await reconcile(savedWorkbook, savedSheetId, true);
          } else {
            pendingCreate.resolve(savedSheetId);
            await reconcile(savedWorkbook, savedSheetId, false);
          }
          pendingSheetCreates.current.delete(pendingSheetId);
          return savedWorkbook;
        },
        () => undefined,
        pendingSheetId,
      );
    },
    [dropPendingSheetQueuedTasks, enqueueEdit, remapPendingSheetQueues],
  );

  const cancelPendingSheet = useCallback(
    (pendingSheetId: string) => {
      const pendingCreate = pendingSheetCreates.current.get(pendingSheetId);
      if (!pendingCreate) {
        return false;
      }

      pendingCreate.deleted = true;
      pendingCreate.reject(new PendingSheetDeletedError());
      dropPendingSheetQueuedTasks(pendingSheetId);
      refreshSaveStatus();
      return pendingCreate.started;
    },
    [dropPendingSheetQueuedTasks, refreshSaveStatus],
  );

  const runForSavedSheet = useCallback(
    async (sheetId: string, save: (savedSheetId: string) => Promise<Workbook>) => {
      const savedSheetId = sheetIdAliases.current.get(sheetId);
      if (savedSheetId) {
        return save(savedSheetId);
      }

      const pendingCreate = pendingSheetCreates.current.get(sheetId);
      if (!pendingCreate) {
        return save(sheetId);
      }

      return save(await pendingCreate.promise);
    },
    [],
  );

  const currentSheetRevision = useCallback(
    (sheetId: string) => {
      const savedSheetId = resolveSheetId(sheetId);
      return workbook.sheets.find((sheet) => sheet.id === savedSheetId)?.revision ?? knownSheetRevisions.current.get(savedSheetId);
    },
    [resolveSheetId, workbook.sheets],
  );

  const runRevisionedEdit = useCallback(
    (sheetId: string, save: (revision: number | undefined) => Promise<Workbook>) => {
      const loadWorkbook = resolvedApiClient.loadWorkbook ?? workbookApi.loadWorkbook;
      const startingRevision = currentSheetRevision(sheetId);

      return save(startingRevision).catch(async (cause: unknown) => {
        if (!(cause instanceof WorkbookApiError) || cause.status !== 409 || cause.code !== 'sheet-revision-conflict') {
          throw cause;
        }

        const latestWorkbook = await loadWorkbook();
        const latestRevision = latestWorkbook.sheets.find((sheet) => sheet.id === sheetId)?.revision;
        mergeSheetRevisions(latestWorkbook);
        return save(latestRevision);
      });
    },
    [currentSheetRevision, mergeSheetRevisions, resolvedApiClient],
  );

  const markSaved = useCallback(() => {
    setSaveStatus('saved');
  }, []);

  return {
    cancelPendingSheet,
    enqueueEdit,
    enqueuePendingSheetCreate,
    getApiMethod,
    markSaved,
    mergeCreatedSheets,
    registerPendingSheet,
    resolveSheetId,
    runForSavedSheet,
    runRevisionedEdit,
    saveStatus,
    sheetIdRemaps,
  };
}
