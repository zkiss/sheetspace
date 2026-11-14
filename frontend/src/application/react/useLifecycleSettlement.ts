import { useEffect, useRef } from 'react';
import type { SheetId, Workbook } from '@workbook/core/model';
import type { SetWorkbook } from '@calculation/workbookCalculation';
import type { OutboxSnapshot } from '@infrastructure/persistence/workbookOutbox';
import { WorkbookApiError } from '@infrastructure/persistence/workbookApi';
import type { LifecycleReceipt } from '@infrastructure/persistence/workbookApi';
import type { WorkbookPersistenceIntent } from '@application/core/userActions';
import type { useSavedSheetAutosave } from './useSavedSheetAutosave';
import type { LifecyclePublication, TransitionFailure } from './workbookControllerTypes';

export function useLifecycleSettlement(options: {
  autosaveEnabled: boolean;
  current: React.MutableRefObject<Workbook>;
  setWorkbook: SetWorkbook;
  autosave: ReturnType<typeof useSavedSheetAutosave>;
  resetHistory: () => void;
  subscribeOutbox: (listener: (snapshot: OutboxSnapshot) => void) => () => void;
  revision: (sheetId: SheetId) => number | undefined;
}) {
  const pending = useRef<Promise<void> | undefined>(undefined);
  // An ambiguous failure may have committed server-side, so the exact payload
  // is retained for a later compare-and-swap retry instead of a new identity.
  const recoveries = useRef(new Map<string, { onSuccess: (after: Workbook, receipt?: LifecycleReceipt) => void }>());
  const { subscribeOutbox } = options;
  const { setWorkbook } = options;
  const { discard } = options.autosave;

  useEffect(() => subscribeOutbox((snapshot) => {
    for (const [operationId, recovery] of recoveries.current) {
      const entry = snapshot.find((candidate) => candidate.operationId === operationId);
      if (entry?.status !== 'succeeded' || !entry.receipt) continue;
      recoveries.current.delete(operationId);
      setWorkbook(entry.receipt.workbook, { kind: 'structure' });
      recovery.onSuccess(entry.receipt.workbook, entry.receipt);
      // Let every listener consume this publication before removing its payload.
      queueMicrotask(() => discard(operationId));
    }
  }), [subscribeOutbox, setWorkbook, discard]);

  const hasPending = () => Boolean(pending.current) || options.autosave.hasModelTransition();
  const wait = () => {
    const local = pending.current;
    const transport = options.autosave.waitForModelTransitions();
    if (!local) return transport;
    return transport ? Promise.all([local, transport]).then(() => undefined) : local;
  };
  function submit<T extends { ok: true; value: Workbook }>(before: Workbook, result: T, onSuccess: (after: Workbook, receipt?: LifecycleReceipt) => void = options.resetHistory, publication?: LifecyclePublication, replay?: Extract<WorkbookPersistenceIntent, { kind: 'model-lifecycle' }>['replay']): Promise<T | TransitionFailure> {
    let release!: () => void;
    pending.current = new Promise<void>((resolve) => { release = resolve; });
    options.setWorkbook(result.value, { kind: 'structure' });
    publication?.(before, result.value, 'optimistic');
    if (!options.autosaveEnabled) {
      onSuccess(result.value);
      pending.current = undefined;
      release();
      return Promise.resolve(result);
    }
    const operationId = crypto.randomUUID();
    options.autosave.enqueue(operationId, { kind: 'model-lifecycle', before, after: result.value, ...(replay && { replay }) });
    return options.autosave.waitFor(operationId).then((entry) => {
      if (entry.status === 'succeeded' && entry.receipt) {
        options.setWorkbook(entry.receipt.workbook, { kind: 'structure' });
        onSuccess(entry.receipt.workbook, entry.receipt);
        options.autosave.discard(operationId);
        return { ...result, value: entry.receipt.workbook };
      }
      const blocked = options.autosave.modelTransitionIsBlockedByFailedPrerequisite(operationId);
      const restore = (current: Workbook) => {
        const documents = { ...before.documents };
        for (const [id, sheet] of Object.entries(documents)) {
          const latest = current.documents[id];
          if (latest) documents[id] = { ...sheet, revision: latest.revision };
        }
        const restored = { ...before, documents };
        return restored;
      };
      const beforeRollback = options.current.current;
      const restored = restore(beforeRollback);
      options.setWorkbook(restored, { kind: 'structure' });
      publication?.(beforeRollback, restored, 'rollback');
      if (entry.status === 'blocked') {
        // Never dispatched, so definitely not committed; the captured snapshot
        // would be stale once the predecessor recovers. Discard as before.
        options.autosave.discard(operationId);
        return { ok: false, reason: blocked ? 'blocked-persistence-prerequisite' : 'persistence-failed' } as TransitionFailure;
      }
      const definite = entry.status === 'failed'
        && isDefiniteClientError(entry.failure);
      if (definite) {
        // A definite client rejection of the initial dispatch never committed; release as before.
        options.autosave.discard(operationId);
        return { ok: false, reason: blocked ? 'blocked-persistence-prerequisite' : 'persistence-failed' } as TransitionFailure;
      }
      recoveries.current.set(operationId, { onSuccess });
      return { ok: false, reason: blocked ? 'blocked-persistence-prerequisite' : 'persistence-failed' } as TransitionFailure;
    }).finally(() => {
      pending.current = undefined;
      release();
    });
  }
  return { hasPending, wait, submit };
}

// 408 may be generated by an intermediary after the server committed, so it
// stays ambiguous like a lost response; explicit 400/409 are application rejections.
function isDefiniteClientError(failure: unknown): boolean {
  return failure instanceof WorkbookApiError
    && failure.status !== undefined
    && failure.status >= 400
    && failure.status < 500
    && failure.status !== 408;
}
