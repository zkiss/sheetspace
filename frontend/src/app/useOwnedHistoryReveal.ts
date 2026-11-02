import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  operation?: NavigationOperation;
  retired: boolean;
  dispatched: boolean;
  settled: boolean;
  consumed: Set<string>;
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
      retired: false, dispatched: false, settled: false, consumed: new Set() });
  }
  const latest = useRef(inputs);
  latest.current = inputs;
  const active = useRef<Delivery>();
  const retire = (record: Delivery) => {
    if (record.retired) return;
    record.retired = true;
    const cancel = record.cancel;
    record.cancel = undefined;
    record.operation?.cancel();
    cancel?.();
    refresh((revision) => revision + 1);
  };
  const live = (record: Delivery) => active.current === record && !record.retired && Boolean(record.operation?.isCurrent());
  const targetExists = (record: Delivery) => {
    const sheet = latest.current.sheets.find((sheet) => sheet.id === record.sheetId);
    const cell = record.feedback.after.find((cell) => cell.sheetId === record.sheetId);
    return Boolean(sheet && cell && cellAddressOf(sheet.content, cell));
  };
  useLayoutEffect(() => {
    if (!delivery) return;
    active.current = delivery;
    // Admission precedes child passive effects. Staged delivery remains closed
    // until transport settlement; canvas may reveal before outer dispatch.
    latest.current.acquire((operation) => { delivery.operation = operation; }, () => {
      if (active.current === delivery) retire(delivery);
    });
    return () => {
      active.current = undefined;
      const cancel = delivery.cancel;
      const operation = delivery.operation;
      delivery.cancel = undefined;
      delivery.operation = undefined;
      delivery.dispatched = false;
      delivery.settled = false;
      operation?.cancel();
      cancel?.();
    };
  }, [delivery]);
  useEffect(() => {
    if (!delivery || !live(delivery)) return;
    if (!targetExists(delivery)) { retire(delivery); return; }
    if (delivery.dispatched || inputs.editing) return;
    const destination = resolveHistoryRevealDestination(delivery.feedback, inputs.sheets, inputs.creatingAxes, inputs.controller);
    if (!destination) return;
    delivery.dispatched = true;
    const cancel = inputs.reveal(destination, {
      onSettled: () => {
        if (!live(delivery)) return;
        delivery.settled = true;
        delivery.cancel = undefined;
        if (delivery.consumed.has(destination.sheetId)) delivery.operation?.complete();
        refresh((revision) => revision + 1);
      },
      onFailure: () => { if (live(delivery) && !delivery.settled) retire(delivery); },
    });
    if (live(delivery) && !delivery.settled) delivery.cancel = cancel;
    else if (delivery.retired) cancel();
  });
  const canReveal = (sheetId: string, identity: string) => Boolean(delivery && live(delivery)
    && targetExists(delivery)
    && delivery.feedback.identity === identity && !delivery.consumed.has(sheetId)
    && !latest.current.editing && (!delivery.staged || (delivery.dispatched && delivery.settled && sheetId === delivery.sheetId)));
  return {
    feedback: delivery && !delivery.retired ? delivery.feedback : undefined,
    pendingSheetId: delivery && !delivery.retired && !delivery.consumed.has(delivery.sheetId ?? '') ? delivery.sheetId : undefined,
    pending: Boolean(delivery && !delivery.retired && !delivery.consumed.has(delivery.sheetId ?? '')),
    ready: Boolean(delivery && !delivery.retired && (!delivery.staged || delivery.settled)),
    canReveal,
    consume: (sheetId: string, identity: string) => {
      if (!delivery || !canReveal(sheetId, identity)) return;
      delivery.consumed.add(sheetId);
      if (delivery.settled && sheetId === delivery.sheetId) delivery.operation?.complete();
      refresh((revision) => revision + 1);
    },
  };
}
