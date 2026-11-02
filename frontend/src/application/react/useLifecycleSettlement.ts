import { useRef } from 'react';
import type { Workbook } from '@workbook/core/model';
import type { SetWorkbook } from '@calculation/workbookCalculation';
import type { useSavedSheetAutosave } from './useSavedSheetAutosave';
import type { TransitionFailure } from './workbookControllerTypes';

export function useLifecycleSettlement(options: {
  autosaveEnabled: boolean;
  current: React.MutableRefObject<Workbook>;
  setWorkbook: SetWorkbook;
  autosave: ReturnType<typeof useSavedSheetAutosave>;
  resetHistory: () => void;
}) {
  const pending = useRef<Promise<void> | undefined>(undefined);
  const hasPending = () => Boolean(pending.current) || options.autosave.hasModelTransition();
  const wait = () => {
    const local = pending.current;
    const transport = options.autosave.waitForModelTransitions();
    if (!local) return transport;
    return transport ? Promise.all([local, transport]).then(() => undefined) : local;
  };
  function submit<T extends { ok: true; value: Workbook }>(before: Workbook, result: T, onSuccess = options.resetHistory): Promise<T | TransitionFailure> {
    let release!: () => void;
    pending.current = new Promise<void>((resolve) => { release = resolve; });
    options.current.current = result.value;
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
      options.current.current = restore(options.current.current);
      options.setWorkbook((current) => {
        const restored = restore(current);
        options.current.current = restored;
        return restored;
      }, { kind: 'structure' });
      options.autosave.discard(operationId);
      return { ok: false, reason: blocked ? 'blocked-persistence-prerequisite' : 'persistence-failed' } as TransitionFailure;
    }).finally(() => {
      pending.current = undefined;
      release();
    });
  }
  return { hasPending, wait, submit };
}
