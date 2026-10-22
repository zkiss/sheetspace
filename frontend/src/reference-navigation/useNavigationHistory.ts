import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { appendNavigationContext, EMPTY_NAVIGATION_HISTORY, traverseNavigationHistory, type NavigationContext } from './navigationHistory';

const SETTLE_MS = 2_000;

export type NavigationOperation = (() => void) & { generation: number; complete: () => void };

export function useNavigationHistory({ capture, restore }: {
  capture: () => NavigationContext;
  restore: (context: NavigationContext, operation: NavigationOperation) => void;
}) {
  const history = useRef(EMPTY_NAVIGATION_HISTORY);
  const [revision, setRevision] = useState(0);
  const timer = useRef<number>();
  const nextOperation = useRef(0);
  const activeOperation = useRef<number>();
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
    activeOperation.current = undefined;
    scheduleMovement();
  }, [scheduleMovement]);
  const explicitNavigation = useCallback((navigate: (operation: NavigationOperation) => void) => {
    const generation = ++nextOperation.current;
    activeOperation.current = generation;
    flushMovement();
    commit();
    const complete = () => {
      // A newer jump or traversal owns the current context. Its predecessor
      // must not append an arrival or release the newer operation's guard.
      if (activeOperation.current !== generation) return;
      commit();
      activeOperation.current = undefined;
    };
    const operation = Object.assign(complete, { generation, complete });
    navigate(operation);
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
    const generation = ++nextOperation.current;
    activeOperation.current = generation;
    const complete = () => {
      // An old rAF or React commit must never release suppression for a newer
      // traversal. Completion is owned by the restore adapter, not a timer.
      if (activeOperation.current === generation) activeOperation.current = undefined;
    };
    restore(next.context, Object.assign(complete, { generation, complete }));
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
