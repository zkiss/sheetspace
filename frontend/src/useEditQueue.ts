import { useCallback, useRef, useState } from 'react';
import {
  WorkbookApiError,
  workbookApi,
  type ColumnAppendResponse,
  type RowAppendResponse,
  type SheetRevisionResponse,
  type WorkbookApi,
} from './workbookApi';
import type { SaveStatus } from './appTypes';
import {
  findSheetById,
  formulaSheetReferenceIds,
  remapFormulaSheetIds,
  sheetsInOrder,
  type SheetDocument,
  type Workbook,
} from './workbook';
import type { SetWorkbook } from './workbookCalculation';

type SaveResult = Workbook | SheetDocument | SheetRevisionResponse | RowAppendResponse | ColumnAppendResponse | void;
type SheetCreateResult = SheetDocument | Workbook;

type EditQueueTask = {
  key: string;
  run: () => Promise<SaveResult>;
  reconcile: (savedResult: SaveResult) => void;
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
  setWorkbook: SetWorkbook;
  workbook: Workbook;
}) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [sheetIdRemaps, setSheetIdRemaps] = useState<Readonly<Record<string, string>>>({});
  const editQueues = useRef(new Map<string, EditQueue>());
  const failedEditKeys = useRef(new Set<string>());
  const knownSheetRevisions = useRef(new Map<string, number>());
  const pendingSheetCreates = useRef(new Map<string, PendingSheetCreate>());
  const sheetIdAliases = useRef(new Map<string, string>());
  const sheetIdleWaiters = useRef(new Map<string, Array<() => void>>());

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
    (savedResult: SaveResult) => {
      if (!savedResult) {
        return;
      }

      if ('manifest' in savedResult) {
        for (const sheet of sheetsInOrder(savedResult)) {
          knownSheetRevisions.current.set(sheet.id, sheet.revision);
        }
        setWorkbook((currentWorkbook) => {
          const documents = { ...currentWorkbook.documents };
          for (const sheet of sheetsInOrder(savedResult)) {
            const current = documents[sheet.id];
            if (current) documents[sheet.id] = { ...current, revision: Math.max(current.revision, sheet.revision) };
          }
          return { ...currentWorkbook, documents };
        }, { kind: 'none' });
        return;
      }

      if ('content' in savedResult) {
        knownSheetRevisions.current.set(savedResult.id, savedResult.revision);
        setWorkbook((currentWorkbook) => {
          const current = findSheetById(currentWorkbook, savedResult.id);
          return current ? {
            ...currentWorkbook,
            documents: {
              ...currentWorkbook.documents,
              [savedResult.id]: { ...savedResult, ...current, revision: savedResult.revision },
            },
          } : currentWorkbook;
        }, { kind: 'none' });
        return;
      }

      knownSheetRevisions.current.set(savedResult.sheetId, savedResult.revision);
      setWorkbook((currentWorkbook) => {
        const current = findSheetById(currentWorkbook, savedResult.sheetId);
        return current ? {
          ...currentWorkbook,
          documents: {
            ...currentWorkbook.documents,
            [current.id]: { ...current, revision: Math.max(current.revision, savedResult.revision) },
          },
        } : currentWorkbook;
      }, { kind: 'none' });
    },
    [setWorkbook],
  );

  const mergeCreatedSheets = useCallback(
    (savedResult: SaveResult) => {
      if (!savedResult) {
        return;
      }

      if ('manifest' in savedResult) {
        setWorkbook((currentWorkbook) => {
          const documents = { ...currentWorkbook.documents };
          const sheetIds = [...currentWorkbook.manifest.sheetIds];
          for (const savedSheet of sheetsInOrder(savedResult)) {
            const current = documents[savedSheet.id];
            documents[savedSheet.id] = current
              ? { ...current, revision: Math.max(current.revision, savedSheet.revision) }
              : savedSheet;
            if (!sheetIds.includes(savedSheet.id)) sheetIds.push(savedSheet.id);
          }
          return {
            ...currentWorkbook,
            manifest: { ...currentWorkbook.manifest, sheetIds },
            documents,
          };
        }, { kind: 'structure' });
        return;
      }

      if ('content' in savedResult) {
        knownSheetRevisions.current.set(savedResult.id, savedResult.revision);
        setWorkbook(
          (currentWorkbook) => findSheetById(currentWorkbook, savedResult.id)
            ? currentWorkbook
            : {
                ...currentWorkbook,
                manifest: {
                  ...currentWorkbook.manifest,
                  sheetIds: [...currentWorkbook.manifest.sheetIds, savedResult.id],
                },
                documents: { ...currentWorkbook.documents, [savedResult.id]: savedResult },
              },
          { kind: 'structure' },
        );
      }
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

  const notifySheetIdle = useCallback((sheetId: string | undefined) => {
    if (!sheetId) {
      return;
    }

    for (const queue of editQueues.current.values()) {
      if (queue.running?.sheetId === sheetId || queue.queued?.sheetId === sheetId) {
        return;
      }
    }

    const waiters = sheetIdleWaiters.current.get(sheetId);
    if (!waiters) {
      return;
    }

    sheetIdleWaiters.current.delete(sheetId);
    for (const resolve of waiters) {
      resolve();
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
            notifySheetIdle(task.sheetId);
            return;
          }

          editQueues.current.delete(task.key);
          notifySheetIdle(task.sheetId);
          refreshSaveStatus();
        });
    },
    [notifySheetIdle, refreshSaveStatus],
  );

  const enqueueEdit = useCallback(
    (key: string, run: () => Promise<SaveResult>, reconcile = mergeSheetRevisions, sheetId?: string) => {
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

  const waitForSheetIdle = useCallback((sheetId: string) => {
    for (const queue of editQueues.current.values()) {
      if (queue.running?.sheetId === sheetId || queue.queued?.sheetId === sheetId) {
        return new Promise<void>((resolve) => {
          const waiters = sheetIdleWaiters.current.get(sheetId) ?? [];
          waiters.push(resolve);
          sheetIdleWaiters.current.set(sheetId, waiters);
        });
      }
    }

    return Promise.resolve();
  }, []);

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

  const dropSheetQueuedTasks = useCallback((sheetId: string) => {
    for (const [key, queue] of editQueues.current) {
      if (queue.queued?.sheetId === sheetId) {
        queue.queued = null;
      }
      if (!queue.running && !queue.queued) {
        editQueues.current.delete(key);
      }
    }

    for (const key of [...failedEditKeys.current]) {
      if (key.includes(sheetId)) {
        failedEditKeys.current.delete(key);
      }
    }

    notifySheetIdle(sheetId);
    refreshSaveStatus();
  }, [notifySheetIdle, refreshSaveStatus]);

  const enqueuePendingSheetCreate = useCallback(
    (
      pendingSheetId: string,
      createKey: string,
      run: () => Promise<SheetCreateResult>,
      getCreatedSheetId: (savedResult: SheetCreateResult) => string | undefined,
      reconcile: (savedSheet: SheetDocument, savedSheetId: string, deleted: boolean) => void | Promise<void>,
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
          let savedResult: SheetCreateResult;
          try {
            savedResult = await run();
          } catch (cause: unknown) {
            pendingCreate.reject(new PendingSheetCreateFailedError());
            dropSheetQueuedTasks(pendingSheetId);
            pendingSheetCreates.current.delete(pendingSheetId);
            onFailure();
            throw cause;
          }

          const savedSheetId = getCreatedSheetId(savedResult);
          const savedSheet = 'manifest' in savedResult
            ? savedResult.documents[savedSheetId ?? '']
            : savedResult;
          if (!savedSheetId) {
            const cause = new Error('Created sheet was missing from the saved workbook.');
            pendingCreate.reject(new PendingSheetCreateFailedError());
            dropSheetQueuedTasks(pendingSheetId);
            pendingSheetCreates.current.delete(pendingSheetId);
            onFailure();
            throw cause;
          }
          if (!savedSheet) {
            const cause = new Error('Created sheet was missing from the save result.');
            pendingCreate.reject(new PendingSheetCreateFailedError());
            dropSheetQueuedTasks(pendingSheetId);
            pendingSheetCreates.current.delete(pendingSheetId);
            onFailure();
            throw cause;
          }

          sheetIdAliases.current.set(pendingSheetId, savedSheetId);
          remapPendingSheetQueues(pendingSheetId, savedSheetId);
          knownSheetRevisions.current.set(savedSheet.id, savedSheet.revision);
          setSheetIdRemaps((currentRemaps) => ({ ...currentRemaps, [pendingSheetId]: savedSheetId }));
          if (pendingCreate.deleted) {
            await reconcile(savedSheet, savedSheetId, true);
          } else {
            pendingCreate.resolve(savedSheetId);
            await reconcile(savedSheet, savedSheetId, false);
          }
          pendingSheetCreates.current.delete(pendingSheetId);
          return savedSheet;
        },
        () => undefined,
        pendingSheetId,
      );
    },
    [dropSheetQueuedTasks, enqueueEdit, remapPendingSheetQueues],
  );

  const cancelPendingSheet = useCallback(
    (pendingSheetId: string) => {
      const pendingCreate = pendingSheetCreates.current.get(pendingSheetId);
      if (!pendingCreate) {
        return false;
      }

      pendingCreate.deleted = true;
      pendingCreate.reject(new PendingSheetDeletedError());
      dropSheetQueuedTasks(pendingSheetId);
      refreshSaveStatus();
      return pendingCreate.started;
    },
    [dropSheetQueuedTasks, refreshSaveStatus],
  );

  const runForSavedSheet = useCallback(
    async (sheetId: string, save: (savedSheetId: string) => Promise<SaveResult>) => {
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

  const resolveFormulaRawForSave = useCallback(async (raw: string) => {
    const sheetIds = [...new Set(formulaSheetReferenceIds(raw))];
    const remaps = new Map(
      await Promise.all(
        sheetIds.map(async (sheetId) => {
          const savedSheetId = sheetIdAliases.current.get(sheetId);
          if (savedSheetId) {
            return [sheetId, savedSheetId] as const;
          }

          const pendingCreate = pendingSheetCreates.current.get(sheetId);
          if (!pendingCreate) {
            return [sheetId, sheetId.startsWith('pending:') ? '#REF' : sheetId] as const;
          }

          try {
            return [sheetId, await pendingCreate.promise] as const;
          } catch (cause: unknown) {
            if (cause instanceof PendingSheetDeletedError || cause instanceof PendingSheetCreateFailedError) {
              return [sheetId, '#REF'] as const;
            }
            throw cause;
          }
        }),
      ),
    );
    return remapFormulaSheetIds(raw, remaps);
  }, []);

  const currentSheetRevision = useCallback(
    (sheetId: string) => {
      const savedSheetId = resolveSheetId(sheetId);
      const localRevision = findSheetById(workbook, savedSheetId)?.revision;
      const knownRevision = knownSheetRevisions.current.get(savedSheetId);

      if (localRevision === undefined) {
        return knownRevision;
      }
      if (knownRevision === undefined) {
        return localRevision;
      }

      return Math.max(localRevision, knownRevision);
    },
    [resolveSheetId, workbook.documents],
  );

  const runRevisionedEdit = useCallback(
    (sheetId: string, save: (revision: number | undefined) => Promise<SaveResult>) => {
      const loadSheet = resolvedApiClient.loadSheet ?? workbookApi.loadSheet;
      const startingRevision = currentSheetRevision(sheetId);

      return save(startingRevision).catch(async (cause: unknown) => {
        if (!(cause instanceof WorkbookApiError) || cause.status !== 409 || cause.code !== 'sheet-revision-conflict') {
          throw cause;
        }

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
            setWorkbook((currentWorkbook) => {
              const documents = { ...currentWorkbook.documents };
              delete documents[sheetId];
              return {
                ...currentWorkbook,
                manifest: {
                  ...currentWorkbook.manifest,
                  sheetIds: currentWorkbook.manifest.sheetIds.filter((id) => id !== sheetId),
                },
                documents,
              };
            }, { kind: 'structure' });
            return undefined;
          }
          throw reloadCause;
        }

        mergeSheetRevisions(latestSheet);
        return save(latestSheet.revision);
      });
    },
    [currentSheetRevision, dropSheetQueuedTasks, mergeSheetRevisions, resolvedApiClient, setWorkbook],
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
    resolveFormulaRawForSave,
    runRevisionedEdit,
    saveStatus,
    sheetIdRemaps,
    dropSheetQueuedTasks,
    waitForSheetIdle,
  };
}
