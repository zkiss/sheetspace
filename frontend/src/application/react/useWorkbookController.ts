import type { WorkspacePosition, SheetFrameSize, SheetZOrderDirection, StableCellIdentity, Workbook, DataModel } from '@workbook/core/model';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CalculationImpact } from '@workbook/read/calculationProjection';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { workbookApi, type WorkbookApi } from '@infrastructure/persistence/workbookApi';
import { recoverRecordAdmission } from '@infrastructure/persistence/recoverRecordAdmission';
import { useRecordReplay } from './useRecordReplay';
import { useMissingEntrySessions } from './useMissingEntrySessions';
import { useContentHistoryFeedback } from './useContentHistoryFeedback';
import { useLifecycleSettlement } from './useLifecycleSettlement';
import { useMixedHistory } from './useMixedHistory';
import { extractionCommand } from './extractionCommand';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import { createEmptyWorkbook, validateSheetName } from '@workbook/mutations/operations';
import { gatherAxis, shiftAxis } from '@workbook/mutations/reorderAxis';
import { cellRawContent, findSheetById, sheetsInOrder } from '@workbook/read/queries';
import { type CellKey } from '@workbook/core/address';
import {
  applyBackendWorkbookReconciliation, applyWorkbookOperation, applyStoredCellWrites,
  prepareStoredPasteCellWrites, prepareStoredMoveCellWrites,
  type AppliedWorkbookOperation, type WorkbookOperationResult, type CellWriteResult, type WorkbookOperation,
} from '@application/core/userActions';
import type { ClipboardParseResult } from '@application/core/clipboardPayload';
import { createSortingHistory } from './sortingHistory';
import { submitSortedOrigin } from './submitSortedOrigin';
import { reportOriginatingFailure, submitOriginatingLifecycle, submitSortedDeletion } from './submitOriginatingLifecycle';
import { reorderOrigin } from './axisReorder';
import { ContentHistory } from '@application/core/contentHistory';
import { bindSheetToModel, unbindSheetFromModel, replaceModelDeclaration } from '@application/core/modelLifecycle';
import { renameColumn } from '@application/core/renameColumn';
import { deleteRow } from '@application/core/deleteRow';
import { deleteColumn } from '@application/core/deleteColumn';
import { addDataModel } from '@workbook/mutations/dataModel';
import { appendModelEntry, materializeAppendedModelRow } from '@application/core/modelRowAppend';
import { settleSorting } from '@application/core/settleSorting';
import { admitLocalRecord, replayLocalRecord } from '@application/core/localRecordReplay';
import { prepareCellInput } from '@application/core/cellInputPreparation';
import { EntryAdmissionRejected, ModelEntrySessions } from '@application/core/modelEntrySession';
import { admitEntryRecord } from '@application/core/admitEntryRecord';
import { WorkbookMutationBarrier } from '@application/core/workbookMutationBarrier';
import { useSavedSheetAutosave } from './useSavedSheetAutosave';
import { useGridAxisCreationOperations } from './useGridAxisCreationOperations';
import { useSheetCreationOperations } from '@application/react/useSheetCreationOperations';
import { useStartupWorkbookLoad } from './useStartupWorkbookLoad';
import { WorkbookPersistenceCoordinator } from '@infrastructure/persistence/workbookPersistenceCoordinator';
import { calculationRequest, mergeCalculationImpacts, type CalculationRequest, type SetWorkbook } from '@calculation/workbookCalculation';

export type { WorkbookCommands, ModelCommandResult, DataModelCommandSubmission, RenameColumnResult, RenameColumnSubmission, PasteCellsResult, MoveCellsResult, ContentHistoryCellSnapshot, ContentHistoryFeedback, WorkbookController } from './workbookControllerTypes';
import type { WorkbookController, WorkbookControllerState, TransitionFailure, RenameSheetResult, PasteCellsResult, MoveCellsResult } from './workbookControllerTypes';

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
  const barrierRef = useRef<WorkbookMutationBarrier | undefined>(undefined);
  barrierRef.current ??= new WorkbookMutationBarrier();
  const admissionFence = barrierRef.current;
  const appliedCalculation = useRef<CalculationRequest | undefined>(undefined);
  const contentHistoryRef = useRef<ContentHistory | undefined>(undefined);
  contentHistoryRef.current ??= new ContentHistory();
  const contentHistory = contentHistoryRef.current;
  const [, setHistoryRevision] = useState(0);
  const [contentHistoryFeedback, setContentHistoryFeedback] = useContentHistoryFeedback();
  const [mutationFailure, setMutationFailure] = useState<WorkbookController['mutationFailure']>();
  const setWorkbook = useCallback<SetWorkbook>((update, impact) => {
    const nextWorkbook = typeof update === 'function'
      ? update(optimisticWorkbook.current)
      : update;
    optimisticWorkbook.current = nextWorkbook;
    setControllerState((current) => {
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
  useMissingEntrySessions(persistenceCoordinator, entrySessions, admissionLocks);
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
  const resetHistory = () => { contentHistory.clear(); mixedHistory.clearFeedback(); setHistoryRevision((revision) => revision + 1); };
  const lifecycle = useLifecycleSettlement({ subscribeOutbox: savedAutosave.subscribeOutbox, revision: savedAutosave.revision, autosaveEnabled, current: optimisticWorkbook, setWorkbook, autosave: savedAutosave, resetHistory });
  const { createSheet, creatingFrames, hasPendingCreations, saveStatus: creationSaveStatus } = useSheetCreationOperations({
    autosaveEnabled,
    beforeCreate: lifecycle.wait,
    currentWorkbook: () => optimisticWorkbook.current,
    resolvedApiClient,
    setWorkbook,
  });
  const { isStartupLoading, retryStartupLoad, startupLoad } = useStartupWorkbookLoad({
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
  type WorkbookOperationInput = WorkbookOperation extends infer Operation ? Operation extends unknown ? Omit<Operation, 'operationId'> : never : never;

  function applyResult(result: WorkbookOperationResult): AppliedWorkbookOperation | undefined {
    if (!result.ok) return undefined;
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
    if ((operation.kind === 'write-cells' || operation.kind === 'rename-sheet') && result.ok && result.value.changed && (sheetsInOrder(optimisticWorkbook.current).some((sheet) => sheet.sorting?.length) || sheetsInOrder(result.value.nextWorkbook).some((sheet) => sheet.sorting?.length))) {
      if (recordReplay.state.unresolved) { setMutationFailure('pending-model-transition'); return { ok: false, reason: 'pending-model-transition' }; }
      const submitted = submitSortedOrigin({ before: optimisticWorkbook.current, candidate: result.value.nextWorkbook, impact: operation.kind === 'rename-sheet' ? { kind: 'structure' } : result.value.calculationImpact, calculation: committedCalculation.current!, history: contentHistory, submit: (candidate, success) => applyModelLifecycleTransition(() => ({ ok: true as const, value: candidate }), success, true), publish: () => { mixedHistory.clearFeedback(); setHistoryRevision((revision) => revision + 1); } });
      if (!submitted.ok) return submitted;
      setMutationFailure(undefined);
      return { ok: true, value: { ...result.value, nextWorkbook: submitted.value, calculationImpact: { kind: 'structure' } } };
    }
    const applied = applyResult(result);
    if (result.ok) setMutationFailure(undefined);
    if (applied?.changed) {
      savedAutosave.enqueue(operation.operationId, applied.persistence);
      if (recordContentHistory && operation.kind === 'write-cells' && applied.persistence?.kind === 'write-cells') {
        mixedHistory.clearFeedback();
        contentHistory.record(applied.persistence.writes, applied.affected);
        setHistoryRevision((revision) => revision + 1);
      }
    }
    return result;
  }

  function rejectPendingModelTransition(): { ok: false; reason: 'pending-model-transition' } | undefined {
    if (!lifecycle.hasPending() && !admissionFence.held) return undefined;
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
      setWorkbook(next, { kind: 'structure' });
    }
    return applied;
  }

  function applyModelLifecycleTransition<T extends { ok: true; value: Workbook } | { ok: false }>(transform: (source: Workbook) => T, onSuccess?: (before: Workbook, after: Workbook) => void, protectEntryContents = false, publication?: import('./workbookControllerTypes').LifecyclePublication): Readonly<{ result: T | TransitionFailure; completion: Promise<T | TransitionFailure> }> {
    if (admissionFence.held) {
      setMutationFailure('pending-model-transition');
      const result = { ok: false, reason: 'pending-model-transition' } as const;
      return { result, completion: Promise.resolve(result) };
    }
    const before = optimisticWorkbook.current;
    const result = transform(before);
    if (!result.ok || result.value === before) return { result, completion: Promise.resolve(result) };
    if (Object.keys(before.documents).some((id) =>
      (admissionLocks.current.has(id) && before.documents[id] !== result.value.documents[id]) ||
      (protectEntryContents && entrySessions.hasUnfinished(id) && JSON.stringify({ ...before.documents[id], revision: 0 }) !== JSON.stringify({ ...result.value.documents[id], revision: 0 })) ||
      entrySessions.protectsTransition(before, result.value, id))) {
      const rejected = { ok: false, reason: 'pending-model-transition' } as const;
      setMutationFailure('pending-model-transition');
      return { result: rejected, completion: Promise.resolve(rejected) };
    }
    if (axisCreation.hasUnsettled()) {
      const rejected = { ok: false, reason: 'pending-axis-creation' } as const;
      return { result: rejected, completion: Promise.resolve(rejected) };
    }
    if (hasPendingCreations()) {
      const rejected = { ok: false, reason: 'pending-sheet-creation' } as const;
      return { result: rejected, completion: Promise.resolve(rejected) };
    }
    if (lifecycle.hasPending()) {
      const rejected = { ok: false, reason: 'pending-model-transition' } as const;
      return { result: rejected, completion: Promise.resolve(rejected) };
    }
    if (savedAutosave.hasFailedPrerequisiteForModelTransition()) {
      const rejected = { ok: false, reason: 'blocked-persistence-prerequisite' } as const;
      return { result: rejected, completion: Promise.resolve(rejected) };
    }
    return { result, completion: lifecycle.submit(before, result, onSuccess && (() => onSuccess(before, result.value)), publication) as Promise<T | TransitionFailure> };

  }

  function applyOriginatingLifecycle<T extends { ok: true; value: Workbook } | { ok: false }>(transform: (source: Workbook) => T, publication?: import('./workbookControllerTypes').LifecyclePublication, onSuccess?: () => void, isNoop?: (final: Workbook) => boolean) {
    const submission = submitOriginatingLifecycle({ before: optimisticWorkbook.current, transform, publication, replayUnresolved: recordReplay.state.unresolved, calculation: committedCalculation.current!, history: contentHistory, submit: applyModelLifecycleTransition, isNoop, publish: () => { onSuccess?.(); mixedHistory.clearFeedback(); setHistoryRevision((revision) => revision + 1); } });
    reportOriginatingFailure(submission.result, setMutationFailure); return submission;
  }

  function deleteSheetCommand(sheetId: string): WorkbookOperationResult {
    const pendingRejection = rejectPendingModelTransition();
    if (pendingRejection) return pendingRejection;
    if (admissionLocks.current.has(sheetId) || entrySessions.hasUnfinished(sheetId)) {
      setMutationFailure('pending-model-transition');
      return { ok: false, reason: 'pending-model-transition' };
    }

    const operation = { kind: 'delete-sheet', operationId: crypto.randomUUID(), sheetId } as const; const result = applyWorkbookOperation(optimisticWorkbook.current, operation);
    const sorted = submitSortedDeletion(optimisticWorkbook.current, result, (candidate) => applyOriginatingLifecycle(() => ({ ok: true as const, value: candidate }), undefined, () => entrySessions.remove(sheetId)).result);
    if (sorted) return sorted;
    const applied = applyResult(result);
    if (result.ok) setMutationFailure(undefined);
    if (applied?.changed) entrySessions.remove(sheetId);
    if (!applied?.changed || !applied.persistence) return result;

    savedAutosave.supersedeSheetOperations(sheetId);
    const enqueueDelete = () => savedAutosave.enqueue(operation.operationId, applied.persistence);
    const pendingAxisCreation = axisCreation.prepareSheetDeletion(sheetId); if (pendingAxisCreation) void pendingAxisCreation.then(enqueueDelete);
    else enqueueDelete();
    return result;
  }

  function renameSheetCommand(sheetId: string, name: string): RenameSheetResult {
    const pendingRejection = rejectPendingModelTransition();
    if (pendingRejection) return pendingRejection;
    const sourceWorkbook = optimisticWorkbook.current;
    const validation = validateSheetName(name, sheetsInOrder(sourceWorkbook), sheetId);
    if (!findSheetById(sourceWorkbook, sheetId)) return { ok: false, reason: 'unknown-sheet' };
    if (!validation.ok) return validation;
    const result = applyAction({ kind: 'rename-sheet', sheetId, name });
    if (!result.ok && (result.reason === 'pending-model-transition' || result.reason === 'pending-axis-creation' || result.reason === 'pending-sheet-creation' || result.reason === 'blocked-persistence-prerequisite' || result.reason === 'persistence-failed' || result.reason === 'sorting-history-too-large')) return { ok: false, reason: result.reason };
    return result.ok ? { ok: true, value: result.value.nextWorkbook } : { ok: false, reason: 'unknown-sheet' };
  }

  const axisCreation = useGridAxisCreationOperations({
    autosaveEnabled,
    beforeCreate: lifecycle.wait,
    waitForAxisOrders: savedAutosave.waitForAxisOrders,
    hasPendingRecreation: savedAutosave.hasPendingRecreation,
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

  const recordReplay = useRecordReplay({
    history: contentHistory, coordinator: persistenceCoordinator,
    publishHistory: () => setHistoryRevision((revision) => revision + 1),
    replayLocal: (transaction, direction) => { if (autosaveEnabled || !transaction.localRecord) throw new Error('Local record replay is unavailable.'); setWorkbook(replayLocalRecord(optimisticWorkbook.current, transaction.localRecord, direction), { kind: 'structure' }); },
    run: (execute) => admissionFence.run({
      hasUnsettled: () => lifecycle.hasPending() || hasPendingCreations() || axisCreation.hasUnsettled() || isStartupLoading(),
      snapshot: savedAutosave.currentOutboxSnapshot, waitFor: savedAutosave.waitFor, execute,
    }),
    replayOptions: {
      coordinator: persistenceCoordinator, currentWorkbook: () => optimisticWorkbook.current,
      loadWorkbook: resolvedApiClient.loadWorkbook ?? workbookApi.loadWorkbook,
      replay: resolvedApiClient.replayRecord ?? workbookApi.replayRecord,
      reconcile: (next) => setWorkbook(next, { kind: 'structure' }),
    },
  });
  const mixedHistory = useMixedHistory({
    current: optimisticWorkbook, setWorkbook, history: contentHistory,
    enqueue: savedAutosave.enqueue, hasPending: () => lifecycle.hasPending() || admissionFence.held, hasPendingAxisCreation: axisCreation.hasUnsettledSheet,
    admissionLocks, setMutationFailure, setContentHistoryFeedback,
    setCellFeedback: setContentHistoryFeedback, applyResult, formulaResults,
    submit: (transform, success) => applyModelLifecycleTransition(transform, success, true),
    publishHistory: () => setHistoryRevision((revision) => revision + 1),
    replayRecord: recordReplay.replay, replaySemantic: (transaction, direction) => sortingHistory.replay(transaction, direction),
  });

  const sortingHistory = createSortingHistory({ submit: (transform, success) => applyModelLifecycleTransition(transform, success, true), history: contentHistory, calculation: committedCalculation.current!, publish: () => { mixedHistory.clearFeedback(); setHistoryRevision((revision) => revision + 1); } });

  function moveSheetFrame(sheetId: string, position: WorkspacePosition): WorkbookOperationResult {
    return applyAction({ kind: 'move-sheet-frame', sheetId, position });
  }

  function resizeSheetFrame(sheetId: string, position: WorkspacePosition, frameSize: SheetFrameSize): WorkbookOperationResult {
    return applyAction({ kind: 'resize-sheet-frame', sheetId, position, size: frameSize });
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
      currentWorkbook: () => optimisticWorkbook.current,
      configureSorting: sortingHistory.configure,
      gatherAxis: (sheetId, axis, ids, gap) => reorderOrigin({ before: optimisticWorkbook.current, sheetId, axis, transform: (source) => gatherAxis(source, sheetId, axis, ids, gap), reorder: mixedHistory.reorder, submit: (candidate, isNoop) => applyOriginatingLifecycle(() => ({ ok: true as const, value: candidate }), undefined, undefined, isNoop).result }),
      shiftAxis: (sheetId, axis, ids, direction) => reorderOrigin({ before: optimisticWorkbook.current, sheetId, axis, transform: (source) => shiftAxis(source, sheetId, axis, ids, direction), reorder: mixedHistory.reorder, submit: (candidate, isNoop) => applyOriginatingLifecycle(() => ({ ok: true as const, value: candidate }), undefined, undefined, isNoop).result }),
      extractSelection: (request, publication) => extractionCommand(request, {
        history: contentHistory,
        current: () => optimisticWorkbook.current,
        submit: (transform, success) => applyModelLifecycleTransition(transform, success, true, publication),
        submitOrigin: (candidate) => applyOriginatingLifecycle(() => ({ ok: true as const, value: candidate }), publication),
        publish: () => { mixedHistory.clearFeedback(); setHistoryRevision((revision) => revision + 1); },
      }),
      submitEntryDraft: async (sheetId) => {
        if (rejectPendingModelTransition()) return {};
        const model = entrySessions.retryModel(sheetId) ?? entryModel(sheetId);
        if (!model || entrySessions.get(sheetId, model).pending) return {};
        const result = entrySessions.submit(sheetId, model, optimisticWorkbook.current, () => crypto.randomUUID(), async (submission) => {
          admissionLocks.current.add(sheetId);
          if (!autosaveEnabled) {
            const admitted = admitLocalRecord(optimisticWorkbook.current, sheetId, model.id, submission.rowId, submission.values, committedCalculation.current!);
            setWorkbook(admitted.workbook, { kind: 'structure' }); contentHistory.recordModelRecord({ sheetId, rowId: submission.rowId }, admitted.delta);
            setHistoryRevision((revision) => revision + 1);
            return { rowId: submission.rowId, sheet: admitted.workbook.documents[sheetId]! };
          }
          try {
            return await admissionFence.run({
              hasUnsettled: () => lifecycle.hasPending() || hasPendingCreations() || axisCreation.hasUnsettled() || isStartupLoading(),
              snapshot: savedAutosave.currentOutboxSnapshot,
              waitFor: savedAutosave.waitFor,
              execute: () => admitEntryRecord({
              sheetId, submission, coordinator: persistenceCoordinator,
              waitForPredecessors: async () => {},
              currentWorkbook: () => optimisticWorkbook.current,
              loadWorkbook: resolvedApiClient.loadWorkbook ?? workbookApi.loadWorkbook,
              prepare: (before) => settleSorting(
                appendModelEntry(before, sheetId, model.id, submission.rowId, submission.values),
                committedCalculation.current!, { kind: 'structure' },
              ).orders.map(({ sheetId: id, after }) => ({ sheetId: id, order: after })),
              admit: resolvedApiClient.admitRecord ?? workbookApi.admitRecord,
              recover: (error, refresh) => recoverRecordAdmission(error, sheetId, persistenceCoordinator, refresh),
              reconcile: (next) => setWorkbook(next, { kind: 'structure' }),
              }),
            });
          } catch (error) {
            if (!submission.request) throw new EntryAdmissionRejected(error instanceof Error ? error.message : 'Could not prepare record.');
            throw error;
          }
        });
        publishEntries();
        try {
          const settled = await result;
          if (settled.result && autosaveEnabled) { contentHistory.recordModelRecord({ sheetId, rowId: settled.result.rowId });
            setHistoryRevision((revision) => revision + 1);
          }
          if (settled.result || !entrySessions.get(sheetId, model).retryRequired) {
            admissionLocks.current.delete(sheetId);
            if (!optimisticWorkbook.current.documents[sheetId]) entrySessions.remove(sheetId);
          }
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
      bindSheetToModel: (sheetId, modelId, publication) => applyOriginatingLifecycle((source) => bindSheetToModel(source, sheetId, modelId, () => crypto.randomUUID()), publication),
      unbindSheetFromModel: (sheetId, publication) => applyOriginatingLifecycle((source) => unbindSheetFromModel(source, sheetId), publication),
      addDataModel: (model) => applyOriginatingLifecycle((source) => addDataModel(source, model)),
      replaceModelDeclaration: (model, publication) => applyOriginatingLifecycle((source) => replaceModelDeclaration(source, model, () => crypto.randomUUID()), publication),
      renameColumn: (sheetId, columnId, name) => applyOriginatingLifecycle((source) => renameColumn(source, sheetId, columnId, name)),
      writeNumberFormats: (sheetId, writes) => applyAction({ kind: 'write-number-formats', sheetId, writes }),
      writeAxisSizes: (sheetId, writes) => applyAction({ kind: 'write-axis-sizes', sheetId, writes }),
      appendColumn: (sheetId) => { if (!admissionFence.held && !admissionLocks.current.has(sheetId)) axisCreation.appendColumn(sheetId); else setMutationFailure('pending-model-transition'); },
      appendRow: (sheetId) => { if (!admissionFence.held && !admissionLocks.current.has(sheetId)) axisCreation.appendRow(sheetId); else setMutationFailure('pending-model-transition'); },
      deleteRow: (sheetId, rowId, publication) => applyOriginatingLifecycle((source) => deleteRow(source, sheetId, rowId), publication),
      deleteColumn: (sheetId, columnId, publication) => applyOriginatingLifecycle((source) => deleteColumn(source, sheetId, columnId), publication),
      changeSheetZOrder,
      createSheet: (...args) => admissionFence.held ? { ok: false, reason: 'pending-model-transition' } : createSheet(...args),
      deleteSheet: deleteSheetCommand,
      moveSheetFrame,
      moveCells,
      pasteCells,
      pasteStoredCells: pasteCells,
      moveStoredCells: moveCells,
      renameSheet: renameSheetCommand,
      retryFailedSaves: () => { if (admissionFence.held) setMutationFailure('pending-model-transition'); else savedAutosave.retryFailedSaves(); },
      resizeSheetFrame,
      setSheetVisualScale,
      undo: () => recordReplay.state.unresolved ? recordReplay.confirmRetained() : mixedHistory.replay('undo'),
      redo: () => recordReplay.state.unresolved ? recordReplay.confirmRetained() : mixedHistory.replay('redo'),
      updateCellContent,
      writeCells,
      writeStoredCells: (writes) => storedWriteResult(applyAction({ kind: 'write-cells', writes }, true, true)),
    },
    canRetryFailedSaves: savedAutosave.hasRetryableFailures,
    canUndo: !lifecycle.hasPending() && (recordReplay.state.unresolved || contentHistory.canUndo),
    canRedo: !lifecycle.hasPending() && contentHistory.canRedo,
    contentHistoryFeedback: lifecycle.hasPending() ? undefined : contentHistoryFeedback,
    orderReplayFailure: mixedHistory.orderFailure,
    recordReplay: recordReplay.state,
    extractionReplayFailure: mixedHistory.extractionFailure,
    mutationFailure,
    formulaResults,
    retryStartupLoad: () => { if (admissionFence.held) setMutationFailure('pending-model-transition'); else retryStartupLoad(); },
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
