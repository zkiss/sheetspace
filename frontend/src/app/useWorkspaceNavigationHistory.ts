import { useCallback, useEffect, useRef } from 'react';
import type { CellSelection } from '@grid/cellInteractionContracts';
import { useNavigationHistory } from '@reference-navigation/useNavigationHistory';
import type { WorkspaceViewport } from '@workspace/workspaceContracts';

export function useWorkspaceNavigationHistory({ onRestoreSelection, onUnavailableTarget, restoreViewport, selection, viewport }: {
  onRestoreSelection: (selection: CellSelection | null) => boolean;
  onUnavailableTarget: () => void;
  restoreViewport: (viewport: WorkspaceViewport, onSettled: () => void) => () => void;
  selection: CellSelection | null;
  viewport: WorkspaceViewport;
}) {
  const scrollContainers = useRef(new Map<string, HTMLElement>());
  const pendingScroll = useRef(new Map<string, { left: number; top: number }>());
  const pendingScrollFrames = useRef(new Map<string, number>());
  const restoreGeneration = useRef(0);
  const activeRestore = useRef<{ generation: number; complete: () => void; cancelViewport: () => void; viewportSettled: boolean; requiredGridSettled: boolean; requiredSheetId?: string }>();
  const finishRestoreIfSettled = useCallback(() => {
    const restoring = activeRestore.current;
    if (!restoring || !restoring.viewportSettled || (restoring.requiredSheetId && !restoring.requiredGridSettled)) return;
    activeRestore.current = undefined;
    restoring.complete();
  }, []);
  const cancelPendingScroll = useCallback(() => {
    pendingScrollFrames.current.forEach((frame) => window.cancelAnimationFrame(frame));
    pendingScrollFrames.current.clear();
    pendingScroll.current.clear();
  }, []);
  const cancelRestore = useCallback(() => {
    restoreGeneration.current += 1;
    activeRestore.current?.cancelViewport();
    activeRestore.current = undefined;
    cancelPendingScroll();
  }, [cancelPendingScroll]);
  const applyPendingScroll = useCallback((sheetId: string) => {
    const offset = pendingScroll.current.get(sheetId);
    const element = scrollContainers.current.get(sheetId);
    if (!offset || !element) return;
    const left = Math.min(Math.max(0, offset.left), Math.max(0, element.scrollWidth - element.clientWidth));
    const top = Math.min(Math.max(0, offset.top), Math.max(0, element.scrollHeight - element.clientHeight));
    element.scrollLeft = left;
    element.scrollTop = top;
    pendingScroll.current.delete(sheetId);
    const restoring = activeRestore.current;
    if (restoring?.requiredSheetId === sheetId && !restoring.requiredGridSettled) {
      restoring.requiredGridSettled = true;
      finishRestoreIfSettled();
    }
  }, [finishRestoreIfSettled]);
  const applyPendingScrollAfterGridEffects = useCallback((sheetId: string) => {
    const previousFrame = pendingScrollFrames.current.get(sheetId);
    if (previousFrame !== undefined) window.cancelAnimationFrame(previousFrame);
    const frame = window.requestAnimationFrame(() => {
      pendingScrollFrames.current.delete(sheetId);
      applyPendingScroll(sheetId);
    });
    pendingScrollFrames.current.set(sheetId, frame);
  }, [applyPendingScroll]);
  useEffect(() => cancelRestore, [cancelRestore]);
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
    cancelRestore();
    const generation = ++restoreGeneration.current;
    const requiredSheetId = context.selection?.anchor.sheetId;
    const requiredGridSheetId = requiredSheetId && context.scroll[requiredSheetId] ? requiredSheetId : undefined;
    const restoring = {
      generation, complete, cancelViewport: () => {}, viewportSettled: false, requiredGridSettled: false, requiredSheetId: requiredGridSheetId,
    };
    activeRestore.current = restoring;
    restoring.cancelViewport = restoreViewport(context.viewport, () => {
      if (activeRestore.current?.generation !== generation) return;
      activeRestore.current.viewportSettled = true;
      finishRestoreIfSettled();
    });
    if (!onRestoreSelection(context.selection) && context.selection) onUnavailableTarget();
    Object.entries(context.scroll).forEach(([sheetId, offset]) => pendingScroll.current.set(sheetId, offset));
    Object.keys(context.scroll).forEach(applyPendingScrollAfterGridEffects);
    finishRestoreIfSettled();
  }, [applyPendingScrollAfterGridEffects, cancelRestore, finishRestoreIfSettled, onRestoreSelection, onUnavailableTarget, restoreViewport]);
  const history = useNavigationHistory({ capture, restore });
  const recordUserGridMovement = useCallback(() => {
    cancelRestore();
    history.recordUserMovement();
  }, [cancelRestore, history]);
  const navigationHistory = {
    ...history,
    explicitNavigation: (navigate: () => void) => {
      cancelRestore();
      history.explicitNavigation(navigate);
    },
    recordUserMovement: () => {
      cancelRestore();
      history.recordUserMovement();
    },
    traverse: (direction: 'back' | 'forward') => {
      cancelRestore();
      return history.traverse(direction);
    },
  };
  return { history: navigationHistory, registerScrollContainer, recordUserGridMovement };
}
