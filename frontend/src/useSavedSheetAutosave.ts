import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SaveStatus } from './appTypes';
import { cellAddressOf } from './workbook/core/cellIdentity';
import { cellKey } from './workbook/core/address';
import { findSheetById } from './workbook/read/queries';
import { type SheetId, type Workbook } from './workbook/core/model';
import type { SetWorkbook } from './workbookCalculation';
import type { WorkbookApi } from './workbookApi';
import { WorkbookPersistenceCoordinator } from './workbookPersistenceCoordinator';
import type { WorkbookOperationId, WorkbookPersistenceIntent } from './userActions';
import {
  WorkbookOutbox,
  WorkbookPersistenceTransport,
  type OutboxSnapshot,
  type PersistenceTransport,
  type TransportResult,
} from './workbookOutbox';

function removeSheets(workbook: Workbook, sheetIds: readonly SheetId[]): Workbook {
  const removed = new Set(sheetIds);
  if (!workbook.manifest.sheetIds.some((sheetId) => removed.has(sheetId))) return workbook;
  const documents = { ...workbook.documents };
  for (const sheetId of removed) delete documents[sheetId];
  return {
    ...workbook,
    manifest: {
      ...workbook.manifest,
      sheetIds: workbook.manifest.sheetIds.filter((sheetId) => !removed.has(sheetId)),
    },
    documents,
  };
}

/** React integration for the framework-independent, data-only saved-sheet outbox. */
export function useSavedSheetAutosave({
  autosaveEnabled,
  resolvedApiClient,
  persistenceCoordinator,
  setWorkbook,
  workbook,
}: {
  autosaveEnabled: boolean;
  resolvedApiClient: Partial<WorkbookApi>;
  persistenceCoordinator?: WorkbookPersistenceCoordinator;
  setWorkbook: SetWorkbook;
  workbook: Workbook;
}) {
  const workbookRef = useRef(workbook);
  workbookRef.current = workbook;
  const outboxRef = useRef<WorkbookOutbox | undefined>(undefined);
  outboxRef.current ??= new WorkbookOutbox();
  const outbox = outboxRef.current;
  const coordinatorRef = useRef<WorkbookPersistenceCoordinator | undefined>(undefined);
  coordinatorRef.current ??= persistenceCoordinator ?? new WorkbookPersistenceCoordinator();
  const coordinator = coordinatorRef.current;
  const [snapshot, setSnapshot] = useState<OutboxSnapshot>(() => outbox.snapshot());
  const transport = useMemo(() => new WorkbookPersistenceTransport(
    resolvedApiClient,
    (sheetId, cell) => {
      const sheet = findSheetById(workbookRef.current, sheetId);
      const address = sheet ? cellAddressOf(sheet.content, cell) : undefined;
      return address ? cellKey(address) : undefined;
    },
    coordinator,
  ), [coordinator, resolvedApiClient]);

  for (const sheet of Object.values(workbook.documents)) {
    transport.recordRevision(sheet.id, sheet.revision);
  }

  useEffect(() => outbox.subscribe(setSnapshot), [outbox]);
  useEffect(() => coordinator.subscribeToMissingSheets((sheetId, source) => {
    outbox.supersedeMissingSheetOperations(sheetId, source.savedOperationId);
    setWorkbook((current) => removeSheets(current, [sheetId]), { kind: 'structure' });
  }), [coordinator, outbox, setWorkbook]);

  const reconcileResult = useCallback((
    result: TransportResult,
    intent: WorkbookPersistenceIntent,
    operationId: WorkbookOperationId,
  ) => {
    if (result.kind === 'saved') {
      if (result.revisions.length > 0) {
        setWorkbook((current) => {
          let next = current;
          for (const { sheetId, revision } of result.revisions) {
            const sheet = findSheetById(next, sheetId);
            if (!sheet || sheet.revision >= revision) continue;
            next = {
              ...next,
              documents: { ...next.documents, [sheetId]: { ...sheet, revision } },
            };
          }
          return next;
        }, { kind: 'none' });
      }
      for (const sheetId of result.missingSheetIds ?? []) {
        coordinator.confirmSheetMissing(sheetId, { savedOperationId: operationId });
      }
      if (intent.kind === 'delete-sheet') outbox.supersedeMissingSheetOperations(intent.sheetId, operationId);
      return;
    }
    if (result.kind === 'missing-sheet') {
      for (const sheetId of result.sheetIds) {
        coordinator.confirmSheetMissing(sheetId, { savedOperationId: operationId });
      }
    }
  }, [coordinator, outbox, setWorkbook]);

  const persistenceTransport = useMemo<PersistenceTransport>(() => ({
    execute: async (entry) => {
      const result = await transport.execute(entry);
      // The payload is transport-only here: reconciliation never reapplies the operation locally.
      reconcileResult(result, entry.intent, entry.operationId);
      return result;
    },
  }), [outbox, reconcileResult, transport]);

  const pump = useCallback(function pumpAvailable() {
    for (const execution of outbox.executeAvailable(persistenceTransport)) {
      void execution.finally(pumpAvailable);
    }
  }, [outbox, persistenceTransport]);

  const enqueue = useCallback((operationId: WorkbookOperationId, intent: WorkbookPersistenceIntent | undefined) => {
    if (!autosaveEnabled || !intent) return;
    const sheetIds = intent.kind === 'update-sheet-z-order'
      ? intent.updates.map(({ sheetId }) => sheetId)
      : [intent.sheetId];
    if (sheetIds.some((sheetId) => coordinator.isSheetMissing(sheetId))) return;
    outbox.enqueue(operationId, intent);
    pump();
  }, [autosaveEnabled, coordinator, outbox, pump]);

  const retryFailedSaves = useCallback(() => {
    for (const entry of outbox.snapshot()) {
      if (entry.status === 'failed' || entry.status === 'blocked') outbox.retry(entry.operationId);
    }
    pump();
  }, [outbox, pump]);

  const supersedeSheetOperations = useCallback((sheetId: SheetId) => {
    outbox.supersedeSheetOperations(sheetId);
  }, [outbox]);

  const hasRetryableFailures = snapshot.some((entry) => entry.status === 'failed' || entry.status === 'blocked');
  const hasPendingSaves = snapshot.some((entry) => entry.status === 'queued' || entry.status === 'running');
  const saveStatus: SaveStatus = hasRetryableFailures ? 'failed' : hasPendingSaves ? 'saving' : 'saved';

  return {
    enqueue,
    hasRetryableFailures,
    markSaved: useCallback(() => undefined, []),
    outboxSnapshot: snapshot,
    retryFailedSaves,
    saveStatus,
    supersedeSheetOperations,
  };
}
