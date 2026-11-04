import { useEffect, useRef } from 'react';
import type { SheetId, Workbook } from '@workbook/core/model';
import type { SetWorkbook } from '@calculation/workbookCalculation';
import type { OutboxSnapshot } from '@infrastructure/persistence/workbookOutbox';
import { WorkbookApiError } from '@infrastructure/persistence/workbookApi';
import type { useSavedSheetAutosave } from './useSavedSheetAutosave';
import type { TransitionFailure } from './workbookControllerTypes';

export type LifecyclePublication = (before: Workbook, after: Workbook, phase: 'optimistic' | 'rollback') => void;

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
  const recoveries = useRef(new Map<string, { after: Workbook; onSuccess: () => void }>());
  const { subscribeOutbox, revision, current } = options;
  const { setWorkbook } = options;

  useEffect(() => subscribeOutbox((snapshot) => {
    for (const [operationId, recovery] of recoveries.current) {
      const entry = snapshot.find((candidate) => candidate.operationId === operationId);
      if (entry?.status !== 'succeeded') continue;
      recoveries.current.delete(operationId);
      const restored = withCommittedRevisions(recovery.after, revision);
      current.current = restored;
      setWorkbook(restored, { kind: 'structure' });
      recovery.onSuccess();
    }
  }), [subscribeOutbox, revision, current, setWorkbook]);

  const hasPending = () => Boolean(pending.current) || options.autosave.hasModelTransition();
  const wait = () => {
    const local = pending.current;
    const transport = options.autosave.waitForModelTransitions();
    if (!local) return transport;
    return transport ? Promise.all([local, transport]).then(() => undefined) : local;
  };
  function submit<T extends { ok: true; value: Workbook }>(before: Workbook, result: T, onSuccess = options.resetHistory, publication?: LifecyclePublication): Promise<T | TransitionFailure> {
    let release!: () => void;
    pending.current = new Promise<void>((resolve) => { release = resolve; });
    options.current.current = result.value;
    publication?.(before, result.value, 'optimistic');
    options.setWorkbook(result.value, { kind: 'structure' });
    if (!options.autosaveEnabled) {
      onSuccess();
      pending.current = undefined;
      release();
      return Promise.resolve(result);
    }
    const operationId = crypto.randomUUID();
    options.autosave.enqueue(operationId, { kind: 'model-lifecycle', before, after: result.value });
    return options.autosave.waitFor(operationId).then((entry) => {
      if (entry.status === 'succeeded') {
        onSuccess();
        return result;
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
      options.current.current = restore(beforeRollback);
      publication?.(beforeRollback, options.current.current, 'rollback');
      options.setWorkbook((current) => {
        const restored = restore(current);
        options.current.current = restored;
        return restored;
      }, { kind: 'structure' });
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
      recoveries.current.set(operationId, { after: structuredClone(result.value), onSuccess });
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

function withCommittedRevisions(after: Workbook, revision: (sheetId: string) => number | undefined): Workbook {
  const documents = { ...after.documents };
  for (const [id, sheet] of Object.entries(documents)) {
    const committed = revision(id);
    documents[id] = committed === undefined ? sheet : { ...sheet, revision: committed };
  }
  return { ...after, documents };
}
