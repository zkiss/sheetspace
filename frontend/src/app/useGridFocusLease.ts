import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CellTarget } from '@grid/cellInteractionContracts';
import type { CellFocusRequest } from '@grid/cellInteraction';
import { activeFocusRequestId, pinsFocusedFrame, reduceGridFocusLease, type GridFocusLease, type GridFocusLeaseAction } from './gridFocusLease';

type Options = {
  activeCell: CellTarget | null;
  keyboardFocusRequest: CellFocusRequest | null;
  onKeyboardFocusRequestCancelled: (requestId: number) => void;
  onKeyboardFocusRequestConsumed: (requestId: number) => void;
  onRestoreGridFocus: () => number | null;
  interactionPinnedSheetId?: string;
  sheetIds: readonly string[];
};

export function useGridFocusLease({
  activeCell, keyboardFocusRequest, onKeyboardFocusRequestCancelled,
  onKeyboardFocusRequestConsumed, onRestoreGridFocus, interactionPinnedSheetId, sheetIds,
}: Options) {
  const [gridFocusLease, setGridFocusLease] = useState<GridFocusLease | null>(null);
  const gridFocusLeaseRef = useRef<GridFocusLease | null>(null);
  const nextGridFocusToken = useRef(1);
  const dispatchGridFocusLease = useCallback((action: GridFocusLeaseAction) => {
    const next = reduceGridFocusLease(gridFocusLeaseRef.current, action);
    gridFocusLeaseRef.current = next;
    setGridFocusLease(next);
  }, []);
  const beginPendingGridFocus = useCallback((target: CellTarget) => {
    dispatchGridFocusLease({ type: 'await-detail', token: nextGridFocusToken.current++, target });
  }, [dispatchGridFocusLease]);
  const endGridFocusLease = useCallback(() => {
    const requestId = activeFocusRequestId(gridFocusLeaseRef.current);
    if (requestId !== null) {
      onKeyboardFocusRequestCancelled(requestId);
      dispatchGridFocusLease({ type: 'cancel-request', requestId });
    } else dispatchGridFocusLease({ type: 'external-focus' });
  }, [dispatchGridFocusLease, onKeyboardFocusRequestCancelled]);
  useEffect(() => {
    function handleFocusIn(event: FocusEvent) {
      const lease = gridFocusLeaseRef.current;
      const focusOwner = event.target;
      if (!lease?.sheetId || !(focusOwner instanceof Element)) return;
      if (focusOwner === document.body || focusOwner === document.documentElement) return;
      const frame = focusOwner.closest<HTMLElement>('article.sheet-frame[data-sheet-id]');
      if (frame?.dataset.sheetId !== lease.sheetId) endGridFocusLease();
    }
    document.addEventListener('focusin', handleFocusIn, true);
    return () => document.removeEventListener('focusin', handleFocusIn, true);
  }, [endGridFocusLease]);
  useLayoutEffect(() => {
    if (!keyboardFocusRequest) return;
    dispatchGridFocusLease({ type: 'adopt-request', token: nextGridFocusToken.current++, requestId: keyboardFocusRequest.id, target: keyboardFocusRequest.target });
  }, [dispatchGridFocusLease, keyboardFocusRequest]);
  useEffect(() => {
    const lease = gridFocusLeaseRef.current;
    if (lease && !sheetIds.includes(lease.sheetId)) endGridFocusLease();
  }, [endGridFocusLease, sheetIds]);
  const handleDetailedBodyAvailable = useCallback((sheetId: string) => {
    const lease = gridFocusLeaseRef.current;
    if (lease?.sheetId !== sheetId) return;
    if (lease.phase === 'consumed-awaiting-release') {
      dispatchGridFocusLease({ type: 'detailed-release', token: lease.token });
      return;
    }
    if (lease.phase !== 'awaiting-detail' || activeCell?.sheetId !== sheetId || interactionPinnedSheetId === sheetId) return;
    const requestId = onRestoreGridFocus();
    if (requestId === null) {
      dispatchGridFocusLease({ type: 'external-focus' });
      return;
    }
    dispatchGridFocusLease({ type: 'bind-request', token: lease.token, requestId, target: activeCell });
  }, [activeCell, dispatchGridFocusLease, interactionPinnedSheetId, onRestoreGridFocus]);
  const handleDetailedFocusDisplaced = useCallback((sheetId: string) => {
    const lease = gridFocusLeaseRef.current;
    const target = activeCell?.sheetId === sheetId ? activeCell : lease?.sheetId === sheetId ? lease.target : null;
    if (!target) return;
    dispatchGridFocusLease({ type: 'detail-displaced', observedToken: lease?.sheetId === sheetId ? lease.token : null, token: nextGridFocusToken.current++, target });
  }, [activeCell, dispatchGridFocusLease]);
  const handleDetailedNativeFocusReleased = useCallback((sheetId: string) => {
    const lease = gridFocusLeaseRef.current;
    if (lease?.sheetId === sheetId && lease.phase === 'native-owned') dispatchGridFocusLease({ type: 'native-blur', token: lease.token });
  }, [dispatchGridFocusLease]);
  const handleDetailedNativeFocus = useCallback((target: CellTarget) => {
    dispatchGridFocusLease({ type: 'native-focus', token: nextGridFocusToken.current++, target });
  }, [dispatchGridFocusLease]);
  const handleKeyboardFocusRequestConsumed = useCallback((requestId: number) => {
    dispatchGridFocusLease({ type: 'consume-request', requestId });
    onKeyboardFocusRequestConsumed(requestId);
  }, [dispatchGridFocusLease, onKeyboardFocusRequestConsumed]);
  return { beginPendingGridFocus, gridFocusLease, handleDetailedBodyAvailable, handleDetailedFocusDisplaced,
    handleDetailedNativeFocus, handleDetailedNativeFocusReleased, handleKeyboardFocusRequestConsumed, pinsFocusedFrame };
}
