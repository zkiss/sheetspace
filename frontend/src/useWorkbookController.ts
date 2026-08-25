import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CalculationImpact } from './calculationProjection';
import { FormulaCalculation } from './formulaCalculation';
import {
  WorkbookApiError,
  workbookApi,
  type ColumnAppendResponse,
  type RowAppendResponse,
  type WorkbookApi,
} from './workbookApi';
import {
  cellIdentityAt,
  cellRawContent,
  createEmptyWorkbook,
  findSheetById,
  sheetsInOrder,
  validateSheetName,
  type CellKey,
  type FormulaEvaluationSnapshot,
  type MutationResult,
  type SheetFrameSize,
  type SheetZOrderDirection,
  type Workbook,
  type WorkspacePosition,
  type ValidationResult,
} from './workbook';
import { applyUserAction, type AppliedUserAction, type UserAction } from './userActions';
import { useSavedSheetAutosave } from './useSavedSheetAutosave';
import { useSheetCreationOperations, type CreatingSheetFrame } from './useSheetCreationOperations';
import { useStartupWorkbookLoad } from './useStartupWorkbookLoad';
import {
  emptyCreatingGridAxes,
  type CreatingGridAxes,
  type CreatingGridAxisSlot,
} from './gridAxisProjection';
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
  deleteSheet: (sheetId: string) => void;
  moveSheetFrame: (sheetId: string, position: WorkspacePosition) => void;
  renameSheet: (sheetId: string, name: string) => MutationResult<Workbook>;
  resizeSheetFrame: (sheetId: string, position: WorkspacePosition, frameSize: SheetFrameSize) => void;
  updateCellContent: (sheetId: string, cellKey: CellKey, raw: string) => void;
};

export type WorkbookController = {
  commands: WorkbookCommands;
  formulaResults: FormulaEvaluationSnapshot;
  retryStartupLoad: () => void;
  creatingFrames: CreatingSheetFrame[];
  creatingAxes: Readonly<Record<string, CreatingGridAxes>>;
  saveStatus: ReturnType<typeof useSavedSheetAutosave>['saveStatus'];
  startupLoad: ReturnType<typeof useStartupWorkbookLoad>['startupLoad'];
  workbook: Workbook;
};

type WorkbookControllerState = {
  workbook: Workbook;
  calculationRequest: CalculationRequest;
};

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
  const [creatingAxes, setCreatingAxes] = useState<Record<string, CreatingGridAxes>>({});
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
  const savedAutosave = useSavedSheetAutosave({
    autosaveEnabled,
    resolvedApiClient,
    setWorkbook,
    workbook,
  });
  const { createSheet, creatingFrames, saveStatus: creationSaveStatus } = useSheetCreationOperations({
    autosaveEnabled,
    currentWorkbook: () => optimisticWorkbook.current,
    resolvedApiClient,
    setWorkbook,
  });
  const getApiMethod = useCallback(
    <K extends keyof WorkbookApi>(method: K): WorkbookApi[K] => resolvedApiClient[method] ?? workbookApi[method],
    [resolvedApiClient],
  );
  const { retryStartupLoad, startupLoad } = useStartupWorkbookLoad({
    initialWorkbook,
    markSaved: savedAutosave.markSaved,
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

  function deleteSheetCommand(sheetId: string) {
    if (!findSheetById(optimisticWorkbook.current, sheetId)) {
      return;
    }

    savedAutosave.dropSheetQueuedTasks(sheetId);
    const sheetIdle = savedAutosave.waitForSheetIdle(sheetId);
    const applied = applyAction({ kind: 'delete-sheet', sheetId });
    if (!applied) return;
    savedAutosave.enqueueEdit({
      sheetId,
      target: { kind: 'delete' },
      run: async () => {
        await sheetIdle;
        savedAutosave.dropSheetQueuedTasks(sheetId);
        return savedAutosave.runRevisionedEdit({
          sheetId,
          request: (revision) => persistDeletedSheet(sheetId, revision),
          revisionOf: () => undefined,
        });
      },
    });
  }

  function renameSheetCommand(sheetId: string, name: string): MutationResult<Workbook> {
    const localSheetId = sheetId;
    const sourceWorkbook = optimisticWorkbook.current;
    const validation = validateSheetName(name, sheetsInOrder(sourceWorkbook), localSheetId);
    if (!findSheetById(sourceWorkbook, localSheetId)) return { ok: false, reason: 'unknown-sheet' };
    if (!validation.ok) return validation;
    const applied = applyAction({ kind: 'rename-sheet', sheetId: localSheetId, name });
    if (!applied) return { ok: false, reason: 'unknown-sheet' };
    const renamedSheet = findSheetById(applied.nextWorkbook, localSheetId);
    if (renamedSheet) {
      savedAutosave.enqueueRevisionedEdit({
        sheetId,
        target: { kind: 'rename' },
        request: (savedSheetId, revision) =>
          getApiMethod('renameSheet')(savedSheetId, renamedSheet.name, { revision }),
      });
    }

    return { ok: true, value: applied.nextWorkbook };
  }

  function appendSheetRow(sheetId: string) {
    appendSheetAxis(sheetId, 'row');
  }

  function appendSheetColumn(sheetId: string) {
    appendSheetAxis(sheetId, 'column');
  }

  function appendSheetAxis(sheetId: string, axis: 'row' | 'column') {
    if (!autosaveEnabled || !findSheetById(optimisticWorkbook.current, sheetId)) return;
    const slot: CreatingGridAxisSlot = {
      kind: 'creating',
      operationId: crypto.randomUUID(),
      boundary: Number.MAX_SAFE_INTEGER,
    };
    setCreatingAxes((current) => {
      const axes = current[sheetId] ?? emptyCreatingGridAxes;
      return {
        ...current,
        [sheetId]: {
          ...axes,
          [axis === 'row' ? 'rows' : 'columns']: [
            ...(axis === 'row' ? axes.rows : axes.columns),
            slot,
          ],
        },
      };
    });

    const removeSlot = () => setCreatingAxes((current) => {
      const axes = current[sheetId];
      if (!axes) return current;
      const key = axis === 'row' ? 'rows' : 'columns';
      const nextSlots = axes[key].filter((candidate) => candidate.operationId !== slot.operationId);
      if (nextSlots.length === axes[key].length) return current;
      const nextAxes = { ...axes, [key]: nextSlots };
      if (nextAxes.rows.length === 0 && nextAxes.columns.length === 0) {
        const { [sheetId]: _removed, ...remaining } = current;
        return remaining;
      }
      return { ...current, [sheetId]: nextAxes };
    });

    savedAutosave.enqueueRevisionedEdit<RowAppendResponse | ColumnAppendResponse>({
      sheetId,
      target: { kind: 'axis-append' },
      coalesce: false,
      request: (savedSheetId, revision) => axis === 'row'
        ? getApiMethod('appendRow')(savedSheetId, { revision })
        : getApiMethod('appendColumn')(savedSheetId, { revision }),
      reconcile: (response) => {
        if (!response) return;
        removeSlot();
        if ('rowId' in response) {
          applyAction({ kind: 'append-row', sheetId, rowId: response.rowId });
        } else {
          applyAction({ kind: 'append-column', sheetId, columnId: response.columnId });
        }
      },
      onFailure: removeSlot,
    });
  }

  function updateCellContent(sheetId: string, cellKey: CellKey, raw: string) {
    const localSheetId = sheetId;
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

    savedAutosave.enqueueRevisionedEdit({
      sheetId,
      target: { kind: 'cell-content', cellKey },
      request: (savedSheetId, revision) => getApiMethod('updateCellContent')(savedSheetId, cellKey, canonicalRaw, { revision }),
    });
  }

  function moveSheetFrame(sheetId: string, position: WorkspacePosition) {
    const localSheetId = sheetId;
    if (!applyAction({ kind: 'move-sheet-frame', sheetId: localSheetId, position })) return;
    savedAutosave.enqueueRevisionedEdit({
      sheetId,
      target: { kind: 'frame' },
      coalesceKey: 'position',
      request: (savedSheetId, revision) =>
        getApiMethod('updateSheetPosition')(savedSheetId, position, { revision }),
    });
  }

  function resizeSheetFrame(sheetId: string, position: WorkspacePosition, frameSize: SheetFrameSize) {
    const localSheetId = sheetId;
    if (!applyAction({
      kind: 'resize-sheet-frame', sheetId: localSheetId, position, size: frameSize,
    })) return;
    savedAutosave.enqueueRevisionedEdit({
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
      kind: 'change-sheet-z-order', sheetId, direction,
    });
    if (!applied) return;
    const updates = [];
    for (const nextSheet of sheetsInOrder(applied.nextWorkbook)) {
      const currentSheet = findSheetById(sourceWorkbook, nextSheet.id);
      if (currentSheet && currentSheet.frame.zIndex !== nextSheet.frame.zIndex) {
        updates.push({ sheetId: nextSheet.id, zIndex: nextSheet.frame.zIndex });
      }
    }
    savedAutosave.enqueueRevisionedZOrder({
      updates,
      request: (revisionedUpdates) => getApiMethod('updateSheetZOrder')(revisionedUpdates),
    });
  }

  return {
    commands: {
      appendColumn: appendSheetColumn,
      appendRow: appendSheetRow,
      changeSheetZOrder,
      createSheet,
      deleteSheet: deleteSheetCommand,
      moveSheetFrame,
      renameSheet: renameSheetCommand,
      resizeSheetFrame,
      updateCellContent,
    },
    formulaResults,
    retryStartupLoad,
    creatingFrames,
    creatingAxes,
    saveStatus: creationSaveStatus === 'failed' || savedAutosave.saveStatus === 'failed'
      ? 'failed'
      : creationSaveStatus === 'saving' || savedAutosave.saveStatus === 'saving' ? 'saving' : 'saved',
    startupLoad,
    workbook,
  };
}
