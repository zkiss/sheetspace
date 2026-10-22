import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { appendNavigationContext, EMPTY_NAVIGATION_HISTORY, traverseNavigationHistory, type NavigationContext } from './navigationHistory';

const SETTLE_MS = 2_000;

export function useNavigationHistory({ capture, restore }: {
  capture: () => NavigationContext;
  restore: (context: NavigationContext) => void;
}) {
  const history = useRef(EMPTY_NAVIGATION_HISTORY);
  const [revision, setRevision] = useState(0);
  const timer = useRef<number>();
  const restoring = useRef(false);
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
  const recordMovement = useCallback(() => {
    if (restoring.current) return;
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      commit();
    }, SETTLE_MS);
  }, [commit]);
  const explicitNavigation = useCallback((navigate: () => void) => {
    flushMovement();
    commit();
    navigate();
    // Selection and virtual grid scroll updates are applied by React after the jump.
    window.setTimeout(commit, 0);
  }, [commit, flushMovement]);
  const traverse = useCallback((direction: 'back' | 'forward') => {
    flushMovement();
    const next = traverseNavigationHistory(history.current, direction);
    if (!next) return false;
    history.current = next.history;
    restoring.current = true;
    restore(next.context);
    window.setTimeout(() => { restoring.current = false; }, 0);
    setRevision((current) => current + 1);
    return true;
  }, [flushMovement, restore]);
  useEffect(() => () => { if (timer.current !== undefined) window.clearTimeout(timer.current); }, []);
  return {
    canGoBack: history.current.cursor > 0,
    canGoForward: history.current.cursor >= 0 && history.current.cursor < history.current.entries.length - 1,
    explicitNavigation,
    recordMovement,
    revision,
    traverse,
  };
}
