import { useCallback, useEffect, useRef } from 'react';
import type { CellSelection } from '@grid/cellInteractionContracts';
import { useNavigationHistory } from '@reference-navigation/useNavigationHistory';
import type { WorkspaceViewport } from '@workspace/workspaceContracts';

export function useWorkspaceNavigationHistory({ onRestoreSelection, onUnavailableTarget, restoreViewport, selection, viewport }: {
  onRestoreSelection: (selection: CellSelection | null) => boolean;
  onUnavailableTarget: () => void;
  restoreViewport: (viewport: WorkspaceViewport) => void;
  selection: CellSelection | null;
  viewport: WorkspaceViewport;
}) {
  const scrollContainers = useRef(new Map<string, HTMLElement>());
  const pendingScroll = useRef(new Map<string, { left: number; top: number }>());
  const pendingScrollFrames = useRef(new Map<string, number>());
  const restoredScroll = useRef(new Map<string, { left: number; top: number }>());
  const cancelPendingScroll = useCallback(() => {
    pendingScrollFrames.current.forEach((frame) => window.cancelAnimationFrame(frame));
    pendingScrollFrames.current.clear();
    pendingScroll.current.clear();
    restoredScroll.current.clear();
  }, []);
  const applyPendingScroll = useCallback((sheetId: string) => {
    const offset = pendingScroll.current.get(sheetId);
    const element = scrollContainers.current.get(sheetId);
    if (!offset || !element) return;
    const left = Math.min(Math.max(0, offset.left), Math.max(0, element.scrollWidth - element.clientWidth));
    const top = Math.min(Math.max(0, offset.top), Math.max(0, element.scrollHeight - element.clientHeight));
    // Native scroll notifications do not identify script-originated scrolling.
    // Keep the actual clamped value so a queued notification cannot become a
    // settled user destination after the restore operation completes.
    restoredScroll.current.set(sheetId, { left, top });
    element.scrollLeft = left;
    element.scrollTop = top;
    pendingScroll.current.delete(sheetId);
  }, []);
  const applyPendingScrollAfterGridEffects = useCallback((sheetId: string) => {
    const previousFrame = pendingScrollFrames.current.get(sheetId);
    if (previousFrame !== undefined) window.cancelAnimationFrame(previousFrame);
    const frame = window.requestAnimationFrame(() => {
      pendingScrollFrames.current.delete(sheetId);
      applyPendingScroll(sheetId);
    });
    pendingScrollFrames.current.set(sheetId, frame);
  }, [applyPendingScroll]);
  useEffect(() => cancelPendingScroll, [cancelPendingScroll]);
  const registerScrollContainer = useCallback((sheetId: string, element: HTMLElement | null) => {
    if (!element) {
      scrollContainers.current.delete(sheetId);
      return;
    }
    scrollContainers.current.set(sheetId, element);
    // SheetGrid reveals an active selection from an effect after mounting. Apply
    // history scroll after that effect so selection restoration cannot replace it.
    if (pendingScroll.current.has(sheetId)) applyPendingScrollAfterGridEffects(sheetId);
  }, [applyPendingScrollAfterGridEffects]);
  const capture = useCallback(() => ({
    viewport,
    selection,
    scroll: Object.fromEntries([...scrollContainers.current].map(([sheetId, element]) => [sheetId, {
      left: element.scrollLeft, top: element.scrollTop,
    }])),
  }), [selection, viewport]);
  const restore = useCallback((context: ReturnType<typeof capture>, complete: () => void) => {
    cancelPendingScroll();
    restoreViewport(context.viewport);
    if (!onRestoreSelection(context.selection) && context.selection) onUnavailableTarget();
    Object.entries(context.scroll).forEach(([sheetId, offset]) => pendingScroll.current.set(sheetId, offset));
    const sheetIds = Object.keys(context.scroll);
    sheetIds.forEach(applyPendingScrollAfterGridEffects);
    // Completion follows the post-layout scroll pass, rather than an arbitrary
    // timeout. Late native events remain provenance-filtered above.
    if (sheetIds.length === 0) complete();
    else window.requestAnimationFrame(complete);
  }, [applyPendingScrollAfterGridEffects, cancelPendingScroll, onRestoreSelection, onUnavailableTarget, restoreViewport]);
  const history = useNavigationHistory({ capture, restore });
  // This callback deliberately closes over the stable hook rule only after it
  // is created; useCallback's body reads the current render's history below.
  const recordGridScroll = useCallback((sheetId: string) => {
    const restored = restoredScroll.current.get(sheetId);
    const element = scrollContainers.current.get(sheetId);
    if (restored && element && element.scrollLeft === restored.left && element.scrollTop === restored.top) {
      restoredScroll.current.delete(sheetId);
      return;
    }
    cancelPendingScroll();
    restoredScroll.current.delete(sheetId);
    history.recordUserMovement();
  }, [cancelPendingScroll, history]);
  const navigationHistory = {
    ...history,
    explicitNavigation: (navigate: () => void) => {
      cancelPendingScroll();
      history.explicitNavigation(navigate);
    },
    traverse: (direction: 'back' | 'forward') => {
      cancelPendingScroll();
      return history.traverse(direction);
    },
  };
  return { history: navigationHistory, registerScrollContainer, recordGridScroll };
}
