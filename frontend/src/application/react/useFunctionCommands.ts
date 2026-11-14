import { useRef, useState } from 'react';
import { FunctionCommandOwner } from '@application/core/functionCommandOwner';
import { deleteFunction, setFunction, type FunctionDeclaration } from '@application/core/functionCommands';
import type { Workbook } from '@workbook/core/model';
import type { FunctionSubmission } from './workbookControllerTypes';

type Options = Parameters<FunctionCommandOwner['retry']>[0];
type Intent = Parameters<FunctionCommandOwner['start']>[0];
export function useFunctionCommands(options: {
  autosaveEnabled: boolean;
  capture: Options;
  run: (execute: () => Promise<Workbook>) => Promise<Workbook>;
  blockedByOther: () => boolean;
  retryBlockedByOther: () => boolean;
}) {
  const owner = useRef<FunctionCommandOwner | undefined>(undefined);
  owner.current ??= new FunctionCommandOwner();
  const pending = useRef(false);
  const [state, setState] = useState<{ pending: boolean; unresolved: boolean; error?: string }>({ pending: false, unresolved: false });
  const blocked = () => pending.current || owner.current!.unresolved;
  function execute(intent?: Intent): FunctionSubmission['completion'] {
    if (intent) owner.current!.reserve(intent);
    pending.current = true;
    setState({ pending: true, unresolved: owner.current!.unresolved });
    return options.run(() => owner.current!.retry(options.capture)).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => {
        owner.current!.fail();
        setState({ pending: false, unresolved: owner.current!.unresolved, error: error instanceof Error ? error.message : 'Function save failed.' });
        return { ok: false as const, reason: 'persistence-failed' as const };
      },
    ).finally(() => { pending.current = false; setState((current) => ({ ...current, pending: false, unresolved: owner.current!.unresolved })); });
  }
  function submit(intent: Intent): FunctionSubmission {
    const rejected = { ok: false as const, reason: 'pending-model-transition' as const };
    if (blocked() || options.blockedByOther()) return { result: rejected, completion: Promise.resolve(rejected) };
    const current = options.capture.currentWorkbook();
    const result = intent.kind === 'set' ? setFunction(current, intent.declaration, intent.previousName) : deleteFunction(current, intent.name);
    if (!result.ok) return { result, completion: Promise.resolve(result) };
    if (!options.autosaveEnabled) {
      options.capture.reconcile(result.value);
      return { result, completion: Promise.resolve(result) };
    }
    return { result, completion: execute(intent) };
  }
  return {
    state, blocked,
    set: (declaration: FunctionDeclaration, previousName?: string) => submit({ kind: 'set', declaration, previousName }),
    delete: (name: string) => submit({ kind: 'delete', name }),
    retry: () => {
      if (pending.current) return;
      if (owner.current!.unresolved) { if (!options.retryBlockedByOther()) void execute(); }
      else setState((current) => ({ ...current, error: undefined }));
    },
  };
}
