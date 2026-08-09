import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CalculationImpact } from './calculationProjection';
import { FormulaCalculation } from './formulaCalculation';
import { WorkbookApiError, workbookApi, type WorkbookApi } from './workbookApi';
import {
  cellIdentityAt,
  cellIdentityKey,
  cellRawContent,
  createSheet,
  createEmptyWorkbook,
  findSheetById,
  formulaSheetReferenceIds,
  remapWorkbookFormulaSheetId,
  sheetsInOrder,
  tabularCellsByA1,
  validateSheetName,
  type CellKey,
  type FormulaEvaluationSnapshot,
  type MutationResult,
  type SheetDocument,
  type TabularContent,
  type SheetFrameSize,
  type SheetZOrderDirection,
  type Workbook,
  type WorkspacePosition,
  type ValidationResult,
} from './workbook';
import { applyUserAction, type AppliedUserAction, type UserAction } from './userActions';
import { usePendingSheetPersistence } from './usePendingSheetPersistence';
import { useStartupWorkbookLoad } from './useStartupWorkbookLoad';
import {
  calculationRequest,
  mergeCalculationImpacts,
  type CalculationRequest,
  type SetWorkbook,
} from './workbookCalculation';

export type WorkbookCommands = {
  appendColumn: (sheetId: string) => void;
  appendRow: (sheetId: string) => void;
  changeSheetZOrder: (sheetId: string, direction: SheetZOrderDirection) => void;
  createSheet: (name: string, position: WorkspacePosition) => ValidationResult;
  deletePendingSheet: (sheetId: string) => void;
  deleteSheet: (sheetId: string) => void;
  moveSheetFrame: (sheetId: string, position: WorkspacePosition) => void;
  previewSheetFrameLayout: (sheetId: string, position: WorkspacePosition, frameSize?: SheetFrameSize) => void;
  renameSheet: (sheetId: string, name: string) => MutationResult<Workbook>;
  resizeSheetFrame: (sheetId: string, position: WorkspacePosition, frameSize: SheetFrameSize) => void;
  updateCellContent: (sheetId: string, cellKey: CellKey, raw: string) => void;
};

export type WorkbookController = {
  commands: WorkbookCommands;
  formulaResults: FormulaEvaluationSnapshot;
  retryStartupLoad: () => void;
  saveStatus: ReturnType<typeof usePendingSheetPersistence>['saveStatus'];
  sheetIdRemaps: ReturnType<typeof usePendingSheetPersistence>['sheetIdRemaps'];
  startupLoad: ReturnType<typeof useStartupWorkbookLoad>['startupLoad'];
  workbook: Workbook;
};

type WorkbookControllerState = {
  workbook: Workbook;
  calculationRequest: CalculationRequest;
};

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
    rows: [
      ...saved.content.rows,
      ...pending.content.rows.slice(saved.content.rows.length),
    ],
    columns: [
      ...saved.content.columns,
      ...pending.content.columns.slice(saved.content.columns.length),
    ],
    cells: {},
  };
  for (const [key, raw] of Object.entries(tabularCellsByA1(pending.content))) {
    const identity = cellIdentityAt(content, key);
    if (identity) content.cells[cellIdentityKey(identity)] = raw;
  }
  return content;
}

export function useWorkbookController({
  apiClient,
  calculationObserver,
  calculator,
  initialWorkbook,
}: {
  apiClient?: Partial<WorkbookApi>;
  calculationObserver?: (impact: CalculationImpact) => void;
  calculator?: FormulaCalculation;
  initialWorkbook?: Workbook;
}): WorkbookController {
  const resolvedApiClient = apiClient ?? workbookApi;
  const autosaveEnabled = !initialWorkbook || Boolean(apiClient);
  const [controllerState, setControllerState] = useState<WorkbookControllerState>(() => {
    const workbook = initialWorkbook ?? createEmptyWorkbook();
    return {
      workbook,
      calculationRequest: calculationRequest(workbook, { kind: 'structure' }),
    };
  });
  const { calculationRequest: pendingCalculation, workbook } = controllerState;
  const optimisticWorkbook = useRef(workbook);
  optimisticWorkbook.current = workbook;
  const appliedCalculation = useRef<CalculationRequest | undefined>(undefined);
  const setWorkbook = useCallback<SetWorkbook>((update, impact) => {
    setControllerState((current) => {
      const nextWorkbook = typeof update === 'function'
        ? update(current.workbook)
        : update;
      optimisticWorkbook.current = nextWorkbook;
      if (nextWorkbook === current.workbook) {
        return current;
      }
      if (impact.kind === 'none') {
        return { ...current, workbook: nextWorkbook };
      }

      const pendingImpact: CalculationImpact =
        appliedCalculation.current === current.calculationRequest
          ? { kind: 'none' }
          : current.calculationRequest.impact;
      return {
        workbook: nextWorkbook,
        calculationRequest: calculationRequest(
          nextWorkbook,
          mergeCalculationImpacts(pendingImpact, impact),
        ),
      };
    });
  }, []);
  const committedCalculation = useRef<FormulaCalculation | undefined>(undefined);
  committedCalculation.current ??= calculator ?? new FormulaCalculation();
  const calculationObserverRef = useRef(calculationObserver);
  const pendingSheets = useRef(new Map<string, string>());
  const suppressedSheetIds = useRef(new Set<string>());
  const unresolvedCreateNames = useRef(new Map<string, string>());
  const {
    cancelPendingSheet,
    dropSheetQueuedTasks,
    enqueuePendingSheetCreate,
    enqueueRevisionedDelete,
    enqueueRevisionedEdit,
    enqueueRevisionedZOrder,
    getApiMethod,
    markSaved,
    registerPendingSheet,
    resolveSheetId,
    resolveFormulaRawForSave,
    saveStatus,
    sheetIdRemaps,
    waitForSheetIdle,
  } = usePendingSheetPersistence({
    autosaveEnabled,
    resolvedApiClient,
    setWorkbook,
    workbook,
  });
  const { retryStartupLoad, startupLoad } = useStartupWorkbookLoad({
    initialWorkbook,
    markSaved,
    resolvedApiClient,
    setWorkbook,
  });
  const calculated = useMemo(
    () => {
      const nextCalculation = committedCalculation.current!.fork();
      calculationObserverRef.current?.(pendingCalculation.impact);
      const results = nextCalculation.update(
        pendingCalculation.projection,
        pendingCalculation.impact,
      );
      return { nextCalculation, results };
    },
    [pendingCalculation],
  );
  useLayoutEffect(() => {
    committedCalculation.current = calculated.nextCalculation;
    appliedCalculation.current = pendingCalculation;
  }, [calculated, pendingCalculation]);
  const formulaResults = calculated.results;

  function applyAction(action: UserAction): AppliedUserAction | undefined {
    const result = applyUserAction(optimisticWorkbook.current, action);
    if (!result.ok) return undefined;
    optimisticWorkbook.current = result.value.nextWorkbook;
    setWorkbook(result.value.nextWorkbook, result.value.calculationImpact);
    return result.value;
  }

  function persistDeletedSheet(savedSheetId: string, revision: number | undefined) {
    return getApiMethod('deleteSheet')(savedSheetId, { revision }).catch((cause: unknown) => {
      if (cause instanceof WorkbookApiError && cause.status === 404 && cause.code === 'sheet-not-found') {
        return undefined;
      }

      throw cause;
    });
  }

  // Pure actions own optimistic state transitions and calculation impact. The focused
  // persistence calls below remain until sheetspace-z5q.11 through z5q.13 separate
  // saved-sheet autosave from the pending-sheet lifecycle.

  function createSheetCommand(name: string, position: WorkspacePosition): ValidationResult {
    const sourceWorkbook = optimisticWorkbook.current;
    const result = validateSheetName(name, sheetsInOrder(sourceWorkbook));

    if (!result.ok) {
      return result;
    }
    if ([...pendingSheets.current.values()].includes(result.name)) {
      return { ok: false, reason: 'duplicate' };
    }

    const pendingSheetId = `pending:${crypto.randomUUID()}`;
    pendingSheets.current.set(pendingSheetId, result.name);
    unresolvedCreateNames.current.set(pendingSheetId, result.name);
    registerPendingSheet(pendingSheetId);
    const optimisticSheet = createSheet({
      id: pendingSheetId,
      name: result.name,
      existingSheets: sheetsInOrder(sourceWorkbook),
      position,
    });
    if (!optimisticSheet.ok || !applyAction({
      kind: 'create-sheet',
      sheet: optimisticSheet.value,
    })) {
      pendingSheets.current.delete(pendingSheetId);
      unresolvedCreateNames.current.delete(pendingSheetId);
      cancelPendingSheet(pendingSheetId);
      return {
        ok: false,
        reason: !optimisticSheet.ok && optimisticSheet.reason === 'empty' ? 'empty' : 'duplicate',
      };
    }
    enqueuePendingSheetCreate(
      pendingSheetId,
      result.name,
      () =>
        getApiMethod('createSheet')({
          name: result.name,
          position,
        }).finally(() => {
          pendingSheets.current.delete(pendingSheetId);
        }),
      async (savedSheet, savedSheetId, deleted) => {
        if (deleted) {
          suppressedSheetIds.current.add(savedSheetId);
          unresolvedCreateNames.current.delete(pendingSheetId);
          await persistDeletedSheet(savedSheetId, savedSheet.revision);
          return;
        }

        unresolvedCreateNames.current.delete(pendingSheetId);
        setWorkbook((currentWorkbook) => {
          const optimistic = findSheetById(currentWorkbook, pendingSheetId);
          if (!optimistic) return currentWorkbook;
          const rebasedContent = rebasePendingContent(optimistic, savedSheet);
          const documents = { ...currentWorkbook.documents };
          delete documents[pendingSheetId];
          documents[savedSheetId] = {
            ...savedSheet,
            name: optimistic.name,
            frame: optimistic.frame,
            content: rebasedContent,
          };
          return remapWorkbookFormulaSheetId({
            ...currentWorkbook,
            manifest: {
              ...currentWorkbook.manifest,
              sheetIds: currentWorkbook.manifest.sheetIds.map((id) => id === pendingSheetId ? savedSheetId : id),
            },
            documents,
          }, pendingSheetId, savedSheetId);
        }, { kind: 'structure' });
      },
      () => {
        unresolvedCreateNames.current.delete(pendingSheetId);
        setWorkbook(
          (currentWorkbook) => remapWorkbookFormulaSheetId(
            removeSheetDocument(currentWorkbook, pendingSheetId),
            pendingSheetId,
            '#REF',
          ),
          { kind: 'structure' },
        );
      },
    );

    return result;
  }

  function deletePendingSheet(sheetId: string) {
    if (!pendingSheets.current.has(sheetId)) {
      return;
    }

    pendingSheets.current.delete(sheetId);
    const createWasSent = cancelPendingSheet(sheetId);
    if (!createWasSent) {
      unresolvedCreateNames.current.delete(sheetId);
    }
    const applied = applyAction({ kind: 'delete-sheet', sheetId });
    if (applied) {
      setWorkbook(
        (currentWorkbook) => remapWorkbookFormulaSheetId(currentWorkbook, sheetId, '#REF'),
        { kind: 'structure' },
      );
    }
  }

  function deleteSheetCommand(sheetId: string) {
    if (pendingSheets.current.has(sheetId)) {
      deletePendingSheet(sheetId);
      return;
    }

    const localSheetId = resolveSheetId(sheetId);
    if (!findSheetById(optimisticWorkbook.current, localSheetId)) {
      return;
    }

    dropSheetQueuedTasks(localSheetId);
    const sheetIdle = waitForSheetIdle(localSheetId);
    const applied = applyAction({ kind: 'delete-sheet', sheetId: localSheetId });
    if (!applied) return;
    enqueueRevisionedDelete({
      sheetId: localSheetId,
      beforeSave: async () => {
        await sheetIdle;
        dropSheetQueuedTasks(localSheetId);
      },
      request: (savedSheetId, revision) => persistDeletedSheet(savedSheetId, revision),
    });
  }

  function renameSheetCommand(sheetId: string, name: string): MutationResult<Workbook> {
    const localSheetId = resolveSheetId(sheetId);
    const sourceWorkbook = optimisticWorkbook.current;
    const validation = validateSheetName(name, sheetsInOrder(sourceWorkbook), localSheetId);
    if (!findSheetById(sourceWorkbook, localSheetId)) return { ok: false, reason: 'unknown-sheet' };
    if (!validation.ok) return validation;
    const applied = applyAction({ kind: 'rename-sheet', sheetId: localSheetId, name });
    if (!applied) return { ok: false, reason: 'unknown-sheet' };
    const renamedSheet = findSheetById(applied.nextWorkbook, localSheetId);
    if (renamedSheet) {
      enqueueRevisionedEdit({
        sheetId,
        target: { kind: 'rename' },
        request: (savedSheetId, revision) =>
          getApiMethod('renameSheet')(savedSheetId, renamedSheet.name, { revision }),
      });
    }

    return { ok: true, value: applied.nextWorkbook };
  }

  function appendSheetRow(sheetId: string) {
    const localSheetId = resolveSheetId(sheetId);
    const applied = applyAction({
      kind: 'append-row', sheetId: localSheetId,
      rowId: `pending-row:${crypto.randomUUID()}`,
    });
    if (!applied) return;
    enqueueRevisionedEdit({
      sheetId,
      target: { kind: 'rows' },
      request: (savedSheetId, revision) => getApiMethod('appendRow')(savedSheetId, { revision }),
    });
  }

  function appendSheetColumn(sheetId: string) {
    const localSheetId = resolveSheetId(sheetId);
    const applied = applyAction({
      kind: 'append-column', sheetId: localSheetId,
      columnId: `pending-column:${crypto.randomUUID()}`,
    });
    if (!applied) return;
    enqueueRevisionedEdit({
      sheetId,
      target: { kind: 'columns' },
      request: (savedSheetId, revision) => getApiMethod('appendColumn')(savedSheetId, { revision }),
    });
  }

  function updateCellContent(sheetId: string, cellKey: CellKey, raw: string) {
    const localSheetId = resolveSheetId(sheetId);
    const currentSheet = findSheetById(optimisticWorkbook.current, localSheetId);
    const cell = currentSheet && cellIdentityAt(currentSheet.content, cellKey);
    if (!currentSheet || !cell) return;
    const applied = applyAction({
      kind: 'set-cell-content', sheetId: localSheetId, cell, raw,
    });
    if (!applied?.changed) return;
    const nextWorkbook = applied.nextWorkbook;
    const nextSheet = findSheetById(nextWorkbook, localSheetId);
    const canonicalRaw = nextSheet ? cellRawContent(nextSheet, cellKey) ?? '' : '';

    enqueueRevisionedEdit({
      sheetId,
      target: { kind: 'cell-content', cellKey },
      request: async (savedSheetId, revision) => {
        const resolvedRaw = formulaSheetReferenceIds(canonicalRaw).length === 0
          ? canonicalRaw
          : await resolveFormulaRawForSave(canonicalRaw);
        return getApiMethod('updateCellContent')(savedSheetId, cellKey, resolvedRaw, { revision });
      },
    });
  }

  function previewSheetFrameLayout(sheetId: string, position: WorkspacePosition, frameSize?: SheetFrameSize) {
    const localSheetId = resolveSheetId(sheetId);
    setWorkbook((currentWorkbook) => ({
      ...currentWorkbook,
      documents: findSheetById(currentWorkbook, localSheetId)
        ? {
            ...currentWorkbook.documents,
            [localSheetId]: {
              ...currentWorkbook.documents[localSheetId],
              frame: {
                ...currentWorkbook.documents[localSheetId].frame,
                position,
                size: frameSize ?? currentWorkbook.documents[localSheetId].frame.size,
              },
            },
          }
        : currentWorkbook.documents,
    }), { kind: 'none' });
  }

  function moveSheetFrame(sheetId: string, position: WorkspacePosition) {
    const localSheetId = resolveSheetId(sheetId);
    if (!applyAction({ kind: 'move-sheet-frame', sheetId: localSheetId, position })) return;
    enqueueRevisionedEdit({
      sheetId,
      target: { kind: 'frame' },
      coalesceKey: 'position',
      request: (savedSheetId, revision) =>
        getApiMethod('updateSheetPosition')(savedSheetId, position, { revision }),
    });
  }

  function resizeSheetFrame(sheetId: string, position: WorkspacePosition, frameSize: SheetFrameSize) {
    const localSheetId = resolveSheetId(sheetId);
    if (!applyAction({
      kind: 'resize-sheet-frame', sheetId: localSheetId, position, size: frameSize,
    })) return;
    enqueueRevisionedEdit({
      sheetId,
      target: { kind: 'frame' },
      coalesceKey: 'layout',
      request: (savedSheetId, revision) =>
        getApiMethod('updateSheetFrameLayout')(savedSheetId, position, frameSize, { revision }),
    });
  }

  function changeSheetZOrder(sheetId: string, direction: SheetZOrderDirection) {
    const sourceWorkbook = optimisticWorkbook.current;
    const applied = applyAction({
      kind: 'change-sheet-z-order', sheetId: resolveSheetId(sheetId), direction,
    });
    if (!applied) return;
    const updates = [];
    for (const nextSheet of sheetsInOrder(applied.nextWorkbook)) {
      const currentSheet = findSheetById(sourceWorkbook, nextSheet.id);
      if (currentSheet && currentSheet.frame.zIndex !== nextSheet.frame.zIndex) {
        updates.push({ sheetId: nextSheet.id, zIndex: nextSheet.frame.zIndex });
      }
    }
    enqueueRevisionedZOrder(updates);
  }

  return {
    commands: {
      appendColumn: appendSheetColumn,
      appendRow: appendSheetRow,
      changeSheetZOrder,
      createSheet: createSheetCommand,
      deletePendingSheet,
      deleteSheet: deleteSheetCommand,
      moveSheetFrame,
      previewSheetFrameLayout,
      renameSheet: renameSheetCommand,
      resizeSheetFrame,
      updateCellContent,
    },
    formulaResults,
    retryStartupLoad,
    saveStatus,
    sheetIdRemaps,
    startupLoad,
    workbook,
  };
}
