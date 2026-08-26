import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CalculationImpact } from './calculationProjection';
import { FormulaCalculation } from './formulaCalculation';
import {
  workbookApi,
  type WorkbookApi,
} from './workbookApi';
import {
  cellIdentityAt,
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
import {
  applyBackendWorkbookReconciliation,
  applyWorkbookOperation,
  type AppliedWorkbookOperation,
  type WorkbookOperation,
  type WorkbookOperationResult,
} from './userActions';
import { useSavedSheetAutosave } from './useSavedSheetAutosave';
import { useGridAxisCreationOperations } from './useGridAxisCreationOperations';
import { useSheetCreationOperations, type CreatingSheetFrame } from './useSheetCreationOperations';
import { useStartupWorkbookLoad } from './useStartupWorkbookLoad';
import { WorkbookPersistenceCoordinator } from './workbookPersistenceCoordinator';
import type { CreatingGridAxes } from './gridAxisProjection';
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
  retryFailedSaves: () => void;
  resizeSheetFrame: (sheetId: string, position: WorkspacePosition, frameSize: SheetFrameSize) => void;
  updateCellContent: (sheetId: string, cellKey: CellKey, raw: string) => void;
};

export type WorkbookController = {
  commands: WorkbookCommands;
  canRetryFailedSaves: boolean;
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
  const persistenceCoordinatorRef = useRef<WorkbookPersistenceCoordinator | undefined>(undefined);
  persistenceCoordinatorRef.current ??= new WorkbookPersistenceCoordinator();
  const persistenceCoordinator = persistenceCoordinatorRef.current;
  const committedCalculation = useRef<FormulaCalculation | undefined>(undefined);
  committedCalculation.current ??= calculator ?? new FormulaCalculation();
  const calculationObserverRef = useRef(calculationObserver);
  const savedAutosave = useSavedSheetAutosave({
    autosaveEnabled,
    persistenceCoordinator,
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

  type WorkbookOperationInput = WorkbookOperation extends infer Operation
    ? Operation extends unknown ? Omit<Operation, 'operationId'> : never
    : never;

  function applyResult(result: WorkbookOperationResult): AppliedWorkbookOperation | undefined {
    if (!result.ok) return undefined;
    optimisticWorkbook.current = result.value.nextWorkbook;
    setWorkbook(result.value.nextWorkbook, result.value.calculationImpact);
    return result.value;
  }

  function applyAction(action: WorkbookOperationInput): AppliedWorkbookOperation | undefined {
    const operation = { ...action, operationId: crypto.randomUUID() } as WorkbookOperation;
    const applied = applyResult(applyWorkbookOperation(optimisticWorkbook.current, operation));
    if (applied?.changed) savedAutosave.enqueue(operation.operationId, applied.persistence);
    return applied;
  }

  function applyReconciliation(reconciliation: Parameters<typeof applyBackendWorkbookReconciliation>[1]) {
    return applyResult(applyBackendWorkbookReconciliation(optimisticWorkbook.current, reconciliation));
  }

  function deleteSheetCommand(sheetId: string) {
    if (!findSheetById(optimisticWorkbook.current, sheetId)) {
      return;
    }

    savedAutosave.supersedeSheetOperations(sheetId);
    const operation = { kind: 'delete-sheet', operationId: crypto.randomUUID(), sheetId } as const;
    const applied = applyResult(applyWorkbookOperation(optimisticWorkbook.current, operation));
    if (!applied?.changed || !applied.persistence) return;
    const enqueueDelete = () => savedAutosave.enqueue(operation.operationId, applied.persistence);
    const pendingAxisCreation = axisCreation.prepareSheetDeletion(sheetId);
    if (pendingAxisCreation) void pendingAxisCreation.then(enqueueDelete);
    else enqueueDelete();
  }

  function renameSheetCommand(sheetId: string, name: string): MutationResult<Workbook> {
    const localSheetId = sheetId;
    const sourceWorkbook = optimisticWorkbook.current;
    const validation = validateSheetName(name, sheetsInOrder(sourceWorkbook), localSheetId);
    if (!findSheetById(sourceWorkbook, localSheetId)) return { ok: false, reason: 'unknown-sheet' };
    if (!validation.ok) return validation;
    const applied = applyAction({ kind: 'rename-sheet', sheetId: localSheetId, name });
    if (!applied) return { ok: false, reason: 'unknown-sheet' };
    return { ok: true, value: applied.nextWorkbook };
  }

  const axisCreation = useGridAxisCreationOperations({
    autosaveEnabled,
    currentWorkbook: () => optimisticWorkbook.current,
    persistenceCoordinator,
    reconcile: applyReconciliation,
    resolvedApiClient,
    setWorkbook,
  });

  function updateCellContent(sheetId: string, cellKey: CellKey, raw: string) {
    const localSheetId = sheetId;
    const currentSheet = findSheetById(optimisticWorkbook.current, localSheetId);
    const cell = currentSheet && cellIdentityAt(currentSheet.content, cellKey);
    if (!currentSheet || !cell) return;
    const applied = applyAction({
      kind: 'write-cells', sheetId: localSheetId, writes: [{ cell, raw }],
    });
    if (!applied?.changed) return;
  }

  function moveSheetFrame(sheetId: string, position: WorkspacePosition) {
    const localSheetId = sheetId;
    applyAction({ kind: 'move-sheet-frame', sheetId: localSheetId, position });
  }

  function resizeSheetFrame(sheetId: string, position: WorkspacePosition, frameSize: SheetFrameSize) {
    const localSheetId = sheetId;
    applyAction({
      kind: 'resize-sheet-frame', sheetId: localSheetId, position, size: frameSize,
    });
  }

  function changeSheetZOrder(sheetId: string, direction: SheetZOrderDirection) {
    applyAction({
      kind: 'change-sheet-z-order', sheetId, direction,
    });
  }

  const creationFailed = creationSaveStatus === 'failed' || axisCreation.saveStatus === 'failed';
  const creationSaving = creationSaveStatus === 'saving' || axisCreation.saveStatus === 'saving';

  return {
    commands: {
      appendColumn: axisCreation.appendColumn,
      appendRow: axisCreation.appendRow,
      changeSheetZOrder,
      createSheet,
      deleteSheet: deleteSheetCommand,
      moveSheetFrame,
      renameSheet: renameSheetCommand,
      retryFailedSaves: savedAutosave.retryFailedSaves,
      resizeSheetFrame,
      updateCellContent,
    },
    canRetryFailedSaves: savedAutosave.hasRetryableFailures,
    formulaResults,
    retryStartupLoad,
    creatingFrames,
    creatingAxes: axisCreation.creatingAxes,
    saveStatus: creationFailed || savedAutosave.saveStatus === 'failed'
      ? 'failed'
      : creationSaving || savedAutosave.saveStatus === 'saving' ? 'saving' : 'saved',
    startupLoad,
    workbook,
  };
}
