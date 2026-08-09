import { useCallback, useRef, useState } from 'react';
import type { SaveStatus } from './appTypes';
import {
  workbookApi,
  type SheetRevisionResponse,
  type WorkbookApi,
} from './workbookApi';
import {
  cellIdentityAt,
  cellIdentityKey,
  createSheet,
  findSheetById,
  formulaSheetReferenceIds,
  isPendingSheetId,
  remapFormulaSheetIds,
  remapWorkbookFormulaSheetId,
  sheetsInOrder,
  tabularCellsByA1,
  validateSheetName,
  type PendingSheetId,
  type SheetDocument,
  type TabularContent,
  type ValidationResult,
  type Workbook,
  type WorkspacePosition,
} from './workbook';
import type { SetWorkbook } from './workbookCalculation';
import type { AppliedUserAction, UserAction } from './userActions';
import {
  useSavedSheetAutosave,
  type SavedSheetSaveTarget,
} from './useSavedSheetAutosave';

type PendingSheetCreate = {
  afterSaved: Array<(savedSheetId: string) => void>;
  deleted: boolean;
  name: string;
  promise: Promise<string>;
  reject: (cause: unknown) => void;
  resolve: (savedSheetId: string) => void;
  started: boolean;
};

type ApplyAction = (action: UserAction) => AppliedUserAction | undefined;

function removeSheetDocument(workbook: Workbook, sheetId: string): Workbook {
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

function rebasePendingContent(pending: SheetDocument, saved: SheetDocument): TabularContent {
  const content: TabularContent = {
    kind: 'tabular',
    rows: [...saved.content.rows, ...pending.content.rows.slice(saved.content.rows.length)],
    columns: [...saved.content.columns, ...pending.content.columns.slice(saved.content.columns.length)],
    cells: {},
  };
  for (const [key, raw] of Object.entries(tabularCellsByA1(pending.content))) {
    const identity = cellIdentityAt(content, key);
    if (identity) content.cells[cellIdentityKey(identity)] = raw;
  }
  return content;
}

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

export function usePendingSheetLifecycle({
  applyAction,
  autosaveEnabled,
  currentWorkbook,
  persistDeletedSheet,
  resolvedApiClient,
  setWorkbook,
  workbook,
}: {
  applyAction: ApplyAction;
  autosaveEnabled: boolean;
  currentWorkbook: () => Workbook;
  persistDeletedSheet: (savedSheetId: string, revision: number | undefined) => Promise<void>;
  resolvedApiClient: Partial<WorkbookApi>;
  setWorkbook: SetWorkbook;
  workbook: Workbook;
}) {
  const [sheetIdRemaps, setSheetIdRemaps] = useState<Readonly<Record<string, string>>>({});
  const [pendingSaveStatus, setPendingSaveStatus] = useState<SaveStatus>('saved');
  const activeCreates = useRef(0);
  const failedCreateNames = useRef(new Set<string>());
  const zOrderSubmission = useRef(Promise.resolve());
  const deferredZOrderCount = useRef(0);
  const pendingSheetCreates = useRef(new Map<PendingSheetId, PendingSheetCreate>());
  const reservedCreateNames = useRef(new Set<string>());
  const sheetIdAliases = useRef(new Map<PendingSheetId, string>());
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

  const resolveSheetId = useCallback((sheetId: string) =>
    isPendingSheetId(sheetId) ? sheetIdAliases.current.get(sheetId) ?? sheetId : sheetId, []);

  const refreshPendingSaveStatus = useCallback(() => {
    setPendingSaveStatus(
      failedCreateNames.current.size > 0
        ? 'failed'
        : activeCreates.current > 0 ? 'saving' : 'saved',
    );
  }, []);

  const registerPendingSheet = useCallback((pendingSheetId: PendingSheetId, name: string) => {
    let resolve!: (savedSheetId: string) => void;
    let reject!: (cause: unknown) => void;
    const promise = new Promise<string>((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });
    void promise.catch(() => undefined);
    pendingSheetCreates.current.set(pendingSheetId, {
      afterSaved: [],
      deleted: false,
      name,
      promise,
      reject,
      resolve,
      started: false,
    });
  }, []);

  const enqueuePendingSheetCreate = useCallback((
    pendingSheetId: PendingSheetId,
    sheetName: string,
    run: () => Promise<SheetDocument>,
    reconcile: (savedSheet: SheetDocument, savedSheetId: string, deleted: boolean) => void | Promise<void>,
    onFailure: () => void,
  ) => {
    if (!autosaveEnabled) return;
    failedCreateNames.current.delete(sheetName);
    activeCreates.current += 1;
    refreshPendingSaveStatus();
    void (async () => {
      await Promise.resolve();
      const pendingCreate = pendingSheetCreates.current.get(pendingSheetId);
      if (!pendingCreate || pendingCreate.deleted) {
        pendingSheetCreates.current.delete(pendingSheetId);
        if (pendingCreate) reservedCreateNames.current.delete(pendingCreate.name);
        activeCreates.current -= 1;
        refreshPendingSaveStatus();
        return;
      }

      pendingCreate.started = true;
      let savedSheet: SheetDocument;
      try {
        savedSheet = await run();
      } catch {
        pendingCreate.reject(new PendingSheetCreateFailedError());
        pendingSheetCreates.current.delete(pendingSheetId);
        reservedCreateNames.current.delete(pendingCreate.name);
        onFailure();
        failedCreateNames.current.add(sheetName);
        activeCreates.current -= 1;
        refreshPendingSaveStatus();
        return;
      }

      const savedSheetId = savedSheet.id;
      sheetIdAliases.current.set(pendingSheetId, savedSheetId);
      savedAutosave.recordSheetDocumentRevision(savedSheet);
      setSheetIdRemaps((currentRemaps) => ({ ...currentRemaps, [pendingSheetId]: savedSheetId }));
      try {
        if (pendingCreate.deleted) {
          await reconcile(savedSheet, savedSheetId, true);
        } else {
          pendingCreate.resolve(savedSheetId);
          pendingCreate.afterSaved.forEach((enqueue) => enqueue(savedSheetId));
          await reconcile(savedSheet, savedSheetId, false);
        }
      } catch {
        failedCreateNames.current.add(sheetName);
      }
      pendingSheetCreates.current.delete(pendingSheetId);
      reservedCreateNames.current.delete(pendingCreate.name);
      activeCreates.current -= 1;
      refreshPendingSaveStatus();
    })();
  }, [autosaveEnabled, refreshPendingSaveStatus, savedAutosave]);

  const cancelPendingSheet = useCallback((pendingSheetId: PendingSheetId) => {
    const pendingCreate = pendingSheetCreates.current.get(pendingSheetId);
    if (!pendingCreate) return false;

    pendingCreate.deleted = true;
    pendingCreate.reject(new PendingSheetDeletedError());
    pendingCreate.afterSaved = [];
    return pendingCreate.started;
  }, []);

  const createPendingSheet = useCallback((name: string, position: WorkspacePosition): ValidationResult => {
    const sourceWorkbook = currentWorkbook();
    const result = validateSheetName(name, sheetsInOrder(sourceWorkbook));
    if (!result.ok) return result;
    if (reservedCreateNames.current.has(result.name)) return { ok: false, reason: 'duplicate' };

    const pendingSheetId: PendingSheetId = `pending:${crypto.randomUUID()}`;
    reservedCreateNames.current.add(result.name);
    registerPendingSheet(pendingSheetId, result.name);
    const optimisticSheet = createSheet({
      id: pendingSheetId,
      name: result.name,
      existingSheets: sheetsInOrder(sourceWorkbook),
      position,
    });
    if (!optimisticSheet.ok || !applyAction({ kind: 'create-sheet', sheet: optimisticSheet.value })) {
      reservedCreateNames.current.delete(result.name);
      cancelPendingSheet(pendingSheetId);
      return {
        ok: false,
        reason: !optimisticSheet.ok && optimisticSheet.reason === 'empty' ? 'empty' : 'duplicate',
      };
    }

    enqueuePendingSheetCreate(
      pendingSheetId,
      result.name,
      () => getApiMethod('createSheet')({ name: result.name, position }),
      async (savedSheet, savedSheetId, deleted) => {
        if (deleted) {
          await persistDeletedSheet(savedSheetId, savedSheet.revision);
          return;
        }
        setWorkbook((current) => {
          const optimistic = findSheetById(current, pendingSheetId);
          if (!optimistic) return current;
          const documents = { ...current.documents };
          delete documents[pendingSheetId];
          documents[savedSheetId] = {
            ...savedSheet,
            name: optimistic.name,
            frame: optimistic.frame,
            content: rebasePendingContent(optimistic, savedSheet),
          };
          return remapWorkbookFormulaSheetId({
            ...current,
            manifest: {
              ...current.manifest,
              sheetIds: current.manifest.sheetIds.map((id) => id === pendingSheetId ? savedSheetId : id),
            },
            documents,
          }, pendingSheetId, savedSheetId);
        }, { kind: 'structure' });
      },
      () => setWorkbook(
        (current) => remapWorkbookFormulaSheetId(
          removeSheetDocument(current, pendingSheetId),
          pendingSheetId,
          '#REF',
        ),
        { kind: 'structure' },
      ),
    );
    return result;
  }, [applyAction, cancelPendingSheet, currentWorkbook, enqueuePendingSheetCreate, getApiMethod, persistDeletedSheet, registerPendingSheet, setWorkbook]);

  const deletePendingSheet = useCallback((sheetId: string) => {
    if (!isPendingSheetId(sheetId) || !pendingSheetCreates.current.has(sheetId)) return false;
    const createWasSent = cancelPendingSheet(sheetId);
    if (!createWasSent) reservedCreateNames.current.delete(pendingSheetCreates.current.get(sheetId)?.name ?? '');
    const applied = applyAction({ kind: 'delete-sheet', sheetId });
    if (applied) {
      setWorkbook(
        (current) => remapWorkbookFormulaSheetId(current, sheetId, '#REF'),
        { kind: 'structure' },
      );
    }
    return true;
  }, [applyAction, cancelPendingSheet, setWorkbook]);

  const runForSavedSheet = useCallback(async <T,>(
    sheetId: string,
    save: (savedSheetId: string) => Promise<T>,
  ) => {
    const savedSheetId = isPendingSheetId(sheetId) ? sheetIdAliases.current.get(sheetId) : undefined;
    if (savedSheetId) return save(savedSheetId);

    if (!isPendingSheetId(sheetId)) return save(sheetId);
    const pendingCreate = pendingSheetCreates.current.get(sheetId);
    if (!pendingCreate) throw new PendingSheetCreateFailedError();
    return save(await pendingCreate.promise);
  }, []);

  const enqueueRevisionedEdit = useCallback(<T extends SheetRevisionResponse>({
    sheetId,
    target,
    request,
    coalesceKey,
  }: {
    sheetId: string;
    target: SavedSheetSaveTarget;
    request: (savedSheetId: string, revision: number | undefined) => Promise<T>;
    coalesceKey?: string;
  }) => {
    const savedSheetId = isPendingSheetId(sheetId) ? sheetIdAliases.current.get(sheetId) : undefined;
    const pendingCreate = isPendingSheetId(sheetId) ? pendingSheetCreates.current.get(sheetId) : undefined;
    if (!pendingCreate) {
      if (isPendingSheetId(sheetId) && !savedSheetId) return;
      savedAutosave.enqueueRevisionedEdit({ sheetId: savedSheetId ?? sheetId, target, request, coalesceKey });
      return;
    }
    pendingCreate.afterSaved.push((resolvedSheetId) => savedAutosave.enqueueRevisionedEdit({
      sheetId: resolvedSheetId,
      target,
      request,
      coalesceKey,
    }));
  }, [savedAutosave]);

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

  const enqueueRevisionedZOrder = useCallback((updates: Array<{ sheetId: string; zIndex: number }>) => {
    if (updates.length === 0) return;
    const hasUnresolvedSheet = updates.some((update) =>
      isPendingSheetId(update.sheetId) && pendingSheetCreates.current.has(update.sheetId));
    if (!hasUnresolvedSheet && deferredZOrderCount.current === 0) {
      if (updates.some((update) => isPendingSheetId(update.sheetId) && !sheetIdAliases.current.has(update.sheetId))) {
        return;
      }
      savedAutosave.enqueueRevisionedZOrder({
        updates: updates.map((update) => ({
          ...update,
          sheetId: resolveSheetId(update.sheetId),
        })),
        request: (revisionedUpdates) => getApiMethod('updateSheetZOrder')(revisionedUpdates),
      });
      return;
    }
    deferredZOrderCount.current += 1;
    zOrderSubmission.current = zOrderSubmission.current
      .catch(() => undefined)
      .then(async () => {
        const savedUpdates = await Promise.all(
          updates.map((update) => runForSavedSheet(update.sheetId, async (savedSheetId) => ({
            sheetId: savedSheetId,
            zIndex: update.zIndex,
          }))),
        );
        savedAutosave.enqueueRevisionedZOrder({
          updates: savedUpdates,
          request: (revisionedUpdates) => getApiMethod('updateSheetZOrder')(revisionedUpdates),
        });
      })
      .catch(() => undefined)
      .finally(() => {
        deferredZOrderCount.current -= 1;
      });
  }, [getApiMethod, resolveSheetId, runForSavedSheet, savedAutosave]);

  const resolveFormulaRawForSave = useCallback(async (raw: string) => {
    const sheetIds = [...new Set(formulaSheetReferenceIds(raw))];
    const remaps = new Map(
      await Promise.all(
        sheetIds.map(async (sheetId) => {
          const savedSheetId = isPendingSheetId(sheetId) ? sheetIdAliases.current.get(sheetId) : undefined;
          if (savedSheetId) return [sheetId, savedSheetId] as const;

          if (!isPendingSheetId(sheetId)) return [sheetId, sheetId] as const;
          const pendingCreate = pendingSheetCreates.current.get(sheetId);
          if (!pendingCreate) return [sheetId, '#REF'] as const;

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

  const saveStatus: SaveStatus = pendingSaveStatus === 'failed' || savedAutosave.saveStatus === 'failed'
    ? 'failed'
    : pendingSaveStatus === 'saving' || savedAutosave.saveStatus === 'saving' ? 'saving' : 'saved';

  return {
    createPendingSheet,
    deletePendingSheet,
    dropSheetQueuedTasks: savedAutosave.dropSheetQueuedTasks,
    enqueueRevisionedDelete,
    enqueueRevisionedEdit,
    enqueueRevisionedZOrder,
    getApiMethod,
    markSaved: savedAutosave.markSaved,
    isPendingSheet: (sheetId: string) => isPendingSheetId(sheetId) && pendingSheetCreates.current.has(sheetId),
    resolveFormulaRawForSave,
    resolveSheetId,
    saveStatus,
    sheetIdRemaps,
    waitForSheetIdle: savedAutosave.waitForSheetIdle,
  };
}
