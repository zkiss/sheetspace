import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ContentHistoryFeedback } from '@application/react/useWorkbookController';
import type { CreatingGridAxes } from '@application/core/gridAxisCreationState';
import type { SheetDocument } from '@workbook/core/model';
import { cellAddressOf } from '@workbook/core/cellIdentity';
import type { NavigationOperation } from '@reference-navigation/useNavigationHistory';
import { resolveHistoryRevealDestination, type HistoryRevealController, type RevealDestination } from './useWorkspaceHistoryReveal';

type Delivery = {
  feedback: ContentHistoryFeedback;
  staged: boolean;
  sheetId?: string;
  retired: boolean;
  completed: boolean;
  consumed: Set<string>;
};
type Attempt = {
  delivery: Delivery;
  operation?: NavigationOperation;
  closed: boolean;
  dispatched: boolean;
  settled: boolean;
  cancel?: () => void;
};
type Inputs = {
  feedback?: ContentHistoryFeedback;
  editing: boolean;
  sheets: readonly SheetDocument[];
  creatingAxes: Readonly<Record<string, CreatingGridAxes>>;
  controller: HistoryRevealController;
  stageDestination: () => boolean;
  acquire: (start: (operation: NavigationOperation) => void, retire: () => void) => void;
  reveal: (destination: RevealDestination, callbacks: { onSettled: () => void; onFailure: () => void }) => () => void;
};

export function useOwnedHistoryReveal(inputs: Inputs) {
  const [delivery, setDelivery] = useState<Delivery>();
  const [, refresh] = useState(0);
  if (inputs.feedback && inputs.feedback.identity !== delivery?.feedback.identity) {
    setDelivery({ feedback: inputs.feedback, staged: inputs.stageDestination(),
      sheetId: inputs.sheets.find((sheet) => inputs.feedback!.after.some((cell) => cell.sheetId === sheet.id))?.id,
      retired: false, completed: false, consumed: new Set() });
  }
  const latest = useRef(inputs);
  latest.current = inputs;
  const active = useRef<Attempt>();
  const release = useCallback((attempt: Attempt) => {
    if (attempt.closed) return;
    attempt.closed = true;
    if (active.current === attempt) active.current = undefined;
    const cancel = attempt.cancel;
    attempt.cancel = undefined;
    attempt.operation?.cancel();
    cancel?.();
    if (attempt.operation && !attempt.operation.isLatest()) attempt.delivery.retired = true;
  }, []);
  const retire = useCallback((attempt: Attempt) => {
    if (attempt.closed) return;
    attempt.delivery.retired = true;
    release(attempt);
    refresh((revision) => revision + 1);
  }, [release]);
  const live = useCallback((attempt: Attempt) => active.current === attempt && !attempt.closed
    && !attempt.delivery.retired && Boolean(attempt.operation?.isCurrent()), []);
  const targetExists = (record: Delivery) => {
    const sheet = latest.current.sheets.find((sheet) => sheet.id === record.sheetId);
    const cell = record.feedback.after.find((cell) => cell.sheetId === record.sheetId);
    return Boolean(sheet && cell && cellAddressOf(sheet.content, cell));
  };
  useLayoutEffect(() => {
    if (!delivery || delivery.retired || delivery.completed || active.current?.delivery === delivery) return;
    const previous = active.current;
    const attempt: Attempt = { delivery, closed: false, dispatched: false, settled: false };
    active.current = attempt;
    // Admission precedes child passive effects. Staged delivery remains closed
    // until transport settlement; canvas may reveal before outer dispatch.
    latest.current.acquire((operation) => { attempt.operation = operation; }, () => retire(attempt));
    if (previous) retire(previous);
    if (!live(attempt)) retire(attempt);
    else refresh((revision) => revision + 1);
  }, [delivery, live, retire]);
  // Replacement reserves shared ownership above; only lifecycle teardown releases
  // without permanently retiring logical work, allowing StrictMode replay.
  useLayoutEffect(() => () => { if (active.current) release(active.current); }, [release]);
  useEffect(() => {
    const attempt = active.current;
    if (!delivery || !attempt || attempt.delivery !== delivery || !live(attempt)) return;
    if (!targetExists(delivery)) { retire(attempt); return; }
    if (attempt.dispatched || inputs.editing) return;
    const destination = resolveHistoryRevealDestination(delivery.feedback, inputs.sheets, inputs.creatingAxes, inputs.controller);
    if (!destination) return;
    attempt.dispatched = true;
    const cancel = inputs.reveal(destination, {
      onSettled: () => {
        if (!live(attempt) || attempt.settled) return;
        attempt.settled = true;
        attempt.cancel = undefined;
        if (delivery.consumed.has(destination.sheetId)) {
          delivery.completed = true;
          attempt.operation?.complete();
        }
        refresh((revision) => revision + 1);
      },
      onFailure: () => { if (live(attempt) && !attempt.settled) retire(attempt); },
    });
    if (live(attempt) && !attempt.settled) attempt.cancel = cancel;
    else if (!attempt.settled) cancel();
  });
  const attempt = active.current;
  const canReveal = (sheetId: string, identity: string) => Boolean(delivery && attempt && attempt.delivery === delivery && live(attempt)
    && targetExists(delivery)
    && delivery.feedback.identity === identity && !delivery.consumed.has(sheetId)
    && !latest.current.editing && (!delivery.staged || (attempt.dispatched && attempt.settled && sheetId === delivery.sheetId)));
  return {
    feedback: delivery && !delivery.retired ? delivery.feedback : undefined,
    pendingSheetId: delivery && !delivery.retired && !delivery.consumed.has(delivery.sheetId ?? '') ? delivery.sheetId : undefined,
    pending: Boolean(delivery && !delivery.retired && !delivery.consumed.has(delivery.sheetId ?? '')),
    ready: Boolean(delivery && !delivery.retired && (!delivery.staged || (attempt?.delivery === delivery && attempt.settled))),
    canReveal,
    consume: (sheetId: string, identity: string) => {
      if (!delivery || !canReveal(sheetId, identity)) return;
      delivery.consumed.add(sheetId);
      if (attempt?.settled && sheetId === delivery.sheetId) {
        delivery.completed = true;
        attempt.operation?.complete();
      }
      refresh((revision) => revision + 1);
    },
  };
}
