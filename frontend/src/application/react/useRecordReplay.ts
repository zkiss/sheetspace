import { useRef, useState } from 'react';
import { RecordReplayOwner } from '@application/core/recordReplayOwner';
import { replayEntryRecord } from '@application/core/replayEntryRecord';
import { recoverRecordReplay } from '@infrastructure/persistence/recoverRecordReplay';
import { recordReplayErrorMessage } from '@infrastructure/persistence/recordReplayError';
import type { ContentHistory, ContentTransaction } from '@application/core/contentHistory';

type ReplayOptions = Parameters<typeof replayEntryRecord>[0];

export function useRecordReplay(options: {
  history: ContentHistory;
  run: (execute: () => Promise<unknown>) => Promise<unknown>;
  replayOptions: Omit<ReplayOptions, 'operation' | 'waitForPredecessors' | 'recover'>;
  coordinator: Parameters<typeof recoverRecordReplay>[1];
  publishHistory: () => void;
  replayLocal: (transaction: ContentTransaction, direction: 'undo' | 'redo') => void;
}) {
  const owner = useRef<RecordReplayOwner | undefined>(undefined);
  owner.current ??= new RecordReplayOwner(options.history);
  const pending = useRef(false);
  const [state, setState] = useState<Readonly<{ pending: boolean; unresolved: boolean; error?: string }>>({ pending: false, unresolved: false });
  const executePersisted = (operation: Parameters<typeof replayEntryRecord>[0]['operation']) => options.run(() => replayEntryRecord({
    ...options.replayOptions, operation, waitForPredecessors: async () => {},
    recover: (error, refresh) => recoverRecordReplay(error, options.coordinator, refresh),
  }));
  function run(action: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true;
    setState({ pending: true, unresolved: owner.current!.unresolved });
    void action().then(() => {
      pending.current = false;
      setState({ pending: false, unresolved: owner.current!.unresolved });
      options.publishHistory();
    }, (error: unknown) => {
      pending.current = false;
      setState({ pending: false, unresolved: owner.current!.unresolved, error: recordReplayErrorMessage(error) });
      options.publishHistory();
    });
  }
  function replay(transaction: ContentTransaction, direction: 'undo' | 'redo') {
    run(() => owner.current!.replay(transaction, direction, (operation) => transaction.localRecord
      ? options.run(() => Promise.resolve().then(() => options.replayLocal(transaction, direction)))
      : executePersisted(operation)));
  }
  return { state, blocked: () => pending.current || owner.current!.unresolved, replay, confirmRetained: () => run(() => owner.current!.confirmRetained(executePersisted)) };
}
