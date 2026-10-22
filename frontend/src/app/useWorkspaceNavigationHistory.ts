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
  const pendingScroll = useRef(new Map<string, { generation: number; left: number; top: number }>());
  const restoreGeneration = useRef(0);
  const activeRestore = useRef<{ generation: number; complete: () => void; cancelViewport: () => void; viewportSettled: boolean; requiredGridSettled: boolean; requiredSheetId?: string }>();
  const finishRestoreIfSettled = useCallback(() => {
    const restoring = activeRestore.current;
    if (!restoring || !restoring.viewportSettled || (restoring.requiredSheetId && !restoring.requiredGridSettled)) return;
    activeRestore.current = undefined;
    restoring.complete();
  }, []);
  const cancelPendingScroll = useCallback(() => {
    pendingScroll.current.clear();
  }, []);
  const cancelRestore = useCallback(() => {
    restoreGeneration.current += 1;
    activeRestore.current?.cancelViewport();
    activeRestore.current = undefined;
    cancelPendingScroll();
  }, [cancelPendingScroll]);
  const acknowledgeGridRestore = useCallback((sheetId: string, generation: number) => {
    const offset = pendingScroll.current.get(sheetId);
    if (!offset || offset.generation !== generation) return;
    pendingScroll.current.delete(sheetId);
    const restoring = activeRestore.current;
    if (restoring?.generation === generation && restoring.requiredSheetId === sheetId && !restoring.requiredGridSettled) {
      restoring.requiredGridSettled = true;
      finishRestoreIfSettled();
    }
  }, [finishRestoreIfSettled]);
  useEffect(() => cancelRestore, [cancelRestore]);
  const registerScrollContainer = useCallback((sheetId: string, element: HTMLElement | null) => {
    if (!element) {
      scrollContainers.current.delete(sheetId);
      return;
    }
    scrollContainers.current.set(sheetId, element);
  }, []);
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
    Object.entries(context.scroll).forEach(([sheetId, offset]) => pendingScroll.current.set(sheetId, { ...offset, generation }));
    finishRestoreIfSettled();
  }, [cancelRestore, finishRestoreIfSettled, onRestoreSelection, onUnavailableTarget, restoreViewport]);
  const history = useNavigationHistory({ capture, restore });
  const recordUserGridMovement = useCallback(() => {
    cancelRestore();
    history.recordUserMovement();
  }, [cancelRestore, history]);
  const navigationHistory = {
    ...history,
    explicitNavigation: (navigate: (settle: () => void) => void) => {
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
  const historyRestoreForSheet = useCallback((sheetId: string) => pendingScroll.current.get(sheetId), []);
  return { acknowledgeGridRestore, history: navigationHistory, historyRestoreForSheet, registerScrollContainer, recordUserGridMovement };
}
