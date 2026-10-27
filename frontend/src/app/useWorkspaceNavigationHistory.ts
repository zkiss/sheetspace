import { useCallback, useEffect, useRef, useState } from 'react';
import type { CellSelection } from '@grid/cellInteractionContracts';
import type { ReferenceNavigationTarget } from '@grid/cellInteractionContracts';
import { useNavigationHistory } from '@reference-navigation/useNavigationHistory';
import type { NavigationOperation } from '@reference-navigation/useNavigationHistory';
import type { WorkspaceViewport } from '@workspace/workspaceContracts';

export function useWorkspaceNavigationHistory({ onRestoreSelection, onUnavailableTarget, onHistoryTraversal, restoreViewport, selection, viewport }: {
  onRestoreSelection: (selection: CellSelection | null) => boolean;
  onUnavailableTarget: () => void;
  onHistoryTraversal?: () => void;
  restoreViewport: (viewport: WorkspaceViewport, onSettled: () => void) => () => void;
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
    activeRestore.current?.cancelViewport();
    activeRestore.current = undefined;
    setActiveNavigationGeneration(null);
    cancelPendingScroll();
  }, [cancelPendingScroll]);
  const acknowledgeGridRestore = useCallback((sheetId: string, generation: number) => {
    const offset = pendingScroll.current.get(sheetId);
    const restoring = activeRestore.current;
    if (restoring?.generation === generation && restoring.requiredSheetId === sheetId && !restoring.requiredGridSettled) {
      if (offset?.generation === generation) pendingScroll.current.delete(sheetId);
      restoring.requiredGridSettled = true;
      activateNavigationSelection(sheetId);
      finishRestoreIfSettled();
    }
  }, [activateNavigationSelection, finishRestoreIfSettled]);
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
  const beginNavigation = useCallback((operation: NavigationOperation, requiredSheetId: string | undefined, startViewport: (settled: () => void) => () => void, scroll: Record<string, { left: number; top: number }> = {}, navigationTarget?: ReferenceNavigationTarget) => {
    cancelRestore();
    restoreGeneration.current = Math.max(restoreGeneration.current + 1, operation.generation);
    const generation = operation.generation;
    const restoring = {
      generation, complete: operation.complete, cancelViewport: () => {}, viewportSettled: false, requiredGridSettled: false, requiredSheetId, navigationTarget,
    };
    activeRestore.current = restoring;
    setActiveNavigationGeneration(generation);
    restoring.cancelViewport = startViewport(() => {
      if (activeRestore.current?.generation !== generation) return;
      activeRestore.current.viewportSettled = true;
      finishRestoreIfSettled();
    });
    Object.entries(scroll).forEach(([sheetId, offset]) => pendingScroll.current.set(sheetId, { ...offset, generation }));
    finishRestoreIfSettled();
  }, [cancelRestore, finishRestoreIfSettled]);
  const restore = useCallback((context: ReturnType<typeof capture>, operation: NavigationOperation) => {
    const selectionAvailable = onRestoreSelection(context.selection);
    if (!selectionAvailable && context.selection) onUnavailableTarget();
    beginNavigation(operation, selectionAvailable ? context.selection?.anchor.sheetId : undefined,
      (settled) => restoreViewport(context.viewport, settled), context.scroll);
  }, [beginNavigation, onRestoreSelection, onUnavailableTarget, restoreViewport]);
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
    return active?.requiredSheetId === sheetId ? active.generation : undefined;
  }, []);
  const navigationRequestForSheet = useCallback((sheetId: string) => {
    const active = activeRestore.current;
    return active?.requiredSheetId === sheetId && active.navigationTarget
      ? { generation: active.generation, target: active.navigationTarget }
      : undefined;
  }, []);
  const startExplicitNavigation = useCallback((operation: NavigationOperation, target: ReferenceNavigationTarget, startViewport: (settled: () => void) => () => void) => {
    const sheetId = target.kind === 'cell' ? target.target.sheetId : target.sheetId;
    beginNavigation(operation, sheetId, startViewport, {}, target);
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
