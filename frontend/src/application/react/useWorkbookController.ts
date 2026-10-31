import type { AxisSizeWrite, FormatWrite, SheetDocument } from '@workbook/core/model';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CalculationImpact } from '@workbook/read/calculationProjection';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { workbookApi, type WorkbookApi } from '@infrastructure/persistence/workbookApi';
import { cellAddressOf, cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import { createEmptyWorkbook, validateSheetName } from '@workbook/mutations/operations';
import { cellRawContent, findSheetById, sheetsInOrder } from '@workbook/read/queries';
import { cellKey, type CellKey } from '@workbook/core/address';
import type { StableCellIdentity } from '@workbook/core/model';
import { type FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import { type MutationResult, type SheetFrameSize, type SheetZOrderDirection, type Workbook, type WorkspacePosition, type ValidationResult } from '@workbook/core/model';
import {
  applyBackendWorkbookReconciliation,
  applyWorkbookOperation, applyStoredCellWrites,
  prepareStoredPasteCellWrites, prepareStoredMoveCellWrites,
  replayCellPersistenceWrites,
  type AppliedWorkbookOperation, type AffectedWorkbookEntities, type CellPersistenceWrite,
  type CellWriteResult, type MovePreparationFailureReason, type PastePreparationFailureReason,
  type WorkbookOperation, type WorkbookOperationFailureReason, type WorkbookOperationResult,
} from '@application/core/userActions';
import type { ClipboardParseResult } from '@application/core/clipboardPayload';
import { ContentHistory } from '@application/core/contentHistory';
import { bindSheetToModel, unbindSheetFromModel, replaceModelDeclaration } from '@application/core/modelLifecycle';
import { renameColumn } from '@application/core/renameColumn';
import { addDataModel, type ModelMutationResult } from '@workbook/mutations/dataModel';
import type { DataModel } from '@workbook/core/model';
import { materializeAppendedModelRow } from '@application/core/modelRowAppend';
import { prepareCellInput } from '@application/core/cellInputPreparation';
import { ModelEntrySessions, type EntrySessionState } from '@application/core/modelEntrySession';
import { admitEntryRecord } from '@application/core/admitEntryRecord';
import { decodeCellTextLiteral } from '@workbook/core/cellLiteral';
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
  submitEntryDraft: (sheetId: string) => Promise<{ firstInvalid?: string; result?: { rowId: string; sheet: SheetDocument } }>;
  changeEntryField: (sheetId: string, propertyId: string, raw: string) => void;
  leaveEntryField: (sheetId: string, propertyId: string) => void;
  dismissEntryFeedback: (sheetId: string, propertyId: string) => void;
  bindSheetToModel: (sheetId: string, modelId: string) => DataModelCommandSubmission;
  unbindSheetFromModel: (sheetId: string) => DataModelCommandSubmission;
  addDataModel: (model: DataModel) => DataModelCommandSubmission;
  replaceModelDeclaration: (model: DataModel) => DataModelCommandSubmission;
  renameColumn: (sheetId: string, columnId: string, name: string) => RenameColumnSubmission;
  writeNumberFormats: (sheetId: string, writes: readonly FormatWrite[]) => WorkbookOperationResult;
  writeAxisSizes: (sheetId: string, writes: readonly AxisSizeWrite[]) => WorkbookOperationResult;
  appendColumn: (sheetId: string) => void;
  appendRow: (sheetId: string) => void;
  changeSheetZOrder: (sheetId: string, direction: SheetZOrderDirection) => WorkbookOperationResult;
  createSheet: (name: string, position: WorkspacePosition, viewportScale?: number, onCreated?: (sheet: SheetDocument) => void) => ValidationResult;
  deleteSheet: (sheetId: string) => WorkbookOperationResult;
  moveSheetFrame: (sheetId: string, position: WorkspacePosition) => WorkbookOperationResult;
  pasteCells: (sheetId: string, destination: CellKey, clipboard: ClipboardParseResult) => PasteCellsResult;
  pasteStoredCells: (sheetId: string, destination: CellKey, clipboard: ClipboardParseResult) => PasteCellsResult;
  moveStoredCells: (sheetId: string, destination: CellKey, source: import('@application/core/clipboardPayload').ClipboardSourceSnapshot) => MoveCellsResult;
  moveCells: (sheetId: string, destination: CellKey, source: import('@application/core/clipboardPayload').ClipboardSourceSnapshot) => MoveCellsResult;
  renameSheet: (sheetId: string, name: string) => MutationResult<Workbook> | { ok: false; reason: 'pending-model-transition' };
  retryFailedSaves: () => void;
  undo: () => void;
  redo: () => void;
  resizeSheetFrame: (sheetId: string, position: WorkspacePosition, frameSize: SheetFrameSize) => WorkbookOperationResult;
  setSheetVisualScale: (sheetId: string, visualScale: number) => WorkbookOperationResult;
  updateCellContent: (sheetId: string, cellKey: CellKey, raw: string) => CellWriteResult;
  writeCells: (writes: readonly { sheetId: string; rowId: string; columnId: string; raw: string }[]) => CellWriteResult; writeStoredCells: WorkbookCommands['writeCells'];
};

export type ModelCommandResult = ModelMutationResult | { ok: false; reason: 'pending-axis-creation' | 'pending-sheet-creation' | 'pending-model-transition' | 'blocked-persistence-prerequisite' | 'persistence-failed' };
export type DataModelCommandSubmission = Readonly<{ result: ModelCommandResult; completion: Promise<ModelCommandResult> }>;
type TransitionFailure = Exclude<ModelCommandResult, ModelMutationResult>;
export type RenameColumnResult = ReturnType<typeof renameColumn> | TransitionFailure;
export type RenameColumnSubmission = Readonly<{ result: RenameColumnResult; completion: Promise<RenameColumnResult> }>;

export type PasteCellsResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: PastePreparationFailureReason | WorkbookOperationFailureReason };
export type MoveCellsResult = { ok: true; changed: boolean } | { ok: false; reason: MovePreparationFailureReason | WorkbookOperationFailureReason };

export type ContentHistoryCellSnapshot = Readonly<{ sheetId: string; rowId: string; columnId: string; raw: string | null; display: string | null }>;

export type ContentHistoryFeedback = Readonly<{
  identity: string;
  affected: AffectedWorkbookEntities;
  before: readonly ContentHistoryCellSnapshot[];
  after: readonly ContentHistoryCellSnapshot[];
}>;

export type WorkbookController = {
  entrySessions: Readonly<Record<string, EntrySessionState>>;
  commands: WorkbookCommands;
  canRetryFailedSaves: boolean;
  canUndo: boolean;
  canRedo: boolean;
  contentHistoryFeedback: ContentHistoryFeedback | undefined;
  mutationFailure: 'pending-model-transition' | undefined;
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
    const ordinaryValue = value === null ? null : decodeCellTextLiteral(value) ?? value;
    return Object.freeze({
      sheetId: write.sheetId,
      rowId: write.rowId,
      columnId: write.columnId,
      raw: value,
      display: address ? formulaResults?.[write.sheetId]?.[cellKey(address)]?.display ?? ordinaryValue : ordinaryValue,
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
  const entrySessionsRef = useRef<ModelEntrySessions | undefined>(undefined);
  entrySessionsRef.current ??= new ModelEntrySessions();
  const entrySessions = entrySessionsRef.current;
  const [, setEntryRevision] = useState(0);
  const publishEntries = () => setEntryRevision((revision) => revision + 1);
  function entryModel(sheetId: string): DataModel | undefined {
    const current = optimisticWorkbook.current;
    const modelId = current.documents[sheetId]?.modelId;
    return modelId ? current.dataModels?.[modelId] : undefined;
  }
  const admissionLocks = useRef(new Set<string>());
  const appliedCalculation = useRef<CalculationRequest | undefined>(undefined);
  const contentHistoryRef = useRef<ContentHistory | undefined>(undefined);
  contentHistoryRef.current ??= new ContentHistory();
  const contentHistory = contentHistoryRef.current;
  const [, setHistoryRevision] = useState(0);
  const [contentHistoryFeedback, setContentHistoryFeedback] = useState<WorkbookController['contentHistoryFeedback']>();
  const [mutationFailure, setMutationFailure] = useState<WorkbookController['mutationFailure']>();
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
  const { createSheet, creatingFrames, hasPendingCreations, saveStatus: creationSaveStatus } = useSheetCreationOperations({
    autosaveEnabled,
    beforeCreate: savedAutosave.waitForModelTransitions,
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
      const results = nextCalculation.updateStored(
        pendingCalculation.projection,
        pendingCalculation.workbook,
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
  const resetHistory = () => {
    contentHistory.clear();
    setContentHistoryFeedback(undefined);
    setHistoryRevision((revision) => revision + 1);
  };
  const completedModelTransitions = useRef(new Set<string>());
  useEffect(() => {
    for (const entry of savedAutosave.outboxSnapshot) {
      if (entry.intent.kind !== 'model-lifecycle' || entry.status !== 'succeeded' || completedModelTransitions.current.has(entry.operationId)) continue;
      completedModelTransitions.current.add(entry.operationId);
      contentHistory.clear();
      setContentHistoryFeedback(undefined);
      setHistoryRevision((revision) => revision + 1);
    }
  }, [savedAutosave.outboxSnapshot, contentHistory]);

  type WorkbookOperationInput = WorkbookOperation extends infer Operation
    ? Operation extends unknown ? Omit<Operation, 'operationId'> : never
    : never;

  function applyResult(result: WorkbookOperationResult): AppliedWorkbookOperation | undefined {
    if (!result.ok) return undefined;
    optimisticWorkbook.current = result.value.nextWorkbook;
    setWorkbook(result.value.nextWorkbook, result.value.calculationImpact);
    return result.value;
  }

  function applyAction(action: WorkbookOperationInput, recordContentHistory = true, stored = false): WorkbookOperationResult {
    const pendingRejection = rejectPendingModelTransition();
    if (pendingRejection) return pendingRejection;
    const operation = { ...action, operationId: crypto.randomUUID() } as WorkbookOperation;
    const result = stored && operation.kind === 'write-cells' ? applyStoredCellWrites(optimisticWorkbook.current, operation.writes) : applyWorkbookOperation(optimisticWorkbook.current, operation);
    if (result.ok && result.value.affected.sheetIds.some((id) => admissionLocks.current.has(id))) {
      setMutationFailure('pending-model-transition');
      return { ok: false, reason: 'pending-model-transition' };
    }
    const applied = applyResult(result);
    if (result.ok) setMutationFailure(undefined);
    if (applied?.changed) {
      savedAutosave.enqueue(operation.operationId, applied.persistence);
      if (recordContentHistory && operation.kind === 'write-cells' && applied.persistence?.kind === 'write-cells') {
        setContentHistoryFeedback(undefined);
        contentHistory.record(applied.persistence.writes, applied.affected);
        setHistoryRevision((revision) => revision + 1);
      }
    }
    return result;
  }

  function rejectPendingModelTransition(): { ok: false; reason: 'pending-model-transition' } | undefined {
    if (!savedAutosave.hasModelTransition()) return undefined;
    setMutationFailure('pending-model-transition');
    return { ok: false, reason: 'pending-model-transition' };
  }

  function applyReconciliation(reconciliation: Parameters<typeof applyBackendWorkbookReconciliation>[1]) {
    const before = optimisticWorkbook.current;
    const applied = applyResult(applyBackendWorkbookReconciliation(before, reconciliation));
    if (!applied || reconciliation.kind !== 'append-row') return applied;
    // The append route materializes and persists the derived row; the frontend only
    // mirrors it locally and never sends the protected write on the ordinary route.
    const next = materializeAppendedModelRow(applied.nextWorkbook, reconciliation.sheetId, reconciliation.rowId);
    if (next !== applied.nextWorkbook) {
      optimisticWorkbook.current = next;
      setWorkbook(next, { kind: 'structure' });
    }
    return applied;
  }

  function applyModelLifecycleTransition<T extends { ok: true; value: Workbook } | { ok: false }>(transform: (source: Workbook) => T): Readonly<{ result: T | TransitionFailure; completion: Promise<T | TransitionFailure> }> {
    if (admissionLocks.current.size) {
      const rejected = { ok: false, reason: 'pending-model-transition' } as const;
      return { result: rejected, completion: Promise.resolve(rejected) };
    }
    const before = optimisticWorkbook.current;
    const result = transform(before);
    if (!result.ok || result.value === before) return { result, completion: Promise.resolve(result) };
    if (axisCreation.hasUnsettled()) {
      const rejected = { ok: false, reason: 'pending-axis-creation' } as const;
      return { result: rejected, completion: Promise.resolve(rejected) };
    }
    if (hasPendingCreations()) {
      const rejected = { ok: false, reason: 'pending-sheet-creation' } as const;
      return { result: rejected, completion: Promise.resolve(rejected) };
    }
    if (savedAutosave.hasModelTransition()) {
      const rejected = { ok: false, reason: 'pending-model-transition' } as const;
      return { result: rejected, completion: Promise.resolve(rejected) };
    }
    if (savedAutosave.hasFailedPrerequisiteForModelTransition()) {
      const rejected = { ok: false, reason: 'blocked-persistence-prerequisite' } as const;
      return { result: rejected, completion: Promise.resolve(rejected) };
    }
    optimisticWorkbook.current = result.value;
    setWorkbook(result.value, { kind: 'structure' });
    if (!autosaveEnabled) {
      resetHistory();
      return { result, completion: Promise.resolve(result) };
    }
    const operationId = crypto.randomUUID();
    savedAutosave.enqueue(operationId, { kind: 'model-lifecycle', before, after: result.value });
    const completion = savedAutosave.waitFor(operationId).then((entry) => {
      if (entry.status === 'succeeded') return result;
      const blockedByPrerequisite = savedAutosave.modelTransitionIsBlockedByFailedPrerequisite(operationId);
      optimisticWorkbook.current = before;
      setWorkbook(before, { kind: 'structure' });
      savedAutosave.discard(operationId);
      if (blockedByPrerequisite) return { ok: false, reason: 'blocked-persistence-prerequisite' } as const;
      return { ok: false, reason: 'persistence-failed' } as const;
    });
    return { result, completion };
  }

  function deleteSheetCommand(sheetId: string): WorkbookOperationResult {
    const pendingRejection = rejectPendingModelTransition();
    if (pendingRejection) return pendingRejection;
    if (admissionLocks.current.has(sheetId)) {
      setMutationFailure('pending-model-transition');
      return { ok: false, reason: 'pending-model-transition' };
    }

    const operation = { kind: 'delete-sheet', operationId: crypto.randomUUID(), sheetId } as const;
    const result = applyWorkbookOperation(optimisticWorkbook.current, operation);
    const applied = applyResult(result);
    if (result.ok) setMutationFailure(undefined);
    if (!applied?.changed || !applied.persistence) return result;

    savedAutosave.supersedeSheetOperations(sheetId);
    const enqueueDelete = () => savedAutosave.enqueue(operation.operationId, applied.persistence);
    const pendingAxisCreation = axisCreation.prepareSheetDeletion(sheetId);
    if (pendingAxisCreation) void pendingAxisCreation.then(enqueueDelete);
    else enqueueDelete();
    return result;
  }

  function renameSheetCommand(sheetId: string, name: string): MutationResult<Workbook> | { ok: false; reason: 'pending-model-transition' } {
    const pendingRejection = rejectPendingModelTransition();
    if (pendingRejection) return pendingRejection;
    const localSheetId = sheetId;
    const sourceWorkbook = optimisticWorkbook.current;
    const validation = validateSheetName(name, sheetsInOrder(sourceWorkbook), localSheetId);
    if (!findSheetById(sourceWorkbook, localSheetId)) return { ok: false, reason: 'unknown-sheet' };
    if (!validation.ok) return validation;
    const result = applyAction({ kind: 'rename-sheet', sheetId: localSheetId, name });
    if (!result.ok && result.reason === 'pending-model-transition') return { ok: false, reason: 'pending-model-transition' };
    if (!result.ok) return { ok: false, reason: 'unknown-sheet' };
    return { ok: true, value: result.value.nextWorkbook };
  }

  const axisCreation = useGridAxisCreationOperations({
    autosaveEnabled,
    beforeCreate: savedAutosave.waitForModelTransitions,
    currentWorkbook: () => optimisticWorkbook.current,
    persistenceCoordinator,
    reconcile: applyReconciliation,
    resolvedApiClient,
    setWorkbook,
  });

  function updateCellContent(sheetId: string, cellKey: CellKey, raw: string): CellWriteResult {
    const pendingRejection = rejectPendingModelTransition();
    if (pendingRejection) return pendingRejection;
    const localSheetId = sheetId;
    const currentSheet = findSheetById(optimisticWorkbook.current, localSheetId);
    if (!currentSheet) return { ok: false, reason: 'unknown-sheet' };
    const cell = cellIdentityAt(currentSheet.content, cellKey);
    if (!cell) return { ok: false, reason: 'invalid-cell' };
    const stored = prepareCellInput(raw, optimisticWorkbook.current, localSheetId, cellRawContent(currentSheet, cellKey));
    return storedWriteResult(applyAction({ kind: 'write-cells', writes: [{ sheetId: localSheetId, ...cell, raw: stored }] }, true, true));
  }

  function writeCells(writes: readonly { sheetId: string; rowId: string; columnId: string; raw: string }[]): CellWriteResult {
    const result = applyAction({ kind: 'write-cells', writes: writes as ({ sheetId: string; raw: string } & StableCellIdentity)[] }, true, true);
    return result.ok ? { ok: true, changed: result.value.changed } : { ok: false, reason: result.reason };
  }

  function pasteCells(sheetId: string, destinationKey: CellKey, clipboard: ClipboardParseResult): PasteCellsResult {
    const pendingRejection = rejectPendingModelTransition();
    if (pendingRejection) return pendingRejection;
    const sourceWorkbook = optimisticWorkbook.current;
    const sheet = findSheetById(sourceWorkbook, sheetId);
    const destination = sheet && cellIdentityAt(sheet.content, destinationKey);
    if (!destination) return { ok: false, reason: 'invalid-destination' };
    const prepared = prepareStoredPasteCellWrites(sourceWorkbook, sheetId, destination, clipboard);
    if (!prepared.ok) return prepared;
    const result = applyAction({ kind: 'write-cells', writes: prepared.writes }, true, true);
    return result.ok ? { ok: true, changed: result.value.changed } : { ok: false, reason: result.reason };
  }

  function moveCells(sheetId: string, destinationKey: CellKey, source: import('@application/core/clipboardPayload').ClipboardSourceSnapshot): MoveCellsResult {
    const pendingRejection = rejectPendingModelTransition();
    if (pendingRejection) return pendingRejection;
    const sourceWorkbook = optimisticWorkbook.current;
    const sheet = findSheetById(sourceWorkbook, sheetId);
    const destination = sheet && cellIdentityAt(sheet.content, destinationKey);
    if (!destination) return { ok: false, reason: 'invalid-destination' };
    const prepared = prepareStoredMoveCellWrites(sourceWorkbook, sheetId, destination, source);
    if (!prepared.ok) return prepared;
    const result = applyAction({ kind: 'write-cells', writes: prepared.writes }, true, true);
    return result.ok ? { ok: true, changed: result.value.changed } : { ok: false, reason: result.reason };
  }

  function replayContentHistory(direction: 'undo' | 'redo') {
    if (savedAutosave.hasModelTransition() || admissionLocks.current.size) return;
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

  function moveSheetFrame(sheetId: string, position: WorkspacePosition): WorkbookOperationResult {
    const localSheetId = sheetId;
    return applyAction({ kind: 'move-sheet-frame', sheetId: localSheetId, position });
  }

  function resizeSheetFrame(sheetId: string, position: WorkspacePosition, frameSize: SheetFrameSize): WorkbookOperationResult {
    const localSheetId = sheetId;
    return applyAction({
      kind: 'resize-sheet-frame', sheetId: localSheetId, position, size: frameSize,
    });
  }

  function setSheetVisualScale(sheetId: string, visualScale: number): WorkbookOperationResult {
    return applyAction({ kind: 'set-sheet-visual-scale', sheetId, visualScale });
  }

  function changeSheetZOrder(sheetId: string, direction: SheetZOrderDirection): WorkbookOperationResult {
    return applyAction({
      kind: 'change-sheet-z-order', sheetId, direction,
    });
  }

  const creationFailed = creationSaveStatus === 'failed' || axisCreation.saveStatus === 'failed';
  const creationSaving = creationSaveStatus === 'saving' || axisCreation.saveStatus === 'saving';

  return {
    entrySessions: Object.fromEntries(Object.values(workbook.documents).flatMap((sheet) => {
      const model = sheet.modelId && workbook.dataModels?.[sheet.modelId];
      return model ? [[sheet.id, entrySessions.get(sheet.id, model)]] : [];
    })),
    commands: {
      submitEntryDraft: async (sheetId) => {
        const model = entryModel(sheetId);
        if (!model || entrySessions.get(sheetId, model).pending) return {};
        const result = entrySessions.submit(sheetId, model, optimisticWorkbook.current, () => crypto.randomUUID(), async (submission) => {
          admissionLocks.current.add(sheetId);
          if (!autosaveEnabled) {
            const current = optimisticWorkbook.current;
            const sheet = current.documents[sheetId];
            if (!sheet || sheet.modelId !== model.id) throw new Error('The sheet is no longer available.');
            const cells = { ...sheet.content.cells };
            for (const [propertyId, value] of Object.entries(submission.values)) {
              const columnId = sheet.modelColumnBindings?.[propertyId];
              if (!columnId || !sheet.content.columns.includes(columnId)) throw new Error('The model bindings changed.');
              if (value !== '') cells[cellIdentityKey({ rowId: submission.rowId, columnId })] = value;
            }
            const nextSheet = { ...sheet, content: { ...sheet.content, rows: [...sheet.content.rows, submission.rowId], cells } };
            const next = materializeAppendedModelRow({ ...current, documents: { ...current.documents, [sheetId]: nextSheet } }, sheetId, submission.rowId);
            optimisticWorkbook.current = next;
            setWorkbook(next, { kind: 'structure' });
            return { rowId: submission.rowId, sheet: next.documents[sheetId]! };
          }
          return admitEntryRecord({
            sheetId, submission, coordinator: persistenceCoordinator,
            waitForPredecessors: async () => {
              for (const entry of savedAutosave.currentOutboxSnapshot()) {
                if (entry.intent.kind !== 'model-lifecycle' && !entry.affectedSheetIds.includes(sheetId)) continue;
                const settled = entry.status === 'queued' || entry.status === 'running' ? await savedAutosave.waitFor(entry.operationId) : entry;
                if (settled.status === 'failed' || settled.status === 'blocked') throw new Error('Resolve failed saves before adding a record.');
              }
            },
            currentSheet: () => {
              const sheet = optimisticWorkbook.current.documents[sheetId];
              return sheet?.modelId === model.id ? sheet : undefined;
            },
            admit: resolvedApiClient.admitRecord ?? workbookApi.admitRecord,
            reconcile: (sheet) => {
              const next = { ...optimisticWorkbook.current, documents: { ...optimisticWorkbook.current.documents, [sheetId]: sheet } };
              optimisticWorkbook.current = next;
              setWorkbook(next, { kind: 'structure' });
            },
          });
        });
        publishEntries();
        try {
          const settled = await result;
          if (settled.result) admissionLocks.current.delete(sheetId);
          return settled;
        } finally { publishEntries(); }
      },
      changeEntryField: (sheetId, propertyId, raw) => {
        const model = entryModel(sheetId);
        if (model) { entrySessions.change(sheetId, model, propertyId, raw, optimisticWorkbook.current); publishEntries(); }
      },
      leaveEntryField: (sheetId, propertyId) => {
        const model = entryModel(sheetId);
        if (model) { entrySessions.leave(sheetId, model, propertyId, optimisticWorkbook.current); publishEntries(); }
      },
      dismissEntryFeedback: (sheetId, propertyId) => {
        const model = entryModel(sheetId);
        if (model) { entrySessions.dismiss(sheetId, model, propertyId); publishEntries(); }
      },
      bindSheetToModel: (sheetId, modelId) => applyModelLifecycleTransition((source) => bindSheetToModel(source, sheetId, modelId, () => crypto.randomUUID())),
      unbindSheetFromModel: (sheetId) => applyModelLifecycleTransition((source) => unbindSheetFromModel(source, sheetId)),
      addDataModel: (model) => applyModelLifecycleTransition((source) => addDataModel(source, model)),
      replaceModelDeclaration: (model) => applyModelLifecycleTransition((source) => replaceModelDeclaration(source, model, () => crypto.randomUUID())),
      renameColumn: (sheetId, columnId, name) => applyModelLifecycleTransition((source) => renameColumn(source, sheetId, columnId, name)),
      writeNumberFormats: (sheetId, writes) => applyAction({ kind: 'write-number-formats', sheetId, writes }),
      writeAxisSizes: (sheetId, writes) => applyAction({ kind: 'write-axis-sizes', sheetId, writes }),
      appendColumn: (sheetId) => { if (!admissionLocks.current.has(sheetId)) axisCreation.appendColumn(sheetId); else setMutationFailure('pending-model-transition'); },
      appendRow: (sheetId) => { if (!admissionLocks.current.has(sheetId)) axisCreation.appendRow(sheetId); else setMutationFailure('pending-model-transition'); },
      changeSheetZOrder,
      createSheet,
      deleteSheet: deleteSheetCommand,
      moveSheetFrame,
      moveCells,
      pasteCells,
      pasteStoredCells: pasteCells,
      moveStoredCells: moveCells,
      renameSheet: renameSheetCommand,
      retryFailedSaves: savedAutosave.retryFailedSaves,
      resizeSheetFrame,
      setSheetVisualScale,
      undo: () => replayContentHistory('undo'),
      redo: () => replayContentHistory('redo'),
      updateCellContent,
      writeCells,
      writeStoredCells: (writes) => storedWriteResult(applyAction({ kind: 'write-cells', writes }, true, true)),
    },
    canRetryFailedSaves: savedAutosave.hasRetryableFailures,
    canUndo: !savedAutosave.hasModelTransition() && contentHistory.canUndo,
    canRedo: !savedAutosave.hasModelTransition() && contentHistory.canRedo,
    contentHistoryFeedback: savedAutosave.hasModelTransition() ? undefined : contentHistoryFeedback,
    mutationFailure,
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

function storedWriteResult(result: WorkbookOperationResult): CellWriteResult { return result.ok ? { ok: true, changed: result.value.changed } : { ok: false, reason: result.reason }; }
