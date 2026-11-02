import { useCallback, useEffect, useRef, useState } from 'react';
import type { CellSelection } from '@grid/cellInteractionContracts';
import type { ReferenceNavigationTarget } from '@grid/cellInteractionContracts';
import { useNavigationHistory } from '@reference-navigation/useNavigationHistory';
import type { NavigationOperation } from '@reference-navigation/useNavigationHistory';
import type { WorkspaceViewport } from '@workspace/workspaceContracts';

export function useWorkspaceNavigationHistory({ onRestoreSelection, onUnavailableTarget, onHistoryTraversal, restoreViewport, restoreDestination, stageDestination = false, selection, viewport }: {
  onRestoreSelection: (selection: CellSelection | null) => boolean;
  onUnavailableTarget: () => void;
  onHistoryTraversal?: () => void;
  restoreViewport: (viewport: WorkspaceViewport, onSettled: () => void) => () => void;
  restoreDestination?: (sheetId: string, viewport: WorkspaceViewport, onSettled: () => void, onFailure: (reason: 'unavailable' | 'cancelled') => void) => () => void;
  stageDestination?: boolean;
  selection: CellSelection | null;
  viewport: WorkspaceViewport;
}) {
  const scrollContainers = useRef(new Map<string, HTMLElement>());
  const pendingScroll = useRef(new Map<string, { generation: number; left: number; top: number }>());
  const restoreGeneration = useRef(0);
  const [, setActiveNavigationGeneration] = useState<number | null>(null);
  const activeRestore = useRef<{ generation: number; complete: () => void; cancelViewport: () => void; viewportSettled: boolean; requiredGridSettled: boolean; requiredSheetId?: string; navigationTarget?: ReferenceNavigationTarget }>();
  const activateNavigationSelection = useCallback((sheetId: string | undefined) => {
    if (!sheetId) return;
    // A dialog or editor opened after the jump owns focus until the user leaves it.
    if (document.activeElement?.closest('[role="dialog"], [data-workspace-sheet-editor]')) return;
    const selectedCell = scrollContainers.current.get(sheetId)?.querySelector<HTMLElement>('[data-active-cell="true"]');
    selectedCell?.focus({ preventScroll: true });
  }, []);
  const finishRestoreIfSettled = useCallback(() => {
    const restoring = activeRestore.current;
    if (!restoring || !restoring.viewportSettled || (restoring.requiredSheetId && !restoring.requiredGridSettled)) return;
    activeRestore.current = undefined;
    activateNavigationSelection(restoring.requiredSheetId);
    restoring.complete();
  }, [activateNavigationSelection]);
  const cancelPendingScroll = useCallback(() => {
    pendingScroll.current.clear();
  }, []);
  const cancelRestore = useCallback(() => {
    restoreGeneration.current += 1;
    const previous = activeRestore.current;
    activeRestore.current = undefined;
    setActiveNavigationGeneration(null);
    cancelPendingScroll();
    previous?.cancelViewport();
  }, [cancelPendingScroll]);
  const acknowledgeGridRestore = useCallback((sheetId: string, generation: number) => {
    const offset = pendingScroll.current.get(sheetId);
    const restoring = activeRestore.current;
    if (restoring?.generation === generation && (!stageDestination || restoring.viewportSettled) && restoring.requiredSheetId === sheetId && !restoring.requiredGridSettled) {
      if (offset?.generation === generation) pendingScroll.current.delete(sheetId);
      restoring.requiredGridSettled = true;
      finishRestoreIfSettled();
    }
  }, [finishRestoreIfSettled, stageDestination]);
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
  const beginNavigation = useCallback((operation: NavigationOperation, requiredSheetId: string | undefined, startViewport: (settled: () => void, failed: (reason: 'unavailable' | 'cancelled') => void) => () => void, scroll: Record<string, { left: number; top: number }> = {}, navigationTarget?: ReferenceNavigationTarget, onReady?: () => void, onUnavailable?: () => void) => {
    cancelRestore();
    restoreGeneration.current = Math.max(restoreGeneration.current + 1, operation.generation);
    const generation = operation.generation;
    const restoring = {
      generation, complete: operation.complete, cancelViewport: () => {}, viewportSettled: false, requiredGridSettled: false, requiredSheetId, navigationTarget,
    };
    activeRestore.current = restoring;
    const publishDestination = () => {
      onReady?.();
      if (activeRestore.current !== restoring) return;
      Object.entries(scroll).forEach(([sheetId, offset]) => {
        if (sheetId !== requiredSheetId || restoring.requiredSheetId) pendingScroll.current.set(sheetId, { ...offset, generation });
      });
      setActiveNavigationGeneration(generation);
    };
    if (!stageDestination) publishDestination();
    const cancelViewport = startViewport(() => {
      if (activeRestore.current !== restoring) return;
      restoring.viewportSettled = true;
      if (stageDestination) publishDestination();
      finishRestoreIfSettled();
    }, (reason) => {
      if (activeRestore.current !== restoring) return;
      activeRestore.current = undefined;
      cancelPendingScroll();
      setActiveNavigationGeneration(null);
      if (reason === 'unavailable') onUnavailable?.();
      operation.complete();
    });
    if (activeRestore.current === restoring) restoring.cancelViewport = cancelViewport;
    else cancelViewport();
    finishRestoreIfSettled();
  }, [cancelPendingScroll, cancelRestore, finishRestoreIfSettled, stageDestination]);
  const restore = useCallback((context: ReturnType<typeof capture>, operation: NavigationOperation) => {
    beginNavigation(operation, context.selection?.anchor.sheetId,
      (settled, failed) => context.selection && restoreDestination
        ? restoreDestination(context.selection.anchor.sheetId, context.viewport, settled, failed)
        : restoreViewport(context.viewport, settled), context.scroll, undefined, () => {
        const selectionAvailable = onRestoreSelection(context.selection);
        if (!selectionAvailable && context.selection) {
          onUnavailableTarget();
          if (activeRestore.current?.generation === operation.generation) activeRestore.current.requiredSheetId = undefined;
        }
      }, () => {
        onRestoreSelection(null);
        onUnavailableTarget();
      });
  }, [beginNavigation, onRestoreSelection, onUnavailableTarget, restoreViewport, restoreDestination]);
  const history = useNavigationHistory({ capture, restore });
  const cancelNavigationRestore = useCallback(() => {
    // Outer input must invalidate both the adapter's DOM work and the history
    // operation before the controller changes the viewport.
    cancelRestore();
    history.cancelPendingNavigation();
  }, [cancelRestore, history]);
  const recordUserGridMovement = useCallback(() => {
    cancelRestore();
    history.recordUserMovement();
  }, [cancelRestore, history]);
  const navigationHistory = {
    ...history,
    explicitNavigation: history.explicitNavigation,
    recordUserMovement: () => {
      cancelRestore();
      history.recordUserMovement();
    },
    traverse: (direction: 'back' | 'forward') => {
      cancelRestore();
      const traversed = history.traverse(direction);
      if (traversed) onHistoryTraversal?.();
      return traversed;
    },
  };
  const historyRestoreForSheet = useCallback((sheetId: string) => pendingScroll.current.get(sheetId), []);
  const navigationRestoreForSheet = useCallback((sheetId: string) => {
    const active = activeRestore.current;
    return active && (!stageDestination || active.viewportSettled) && active.requiredSheetId === sheetId ? active.generation : undefined;
  }, [stageDestination]);
  const navigationRequestForSheet = useCallback((sheetId: string) => {
    const active = activeRestore.current;
    return active && (!stageDestination || active.viewportSettled) && active.requiredSheetId === sheetId && active.navigationTarget
      ? { generation: active.generation, target: active.navigationTarget }
      : undefined;
  }, [stageDestination]);
  const startExplicitNavigation = useCallback((operation: NavigationOperation, target: ReferenceNavigationTarget, startViewport: (settled: () => void) => () => void, onReady?: () => void) => {
    const sheetId = target.kind === 'cell' ? target.target.sheetId : target.sheetId;
    beginNavigation(operation, sheetId, startViewport, {}, target, onReady);
  }, [beginNavigation]);
  const startExplicitSheetNavigation = useCallback((clearSelection: () => void, startViewport: (settled: () => void) => () => void) => {
    history.explicitNavigation((operation) => {
      // Empty sheets are valid destinations but intentionally have no grid target.
      // Clear the old selection before the arrival context is captured.
      clearSelection();
      beginNavigation(operation, undefined, startViewport);
    });
  }, [beginNavigation, history]);
  return { acknowledgeGridRestore, cancelNavigationRestore, history: navigationHistory, historyRestoreForSheet, navigationRestoreForSheet, navigationRequestForSheet, registerScrollContainer, recordUserGridMovement, startExplicitNavigation, startExplicitSheetNavigation, pendingNavigationSheetId: activeRestore.current?.requiredSheetId };
}
