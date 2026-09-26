import type { AxisSizeWrite, FormatWrite } from '@workbook/core/model';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CalculationImpact } from '@workbook/read/calculationProjection';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import {
  workbookApi,
  type WorkbookApi,
} from '@infrastructure/persistence/workbookApi';
import { cellAddressOf, cellIdentityAt } from '@workbook/core/cellIdentity';
import { createEmptyWorkbook, validateSheetName } from '@workbook/mutations/operations';
import { findSheetById, sheetsInOrder } from '@workbook/read/queries';
import { cellKey, type CellKey } from '@workbook/core/address';
import type { StableCellIdentity } from '@workbook/core/model';
import { type FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import { type MutationResult, type SheetFrameSize, type SheetZOrderDirection, type Workbook, type WorkspacePosition, type ValidationResult } from '@workbook/core/model';
import {
  applyBackendWorkbookReconciliation,
  applyWorkbookOperation,
  preparePasteCellWrites,
  prepareMoveCellWrites,
  replayCellPersistenceWrites,
  type AppliedWorkbookOperation,
  type AffectedWorkbookEntities,
  type CellPersistenceWrite,
  type WorkbookOperation,
  type WorkbookOperationResult,
} from '@application/core/userActions';
import type { ClipboardParseResult } from '@application/core/clipboardPayload';
import { ContentHistory } from '@application/core/contentHistory';
import { useSavedSheetAutosave } from './useSavedSheetAutosave';
import { useGridAxisCreationOperations } from './useGridAxisCreationOperations';
import { useSheetCreationOperations } from '@application/react/useSheetCreationOperations';
import type { CreatingSheetFrame } from '@application/core/sheetCreationState';
import type { CreatingGridAxes } from '@application/core/gridAxisCreationState';
import { useStartupWorkbookLoad } from './useStartupWorkbookLoad';
import { WorkbookPersistenceCoordinator } from '@infrastructure/persistence/workbookPersistenceCoordinator';
import {
  calculationRequest,
  mergeCalculationImpacts,
  type CalculationRequest,
  type SetWorkbook,
} from '@calculation/workbookCalculation';

export type WorkbookCommands = {
  writeNumberFormats: (sheetId: string, writes: readonly FormatWrite[]) => void;
  writeAxisSizes: (sheetId: string, writes: readonly AxisSizeWrite[]) => void;
  appendColumn: (sheetId: string) => void;
  appendRow: (sheetId: string) => void;
  changeSheetZOrder: (sheetId: string, direction: SheetZOrderDirection) => void;
  createSheet: (name: string, position: WorkspacePosition, viewportScale?: number) => ValidationResult;
  deleteSheet: (sheetId: string) => void;
  moveSheetFrame: (sheetId: string, position: WorkspacePosition) => void;
  pasteCells: (sheetId: string, destination: CellKey, clipboard: ClipboardParseResult) => PasteCellsResult;
  moveCells: (sheetId: string, destination: CellKey, source: import('@application/core/clipboardPayload').ClipboardSourceSnapshot) => MoveCellsResult;
  renameSheet: (sheetId: string, name: string) => MutationResult<Workbook>;
  retryFailedSaves: () => void;
  undo: () => void;
  redo: () => void;
  resizeSheetFrame: (sheetId: string, position: WorkspacePosition, frameSize: SheetFrameSize) => void;
  setSheetVisualScale: (sheetId: string, visualScale: number) => void;
  updateCellContent: (sheetId: string, cellKey: CellKey, raw: string) => void;
  writeCells: (writes: readonly { sheetId: string; rowId: string; columnId: string; raw: string }[]) => void;
};

export type PasteCellsResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: 'malformed-tsv' | 'invalid-destination' | 'invalid-paste-footprint' | 'invalid-internal-source' | 'formula-transform-failed' };
export type MoveCellsResult = { ok: true; changed: boolean } | { ok: false; reason: import('@application/core/userActions').MovePreparationFailureReason };

export type ContentHistoryCellSnapshot = Readonly<{
  sheetId: string;
  rowId: string;
  columnId: string;
  raw: string | null;
  display: string | null;
}>;

export type ContentHistoryFeedback = Readonly<{
  identity: string;
  affected: AffectedWorkbookEntities;
  before: readonly ContentHistoryCellSnapshot[];
  after: readonly ContentHistoryCellSnapshot[];
}>;

export type WorkbookController = {
  commands: WorkbookCommands;
  canRetryFailedSaves: boolean;
  canUndo: boolean;
  canRedo: boolean;
  contentHistoryFeedback: ContentHistoryFeedback | undefined;
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

function contentHistorySnapshot(
  writes: readonly CellPersistenceWrite[],
  raw: 'beforeRaw' | 'afterRaw',
  workbook?: Workbook,
  formulaResults?: FormulaEvaluationSnapshot,
): readonly ContentHistoryCellSnapshot[] {
  return Object.freeze(writes.map((write) => {
    const sheet = workbook && findSheetById(workbook, write.sheetId);
    const address = sheet && cellAddressOf(sheet.content, write);
    const value = write[raw];
    return Object.freeze({
      sheetId: write.sheetId,
      rowId: write.rowId,
      columnId: write.columnId,
      raw: value,
      display: address ? formulaResults?.[write.sheetId]?.[cellKey(address)]?.display ?? value : value,
    });
  }));
}

function contentHistoryAffectedSnapshot(affected: AffectedWorkbookEntities): AffectedWorkbookEntities {
  return Object.freeze({
    sheetIds: Object.freeze([...affected.sheetIds]),
    cells: Object.freeze(affected.cells.map(({ sheetId, cell }) => Object.freeze({
      sheetId,
      cell: Object.freeze({ ...cell }),
    }))),
  });
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
  const contentHistoryRef = useRef<ContentHistory | undefined>(undefined);
  contentHistoryRef.current ??= new ContentHistory();
  const contentHistory = contentHistoryRef.current;
  const [, setHistoryRevision] = useState(0);
  const [contentHistoryFeedback, setContentHistoryFeedback] = useState<WorkbookController['contentHistoryFeedback']>();
  useEffect(() => {
    if (!contentHistoryFeedback) return;
    const identity = contentHistoryFeedback.identity;
    const timeout = window.setTimeout(() => {
      setContentHistoryFeedback((current) => current?.identity === identity ? undefined : current);
    }, 1200);
    return () => window.clearTimeout(timeout);
  }, [contentHistoryFeedback]);
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

  function applyAction(action: WorkbookOperationInput, recordContentHistory = true): AppliedWorkbookOperation | undefined {
    const operation = { ...action, operationId: crypto.randomUUID() } as WorkbookOperation;
    const applied = applyResult(applyWorkbookOperation(optimisticWorkbook.current, operation));
    if (applied?.changed) {
      savedAutosave.enqueue(operation.operationId, applied.persistence);
      if (recordContentHistory && operation.kind === 'write-cells' && applied.persistence?.kind === 'write-cells') {
        setContentHistoryFeedback(undefined);
        contentHistory.record(applied.persistence.writes, applied.affected);
        setHistoryRevision((revision) => revision + 1);
      }
    }
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
    writeCells([{ sheetId: localSheetId, ...cell, raw }]);
  }

  function writeCells(writes: readonly { sheetId: string; rowId: string; columnId: string; raw: string }[]) {
    applyAction({ kind: 'write-cells', writes: writes as ({ sheetId: string; raw: string } & StableCellIdentity)[] });
  }

  function pasteCells(sheetId: string, destinationKey: CellKey, clipboard: ClipboardParseResult): PasteCellsResult {
    const sourceWorkbook = optimisticWorkbook.current;
    const sheet = findSheetById(sourceWorkbook, sheetId);
    const destination = sheet && cellIdentityAt(sheet.content, destinationKey);
    if (!destination) return { ok: false, reason: 'invalid-destination' };
    const prepared = preparePasteCellWrites(sourceWorkbook, sheetId, destination, clipboard);
    if (!prepared.ok) return prepared;
    const applied = applyAction({ kind: 'write-cells', writes: prepared.writes });
    return { ok: true, changed: Boolean(applied?.changed) };
  }

  function moveCells(sheetId: string, destinationKey: CellKey, source: import('@application/core/clipboardPayload').ClipboardSourceSnapshot): MoveCellsResult {
    const sourceWorkbook = optimisticWorkbook.current;
    const sheet = findSheetById(sourceWorkbook, sheetId);
    const destination = sheet && cellIdentityAt(sheet.content, destinationKey);
    if (!destination) return { ok: false, reason: 'invalid-destination' };
    const prepared = prepareMoveCellWrites(sourceWorkbook, sheetId, destination, source);
    if (!prepared.ok) return prepared;
    const applied = applyAction({ kind: 'write-cells', writes: prepared.writes });
    return { ok: true, changed: Boolean(applied?.changed) };
  }

  function replayContentHistory(direction: 'undo' | 'redo') {
    const transaction = direction === 'undo' ? contentHistory.peekUndo() : contentHistory.peekRedo();
    if (!transaction) return;
    const sourceWorkbook = optimisticWorkbook.current;
    const expected = direction === 'undo' ? 'after' : 'before';
    const applied = applyResult(replayCellPersistenceWrites(sourceWorkbook, transaction.writes, expected));
    // An unavailable entry stays on its stack. This is deterministic and avoids phantom moves.
    if (!applied?.changed || applied.persistence?.kind !== 'write-cells') return;
    const operationId = crypto.randomUUID();
    savedAutosave.enqueue(operationId, applied.persistence);
    if (direction === 'undo') contentHistory.commitUndo(); else contentHistory.commitRedo();
    setContentHistoryFeedback(Object.freeze({
      identity: operationId,
      affected: contentHistoryAffectedSnapshot(applied.affected),
      before: contentHistorySnapshot(applied.persistence.writes, 'beforeRaw', sourceWorkbook, formulaResults),
      after: contentHistorySnapshot(applied.persistence.writes, 'afterRaw'),
    }));
    setHistoryRevision((revision) => revision + 1);
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

  function setSheetVisualScale(sheetId: string, visualScale: number) {
    applyAction({ kind: 'set-sheet-visual-scale', sheetId, visualScale });
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
      writeNumberFormats: (sheetId, writes) => { applyAction({ kind: 'write-number-formats', sheetId, writes }); },
      writeAxisSizes: (sheetId, writes) => { applyAction({ kind: 'write-axis-sizes', sheetId, writes }); },
      appendColumn: axisCreation.appendColumn,
      appendRow: axisCreation.appendRow,
      changeSheetZOrder,
      createSheet,
      deleteSheet: deleteSheetCommand,
      moveSheetFrame,
      moveCells,
      pasteCells,
      renameSheet: renameSheetCommand,
      retryFailedSaves: savedAutosave.retryFailedSaves,
      resizeSheetFrame,
      setSheetVisualScale,
      undo: () => replayContentHistory('undo'),
      redo: () => replayContentHistory('redo'),
      updateCellContent,
      writeCells,
    },
    canRetryFailedSaves: savedAutosave.hasRetryableFailures,
    canUndo: contentHistory.canUndo,
    canRedo: contentHistory.canRedo,
    contentHistoryFeedback,
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
