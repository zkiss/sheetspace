import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CellSelection } from '@grid/cellInteractionContracts';
import type { ReferenceNavigationTarget } from '@grid/cellInteractionContracts';
import { useNavigationHistory } from '@reference-navigation/useNavigationHistory';
import type { NavigationOperation } from '@reference-navigation/useNavigationHistory';
import type { NavigationContext } from '@reference-navigation/navigationHistory';
import type { WorkspaceViewport } from '@workspace/workspaceContracts';

export function useWorkspaceNavigationHistory({ onRestoreSelection, onUnavailableTarget, onHistoryTraversal, restoreViewport, restoreDestination, stageDestination = false, selection, viewport }: {
  onRestoreSelection: (selection: CellSelection | null) => boolean;
  onUnavailableTarget: () => void;
  onHistoryTraversal?: () => void;
  restoreViewport: (viewport: WorkspaceViewport, onSettled: () => void) => () => void;
  restoreDestination?: (sheetId: string, viewport: WorkspaceViewport, onSettled: () => void, onFailure: (reason: 'unavailable' | 'cancelled') => void) => () => void;
  stageDestination?: boolean | (() => boolean);
  selection: CellSelection | null;
  viewport: WorkspaceViewport;
}) {
  const scrollContainers = useRef(new Map<string, HTMLElement>());
  const pendingScroll = useRef(new Map<string, { generation: number; left: number; top: number }>());
  const destinationSheetId = useRef<string>();
  const [, setActiveNavigationGeneration] = useState(0);
  const activeRestore = useRef<{ generation: number; operation: NavigationOperation; cancelViewport: () => void; onRetire?: () => void; retired: boolean; finished: boolean; viewportSettled: boolean; requiredGridSettled: boolean; staged: boolean; requiredSheetId?: string; destinationSheetId?: string; navigationTarget?: ReferenceNavigationTarget }>();
  const activateNavigationSelection = useCallback((sheetId: string | undefined) => {
    if (!sheetId) return;
    // A dialog or editor opened after the jump owns focus until the user leaves it.
    if (document.activeElement?.closest('[role="dialog"], [data-workspace-sheet-editor]')) return;
    const selectedCell = scrollContainers.current.get(sheetId)?.querySelector<HTMLElement>('[data-active-cell="true"]');
    selectedCell?.focus({ preventScroll: true });
  }, []);
  const finishRestoreIfSettled = useCallback(() => {
    const restoring = activeRestore.current;
    if (!restoring || !restoring.operation.isCurrent() || !restoring.viewportSettled || (restoring.requiredSheetId && !restoring.requiredGridSettled)) return;
    activateNavigationSelection(restoring.requiredSheetId);
    if (activeRestore.current !== restoring || !restoring.operation.isCurrent()) return;
    restoring.finished = true;
    activeRestore.current = undefined;
    destinationSheetId.current = restoring.destinationSheetId;
    restoring.operation.complete();
  }, [activateNavigationSelection]);
  useLayoutEffect(() => { finishRestoreIfSettled(); });
  const cancelPendingScroll = useCallback(() => {
    pendingScroll.current.clear();
  }, []);
  const cancelRestore = useCallback(() => {
    const previous = activeRestore.current;
    activeRestore.current = undefined;
    if (previous) previous.retired = true;
    setActiveNavigationGeneration((revision) => revision + 1);
    cancelPendingScroll();
    previous?.onRetire?.();
    previous?.cancelViewport();
  }, [cancelPendingScroll]);
  const acknowledgeGridRestore = useCallback((sheetId: string, generation: number) => {
    const offset = pendingScroll.current.get(sheetId);
    const restoring = activeRestore.current;
    if (restoring?.generation === generation && restoring.operation.isCurrent() && (!restoring.staged || restoring.viewportSettled) && restoring.requiredSheetId === sheetId && !restoring.requiredGridSettled) {
      if (offset?.generation === generation) pendingScroll.current.delete(sheetId);
      restoring.requiredGridSettled = true;
      setActiveNavigationGeneration((revision) => revision + 1);
    }
  }, []);
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
    destinationSheetId: selection?.anchor.sheetId ?? destinationSheetId.current,
    scroll: Object.fromEntries([...scrollContainers.current].map(([sheetId, element]) => [sheetId, {
      left: element.scrollLeft, top: element.scrollTop,
    }])),
  }), [selection, viewport]);
  const beginNavigation = useCallback((operation: NavigationOperation, requiredSheetId: string | undefined, startViewport: (settled: () => void, failed: (reason: 'unavailable' | 'cancelled') => void) => () => void, scroll: Record<string, { left: number; top: number }> = {}, navigationTarget?: ReferenceNavigationTarget, onReady?: () => void, onUnavailable?: () => void, destination = requiredSheetId, onRetire?: () => void) => {
    if (!operation.isCurrent()) return;
    const previous = activeRestore.current;
    const generation = operation.generation;
    const restoring = {
      generation, operation, cancelViewport: () => {}, onRetire, retired: false, finished: false, viewportSettled: false, requiredGridSettled: false, staged: typeof stageDestination === 'function' ? stageDestination() : stageDestination, requiredSheetId, destinationSheetId: destination, navigationTarget,
    };
    activeRestore.current = restoring;
    if (previous) previous.retired = true;
    cancelPendingScroll();
    setActiveNavigationGeneration((revision) => revision + 1);
    previous?.onRetire?.();
    previous?.cancelViewport();
    const current = () => activeRestore.current === restoring && operation.isCurrent();
    if (!current()) return;
    const publishDestination = () => {
      onReady?.();
      if (!current()) return;
      Object.entries(scroll).forEach(([sheetId, offset]) => {
        if (sheetId !== requiredSheetId || restoring.requiredSheetId) pendingScroll.current.set(sheetId, { ...offset, generation });
      });
      setActiveNavigationGeneration((revision) => revision + 1);
    };
    if (!restoring.staged) publishDestination();
    if (!current()) return;
    const cancelViewport = startViewport(() => {
      if (!current() || restoring.viewportSettled) return;
      restoring.viewportSettled = true;
      restoring.cancelViewport = () => {};
      if (restoring.staged) publishDestination();
      if (current()) setActiveNavigationGeneration((revision) => revision + 1);
    }, (reason) => {
      if (!current() || restoring.viewportSettled) return;
      activeRestore.current = undefined;
      restoring.finished = true;
      cancelPendingScroll();
      setActiveNavigationGeneration((revision) => revision + 1);
      operation.cancel();
      restoring.onRetire?.();
      if (reason === 'unavailable' && operation.isLatest()) onUnavailable?.();
    });
    if (current() && !restoring.viewportSettled) restoring.cancelViewport = cancelViewport;
    else if (restoring.retired && !restoring.finished && !restoring.viewportSettled) cancelViewport();
  }, [cancelPendingScroll, stageDestination]);
  const restore = useCallback((context: NavigationContext, operation: NavigationOperation) => {
    beginNavigation(operation, context.selection?.anchor.sheetId,
      (settled, failed) => context.destinationSheetId && restoreDestination
        ? restoreDestination(context.destinationSheetId, context.viewport, settled, failed)
        : restoreViewport(context.viewport, settled), context.scroll, undefined, () => {
        const selectionAvailable = onRestoreSelection(context.selection);
        if (activeRestore.current?.operation !== operation || !operation.isCurrent()) return;
        if (!selectionAvailable && context.selection) {
          onUnavailableTarget();
          if (activeRestore.current?.operation === operation && operation.isCurrent()) activeRestore.current.requiredSheetId = undefined;
        }
      }, () => {
        if (!operation.isLatest()) return;
        onRestoreSelection(null);
        if (operation.isLatest()) onUnavailableTarget();
      }, context.destinationSheetId);
  }, [beginNavigation, onRestoreSelection, onUnavailableTarget, restoreViewport, restoreDestination]);
  const history = useNavigationHistory({ capture, restore });
  const cancelNavigationRestore = useCallback(() => {
    // Outer input must invalidate both the adapter's DOM work and the history
    // operation before the controller changes the viewport.
    history.cancelPendingNavigation();
    cancelRestore();
  }, [cancelRestore, history]);
  const recordUserGridMovement = useCallback(() => {
    history.recordUserMovement();
    cancelRestore();
  }, [cancelRestore, history]);
  const navigationHistory = {
    ...history,
    explicitNavigation: history.explicitNavigation,
    recordUserMovement: () => {
      history.recordUserMovement();
      cancelRestore();
    },
    traverse: (direction: 'back' | 'forward') => {
      const traversed = history.traverse(direction);
      if (traversed) onHistoryTraversal?.();
      return traversed;
    },
  };
  const historyRestoreForSheet = useCallback((sheetId: string) => pendingScroll.current.get(sheetId), []);
  const navigationRestoreForSheet = useCallback((sheetId: string) => {
    const active = activeRestore.current;
    return active && (!active.staged || active.viewportSettled) && active.requiredSheetId === sheetId ? active.generation : undefined;
  }, []);
  const navigationRequestForSheet = useCallback((sheetId: string) => {
    const active = activeRestore.current;
    return active && (!active.staged || active.viewportSettled) && active.requiredSheetId === sheetId && active.navigationTarget
      ? { generation: active.generation, target: active.navigationTarget }
      : undefined;
  }, []);
  const startExplicitNavigation = useCallback((operation: NavigationOperation, target: ReferenceNavigationTarget, startViewport: (settled: () => void, failed: (reason: 'unavailable' | 'cancelled') => void) => () => void, onReady?: () => void, onRetire?: () => void) => {
    const sheetId = target.kind === 'cell' ? target.target.sheetId : target.sheetId;
    beginNavigation(operation, sheetId, startViewport, {}, target, onReady, onUnavailableTarget, sheetId, onRetire);
  }, [beginNavigation, onUnavailableTarget]);
  const startExplicitSheetNavigation = useCallback((sheetId: string, clearSelection: () => void, startViewport: (settled: () => void, failed: (reason: 'unavailable' | 'cancelled') => void) => () => void) => {
    history.explicitNavigation((operation) => {
      beginNavigation(operation, undefined, startViewport, {}, undefined, clearSelection, onUnavailableTarget, sheetId);
    });
  }, [beginNavigation, history, onUnavailableTarget]);
  return { acknowledgeGridRestore, cancelNavigationRestore, history: navigationHistory, historyRestoreForSheet, navigationRestoreForSheet, navigationRequestForSheet, registerScrollContainer, recordUserGridMovement, startExplicitNavigation, startExplicitSheetNavigation, pendingNavigationSheetId: activeRestore.current?.destinationSheetId };
}
