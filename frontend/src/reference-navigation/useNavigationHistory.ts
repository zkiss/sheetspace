import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { appendNavigationContext, EMPTY_NAVIGATION_HISTORY, traverseNavigationHistory, type NavigationContext } from './navigationHistory';

const SETTLE_MS = 2_000;

export function useNavigationHistory({ capture, restore }: {
  capture: () => NavigationContext;
  restore: (context: NavigationContext, complete: () => void) => void;
}) {
  const history = useRef(EMPTY_NAVIGATION_HISTORY);
  const [revision, setRevision] = useState(0);
  const timer = useRef<number>();
  const restoration = useRef(0);
  const captureRef = useRef(capture);
  captureRef.current = capture;
  const commit = useCallback(() => {
    // A jump schedules state changes in its caller. Read the capture function
    // from the committed render rather than retaining the departure render.
    history.current = appendNavigationContext(history.current, captureRef.current());
    setRevision((current) => current + 1);
  }, []);
  // The initial viewing context must remain reachable after the first pan.
  useLayoutEffect(() => {
    if (history.current.entries.length !== 0) return;
    history.current = appendNavigationContext(history.current, captureRef.current());
    setRevision((current) => current + 1);
  }, []);
  const flushMovement = useCallback(() => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
      commit();
    }
  }, [commit]);
  const scheduleMovement = useCallback(() => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      commit();
    }, SETTLE_MS);
  }, [commit]);
  const recordUserMovement = useCallback(() => {
    // Grid scroll has already changed by the time its native event arrives;
    // cancel any incomplete restore before starting its settled destination.
    // Invalidate the operation before releasing movement recording. A cancelled
    // restore must not keep suppressing every later ordinary pan or zoom.
    if (restoration.current !== 0) restoration.current += 1;
    restoration.current = 0;
    scheduleMovement();
  }, [scheduleMovement]);
  const explicitNavigation = useCallback((navigate: (settle: () => void) => void) => {
    const operation = restoration.current + 1;
    restoration.current = operation;
    flushMovement();
    commit();
    navigate(() => {
      // A newer jump or traversal owns the current context. Its predecessor
      // must not append an arrival or release the newer operation's guard.
      if (restoration.current !== operation) return;
      commit();
      restoration.current = 0;
    });
  }, [commit, flushMovement]);
  const traverse = useCallback((direction: 'back' | 'forward') => {
    flushMovement();
    if (!traverseNavigationHistory(history.current, direction)) return false;
    // Selection changes alone are not destinations, but the context being left
    // must still be current when Forward returns to it.
    const entries = [...history.current.entries];
    entries[history.current.cursor] = captureRef.current();
    history.current = { ...history.current, entries };
    const next = traverseNavigationHistory(history.current, direction);
    if (!next) return false;
    history.current = next.history;
    const operation = restoration.current + 1;
    restoration.current = operation;
    restore(next.context, () => {
      // An old rAF or React commit must never release suppression for a newer
      // traversal. Completion is owned by the restore adapter, not a timer.
      if (restoration.current === operation) restoration.current = 0;
    });
    setRevision((current) => current + 1);
    return true;
  }, [flushMovement, restore]);
  useEffect(() => () => { if (timer.current !== undefined) window.clearTimeout(timer.current); }, []);
  return {
    canGoBack: history.current.cursor > 0,
    canGoForward: history.current.cursor >= 0 && history.current.cursor < history.current.entries.length - 1,
    explicitNavigation,
    recordUserMovement,
    revision,
    traverse,
  };
}
