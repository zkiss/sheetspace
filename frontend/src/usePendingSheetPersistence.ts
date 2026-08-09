import { useCallback, useRef, useState } from 'react';
import {
  workbookApi,
  type SheetRevisionResponse,
  type WorkbookApi,
} from './workbookApi';
import {
  formulaSheetReferenceIds,
  remapFormulaSheetIds,
  type SheetDocument,
  type Workbook,
} from './workbook';
import type { SetWorkbook } from './workbookCalculation';
import {
  useSavedSheetAutosave,
  type SavedSheetSaveTarget,
} from './useSavedSheetAutosave';

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

// Temporary adapter for sheetspace-z5q.13. It owns only pending sheet identity,
// creation, dependent saves, formula remapping, and delete-during-create behavior.
export function usePendingSheetPersistence({
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
  const [sheetIdRemaps, setSheetIdRemaps] = useState<Readonly<Record<string, string>>>({});
  const pendingSheetCreates = useRef(new Map<string, PendingSheetCreate>());
  const sheetIdAliases = useRef(new Map<string, string>());
  const savedAutosave = useSavedSheetAutosave({
    autosaveEnabled,
    resolvedApiClient,
    setWorkbook,
    workbook,
  });

  const getApiMethod = useCallback(
    <K extends keyof WorkbookApi>(method: K): WorkbookApi[K] => resolvedApiClient[method] ?? workbookApi[method],
    [resolvedApiClient],
  );

  const resolveSheetId = useCallback((sheetId: string) => sheetIdAliases.current.get(sheetId) ?? sheetId, []);

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

  const enqueuePendingSheetCreate = useCallback((
    pendingSheetId: string,
    sheetName: string,
    run: () => Promise<SheetDocument>,
    reconcile: (savedSheet: SheetDocument, savedSheetId: string, deleted: boolean) => void | Promise<void>,
    onFailure: () => void,
  ) => {
    const target = { kind: 'create', name: sheetName } as const;
    savedAutosave.clearTargetFailures(target);
    savedAutosave.enqueueEdit({
      sheetId: pendingSheetId,
      target,
      run: async () => {
        await Promise.resolve();
        const pendingCreate = pendingSheetCreates.current.get(pendingSheetId);
        if (!pendingCreate || pendingCreate.deleted) {
          pendingSheetCreates.current.delete(pendingSheetId);
          return;
        }

        pendingCreate.started = true;
        let savedSheet: SheetDocument;
        try {
          savedSheet = await run();
        } catch (cause: unknown) {
          pendingCreate.reject(new PendingSheetCreateFailedError());
          savedAutosave.dropSheetQueuedTasks(pendingSheetId);
          pendingSheetCreates.current.delete(pendingSheetId);
          onFailure();
          throw cause;
        }

        const savedSheetId = savedSheet.id;
        sheetIdAliases.current.set(pendingSheetId, savedSheetId);
        savedAutosave.remapSheetQueues(pendingSheetId, savedSheetId);
        savedAutosave.recordSheetDocumentRevision(savedSheet);
        setSheetIdRemaps((currentRemaps) => ({ ...currentRemaps, [pendingSheetId]: savedSheetId }));
        if (pendingCreate.deleted) {
          await reconcile(savedSheet, savedSheetId, true);
        } else {
          pendingCreate.resolve(savedSheetId);
          await reconcile(savedSheet, savedSheetId, false);
        }
        pendingSheetCreates.current.delete(pendingSheetId);
      },
    });
  }, [savedAutosave]);

  const cancelPendingSheet = useCallback((pendingSheetId: string) => {
    const pendingCreate = pendingSheetCreates.current.get(pendingSheetId);
    if (!pendingCreate) return false;

    pendingCreate.deleted = true;
    pendingCreate.reject(new PendingSheetDeletedError());
    savedAutosave.dropSheetQueuedTasks(pendingSheetId);
    return pendingCreate.started;
  }, [savedAutosave]);

  const runForSavedSheet = useCallback(async <T,>(
    sheetId: string,
    save: (savedSheetId: string) => Promise<T>,
  ) => {
    const savedSheetId = sheetIdAliases.current.get(sheetId);
    if (savedSheetId) return save(savedSheetId);

    const pendingCreate = pendingSheetCreates.current.get(sheetId);
    if (!pendingCreate) return save(sheetId);
    return save(await pendingCreate.promise);
  }, []);

  const enqueueRevisionedEdit = useCallback(<T extends SheetRevisionResponse>({
    sheetId,
    target,
    request,
  }: {
    sheetId: string;
    target: SavedSheetSaveTarget;
    request: (savedSheetId: string, revision: number | undefined) => Promise<T>;
  }) => {
    savedAutosave.enqueueEdit({
      sheetId,
      target,
      run: () => runForSavedSheet(sheetId, (savedSheetId) =>
        savedAutosave.runRevisionedEdit({
          sheetId: savedSheetId,
          request: (revision) => request(savedSheetId, revision),
          revisionOf: (response) => response.revision,
        })),
      ignoreFailure: (cause) =>
        cause instanceof PendingSheetDeletedError || cause instanceof PendingSheetCreateFailedError,
    });
  }, [runForSavedSheet, savedAutosave]);

  const enqueueRevisionedDelete = useCallback(({
    beforeSave,
    sheetId,
    request,
  }: {
    beforeSave?: () => Promise<void>;
    sheetId: string;
    request: (savedSheetId: string, revision: number | undefined) => Promise<void>;
  }) => {
    savedAutosave.enqueueEdit({
      sheetId,
      target: { kind: 'delete' },
      run: async () => {
        await beforeSave?.();
        return runForSavedSheet(sheetId, (savedSheetId) =>
          savedAutosave.runRevisionedEdit({
            sheetId: savedSheetId,
            request: (revision) => request(savedSheetId, revision),
            revisionOf: () => undefined,
          }));
      },
      ignoreFailure: (cause) =>
        cause instanceof PendingSheetDeletedError || cause instanceof PendingSheetCreateFailedError,
    });
  }, [runForSavedSheet, savedAutosave]);

  const resolveFormulaRawForSave = useCallback(async (raw: string) => {
    const sheetIds = [...new Set(formulaSheetReferenceIds(raw))];
    const remaps = new Map(
      await Promise.all(
        sheetIds.map(async (sheetId) => {
          const savedSheetId = sheetIdAliases.current.get(sheetId);
          if (savedSheetId) return [sheetId, savedSheetId] as const;

          const pendingCreate = pendingSheetCreates.current.get(sheetId);
          if (!pendingCreate) return [sheetId, sheetId.startsWith('pending:') ? '#REF' : sheetId] as const;

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

  return {
    cancelPendingSheet,
    dropSheetQueuedTasks: savedAutosave.dropSheetQueuedTasks,
    enqueuePendingSheetCreate,
    enqueueRevisionedDelete,
    enqueueRevisionedEdit,
    getApiMethod,
    markSaved: savedAutosave.markSaved,
    registerPendingSheet,
    resolveFormulaRawForSave,
    resolveSheetId,
    saveStatus: savedAutosave.saveStatus,
    sheetIdRemaps,
    waitForSheetIdle: savedAutosave.waitForSheetIdle,
  };
}
