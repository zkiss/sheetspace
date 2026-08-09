import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CalculationImpact } from './calculationProjection';
import { FormulaCalculation } from './formulaCalculation';
import { WorkbookApiError, workbookApi, type WorkbookApi } from './workbookApi';
import {
  appendColumn,
  appendRow,
  cellIdentityAt,
  cellIdentityKey,
  cellRawContent,
  commitCellRawContent,
  createSheet,
  createEmptyWorkbook,
  findSheetById,
  formulaSheetReferenceIds,
  moveSheetZOrder,
  remapWorkbookFormulaSheetId,
  renameSheet,
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
import { useEditQueue } from './useEditQueue';
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
  saveStatus: ReturnType<typeof useEditQueue>['saveStatus'];
  sheetIdRemaps: ReturnType<typeof useEditQueue>['sheetIdRemaps'];
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
  const appliedCalculation = useRef<CalculationRequest | undefined>(undefined);
  const setWorkbook = useCallback<SetWorkbook>((update, impact) => {
    setControllerState((current) => {
      const nextWorkbook = typeof update === 'function'
        ? update(current.workbook)
        : update;
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
    enqueueEdit,
    dropSheetQueuedTasks,
    enqueuePendingSheetCreate,
    getApiMethod,
    markSaved,
    registerPendingSheet,
    resolveSheetId,
    runForSavedSheet,
    resolveFormulaRawForSave,
    runRevisionedEdit,
    saveStatus,
    sheetIdRemaps,
    waitForSheetIdle,
  } = useEditQueue({
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

  function persistDeletedSheet(savedSheetId: string, revision: number | undefined) {
    return getApiMethod('deleteSheet')(savedSheetId, { revision }).catch((cause: unknown) => {
      if (cause instanceof WorkbookApiError && cause.status === 404 && cause.code === 'sheet-not-found') {
        return undefined;
      }

      throw cause;
    });
  }

  function createSheetCommand(name: string, position: WorkspacePosition): ValidationResult {
    const result = validateSheetName(name, sheetsInOrder(workbook));

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
    setWorkbook((currentWorkbook) => {
      const optimisticSheet = createSheet({
        id: pendingSheetId,
        name: result.name,
        existingSheets: sheetsInOrder(currentWorkbook),
        position,
      });

      return optimisticSheet.ok
        ? {
            ...currentWorkbook,
            manifest: {
              ...currentWorkbook.manifest,
              sheetIds: [...currentWorkbook.manifest.sheetIds, pendingSheetId],
            },
            documents: { ...currentWorkbook.documents, [pendingSheetId]: optimisticSheet.value },
          }
        : currentWorkbook;
    }, { kind: 'structure' });
    enqueuePendingSheetCreate(
      pendingSheetId,
      `sheet-create:${result.name}`,
      () =>
        getApiMethod('createSheet')({
          name: result.name,
          position,
        }).finally(() => {
          pendingSheets.current.delete(pendingSheetId);
        }),
      (savedResult) =>
        'manifest' in savedResult
          ? sheetsInOrder(savedResult).find((sheet) => sheet.name === result.name)?.id
          : savedResult.name === result.name
            ? savedResult.id
            : undefined,
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
    setWorkbook(
      (currentWorkbook) => remapWorkbookFormulaSheetId(
        removeSheetDocument(currentWorkbook, sheetId),
        sheetId,
        '#REF',
      ),
      { kind: 'structure' },
    );
  }

  function deleteSheetCommand(sheetId: string) {
    if (pendingSheets.current.has(sheetId)) {
      deletePendingSheet(sheetId);
      return;
    }

    const localSheetId = resolveSheetId(sheetId);
    if (!findSheetById(workbook, localSheetId)) {
      return;
    }

    dropSheetQueuedTasks(localSheetId);
    setWorkbook((currentWorkbook) => removeSheetDocument(currentWorkbook, localSheetId), { kind: 'structure' });
    enqueueEdit(`sheet-delete:${localSheetId}`, async () => {
      await waitForSheetIdle(localSheetId);
      dropSheetQueuedTasks(localSheetId);
      return runRevisionedEdit(localSheetId, (revision) => persistDeletedSheet(localSheetId, revision));
    });
  }

  function renameSheetCommand(sheetId: string, name: string): MutationResult<Workbook> {
    const localSheetId = resolveSheetId(sheetId);
    const result = renameSheet(workbook, localSheetId, name);
    if (!result.ok) {
      return result;
    }

    const renamedSheet = findSheetById(result.value, localSheetId);
    setWorkbook(result.value, { kind: 'none' });
    if (renamedSheet) {
      enqueueEdit(`sheet:${sheetId}:name`, () =>
        runForSavedSheet(sheetId, (savedSheetId) =>
          runRevisionedEdit(savedSheetId, (revision) =>
            getApiMethod('renameSheet')(savedSheetId, renamedSheet.name, { revision }),
          ),
        ),
      undefined, sheetId);
    }

    return result;
  }

  function appendSheetRow(sheetId: string) {
    const localSheetId = resolveSheetId(sheetId);
    let changed = false;
    const nextWorkbook = {
      ...workbook,
      documents: Object.fromEntries(Object.entries(workbook.documents).map(([id, sheet]) => {
        if (sheet.id !== localSheetId) {
          return [id, sheet];
        }

        changed = true;
        return [id, appendRow(sheet)];
      })),
    };

    if (!changed) {
      return;
    }

    setWorkbook(nextWorkbook, { kind: 'structure' });
    enqueueEdit(`sheet:${sheetId}:rows`, () =>
      runForSavedSheet(sheetId, (savedSheetId) =>
        runRevisionedEdit(savedSheetId, (revision) => getApiMethod('appendRow')(savedSheetId, { revision })),
      ),
    undefined, sheetId);
  }

  function appendSheetColumn(sheetId: string) {
    const localSheetId = resolveSheetId(sheetId);
    let changed = false;
    const nextWorkbook = {
      ...workbook,
      documents: Object.fromEntries(Object.entries(workbook.documents).map(([id, sheet]) => {
        if (sheet.id !== localSheetId) {
          return [id, sheet];
        }

        changed = true;
        return [id, appendColumn(sheet)];
      })),
    };

    if (!changed) {
      return;
    }

    setWorkbook(nextWorkbook, { kind: 'structure' });
    enqueueEdit(`sheet:${sheetId}:columns`, () =>
      runForSavedSheet(sheetId, (savedSheetId) =>
        runRevisionedEdit(savedSheetId, (revision) => getApiMethod('appendColumn')(savedSheetId, { revision })),
      ),
    undefined, sheetId);
  }

  function updateCellContent(sheetId: string, cellKey: CellKey, raw: string) {
    const localSheetId = resolveSheetId(sheetId);
    const currentSheet = findSheetById(workbook, localSheetId);
    const currentRaw = currentSheet ? cellRawContent(currentSheet, cellKey) ?? '' : '';
    const nextWorkbook = commitCellRawContent(workbook, localSheetId, cellKey, raw);
    const nextSheet = findSheetById(nextWorkbook, localSheetId);
    const canonicalRaw = nextSheet ? cellRawContent(nextSheet, cellKey) ?? '' : '';

    if (nextWorkbook !== workbook) {
      setWorkbook(nextWorkbook, {
        kind: 'cells',
        cells: [{ sheetId: localSheetId, key: cellKey }],
      });
    }
    if (nextWorkbook !== workbook && currentRaw !== canonicalRaw) {
      enqueueEdit(
        `cell:${sheetId}:${cellKey}`,
        () => {
          const saveCellContent = (savedSheetId: string, resolvedRaw = canonicalRaw) =>
            runRevisionedEdit(savedSheetId, (revision) =>
              getApiMethod('updateCellContent')(savedSheetId, cellKey, resolvedRaw, { revision }),
            );

          return runForSavedSheet(sheetId, (savedSheetId) =>
            formulaSheetReferenceIds(canonicalRaw).length === 0
              ? saveCellContent(savedSheetId)
              : resolveFormulaRawForSave(canonicalRaw).then((resolvedRaw) => saveCellContent(savedSheetId, resolvedRaw)),
          );
        },
        undefined,
        sheetId,
      );
    }
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
    previewSheetFrameLayout(sheetId, position);
    enqueueEdit(`sheet:${sheetId}:position`, () =>
      runForSavedSheet(sheetId, (savedSheetId) =>
        runRevisionedEdit(savedSheetId, (revision) =>
          getApiMethod('updateSheetPosition')(savedSheetId, position, { revision }),
        ),
      ),
    undefined, sheetId);
  }

  function resizeSheetFrame(sheetId: string, position: WorkspacePosition, frameSize: SheetFrameSize) {
    const localSheetId = resolveSheetId(sheetId);
    const currentSheet = findSheetById(workbook, localSheetId);
    previewSheetFrameLayout(sheetId, position, frameSize);
    enqueueEdit(`sheet:${sheetId}:frame-size`, () =>
      runForSavedSheet(sheetId, (savedSheetId) =>
        runRevisionedEdit(savedSheetId, (revision) =>
          getApiMethod('updateSheetFrameSize')(savedSheetId, frameSize, { revision }),
        ),
      ),
    undefined, sheetId);
    if (
      currentSheet &&
      (position.x !== currentSheet.frame.position.x || position.y !== currentSheet.frame.position.y)
    ) {
      enqueueEdit(`sheet:${sheetId}:position`, () =>
        runForSavedSheet(sheetId, (savedSheetId) =>
          runRevisionedEdit(savedSheetId, (revision) =>
            getApiMethod('updateSheetPosition')(savedSheetId, position, { revision }),
          ),
        ),
      undefined, sheetId);
    }
  }

  function changeSheetZOrder(sheetId: string, direction: SheetZOrderDirection) {
    const result = moveSheetZOrder(workbook, resolveSheetId(sheetId), direction);
    if (!result.ok) {
      return;
    }

    setWorkbook(result.value, { kind: 'none' });
    for (const nextSheet of sheetsInOrder(result.value)) {
      const currentSheet = findSheetById(workbook, nextSheet.id);
      if (currentSheet && currentSheet.frame.zIndex !== nextSheet.frame.zIndex) {
        enqueueEdit(`sheet:${nextSheet.id}:z-index`, () =>
          runForSavedSheet(nextSheet.id, (savedSheetId) =>
            runRevisionedEdit(savedSheetId, (revision) =>
              getApiMethod('updateSheetZIndex')(savedSheetId, nextSheet.frame.zIndex, { revision }),
            ),
          ),
        undefined, nextSheet.id);
      }
    }
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
