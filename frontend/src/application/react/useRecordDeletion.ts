import { useRef, useState } from 'react';
import { RecordDeletionOwner } from '@application/core/recordDeletionOwner';
import { recoverRecordReplay } from '@infrastructure/persistence/recoverRecordReplay';
import { recordReplayErrorMessage } from '@infrastructure/persistence/recordReplayError';
import type { Workbook } from '@workbook/core/model';
import type { LifecyclePublication, WorkbookCommands } from './workbookControllerTypes';

type Options = Parameters<RecordDeletionOwner['start']>[2];
type Receipt = Awaited<ReturnType<RecordDeletionOwner['start']>>;

export function useRecordDeletion(options: {
  capture: Omit<Options, 'recover' | 'waitForPredecessors'> & { coordinator: Parameters<typeof recoverRecordReplay>[1] };
  run: (execute: () => Promise<Receipt>) => Promise<Receipt>;
  confirmed: (sheetId: string, rowId: string, deletionId: string) => void;
  otherOwnerBlocked: () => boolean;
}) {
  const owner = useRef<RecordDeletionOwner | undefined>(undefined);
  owner.current ??= new RecordDeletionOwner();
  const pending = useRef(false);
  const retained = useRef<{ sheetId: string; rowId: string; before: Workbook; publication?: LifecyclePublication } | undefined>(undefined);
  const [state, setState] = useState<Readonly<{ pending: boolean; unresolved: boolean; error?: string }>>({ pending: false, unresolved: false });
  const blocked = () => pending.current || owner.current!.unresolved;

  function execute(): ReturnType<WorkbookCommands['deleteRow']>['completion'] {
    const context = retained.current!;
    pending.current = true;
    setState({ pending: true, unresolved: owner.current!.unresolved });
    const capture: Options = {
      ...options.capture, waitForPredecessors: async () => {},
      recover: (error, refresh) => recoverRecordReplay(error, options.capture.coordinator, refresh),
    };
    return options.run(() => owner.current!.unresolved
      ? owner.current!.confirmRetained(capture)
      : owner.current!.start(context.sheetId, context.rowId, capture)).then((receipt) => {
      options.confirmed(context.sheetId, context.rowId, receipt.deletionId);
      // Lifecycle's forward phase is used only after authoritative deletion adoption.
      context.publication?.(context.before, receipt.workbook, 'optimistic');
      return { ok: true as const, value: receipt.workbook };
    }, (error: unknown) => {
      setState({ pending: false, unresolved: owner.current!.unresolved, error: recordReplayErrorMessage(error) });
      return { ok: false as const, reason: 'persistence-failed' as const };
    }).finally(() => {
      pending.current = false;
      if (!owner.current!.unresolved) retained.current = undefined;
      setState((current) => ({ ...current, pending: false, unresolved: owner.current!.unresolved }));
    });
  }

  function canConfirm(sheetId?: string, rowId?: string) {
    const context = retained.current;
    return !pending.current && owner.current!.unresolved && !options.otherOwnerBlocked() &&
      (!sheetId || (context?.sheetId === sheetId && context.rowId === rowId));
  }

  return {
    state, blocked, canConfirm,
    start: (sheetId: string, rowId: string, before: Workbook, publication?: LifecyclePublication) => {
      retained.current = { sheetId, rowId, before, publication };
      setState({ pending: true, unresolved: false });
      return execute();
    },
    confirm: execute,
    confirmRetained: () => { if (canConfirm()) void execute(); },
  };
}
