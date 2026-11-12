import { useRef, useState } from 'react';
import { RecordReplayOwner } from '@application/core/recordReplayOwner';
import { replayEntryRecord } from '@application/core/replayEntryRecord';
import { recoverRecordReplay } from '@infrastructure/persistence/recoverRecordReplay';
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
  const [state, setState] = useState<Readonly<{ pending: boolean; error?: string }>>({ pending: false });
  function replay(transaction: ContentTransaction, direction: 'undo' | 'redo') {
    if (pending.current) return;
    pending.current = true;
    setState({ pending: true });
    void owner.current!.replay(transaction, direction, (operation) => options.run(() => transaction.localRecord ? Promise.resolve().then(() => options.replayLocal(transaction, direction)) : replayEntryRecord({
      ...options.replayOptions, operation, waitForPredecessors: async () => {},
      recover: (error, refresh) => recoverRecordReplay(error, options.coordinator, refresh),
    }))).then(() => {
      pending.current = false;
      setState({ pending: false });
      options.publishHistory();
    }, (error: unknown) => {
      pending.current = false;
      setState({ pending: false, error: error instanceof Error ? error.message : 'Record replay failed.' });
    });
  }
  return { state, replay };
}
