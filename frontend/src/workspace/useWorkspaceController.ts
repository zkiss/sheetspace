import { MouseEvent, useLayoutEffect, useRef, useState } from 'react';
import { useWorkspaceGestures } from './useWorkspaceGestures';
import { isBackgroundTarget } from './workspaceEventPolicy';
import { displayedWorkspaceViewport } from './workspaceViewportMotion';
import { useDisplayedWorkspaceViewport } from './useDisplayedWorkspaceViewport';
import type { PendingSheetMenu, WorkspaceViewport } from './workspaceContracts';
import { SheetFrameSize, WorkspacePosition } from '@workbook/core/model';
import {
  addFiniteWorkspaceCoordinate,
  surfaceSize as measureSurfaceSize,
  viewportForTarget,
  workspacePointAtViewportCenter,
  type WorkspaceTargetRect,
  WORKSPACE_NAVIGATION_TRANSITION_MS,
  zoomScaleBy,
  zoomViewportAt,
} from '@workspace/workspaceGeometry';

export function useWorkspaceController({
  onBeforeUserMovement,
  onClearSelection,
  onCreateSheet,
  interactionsEnabled = true,
}: {
  onBeforeUserMovement?: () => void;
  onClearSelection: () => void;
  onCreateSheet: (position: WorkspacePosition, viewportScale: number, label: string) => void;
  interactionsEnabled?: boolean;
}) {
  const [viewport, setViewport] = useState<WorkspaceViewport>({ x: 0, y: 0, scale: 1 });
  const [pendingSheetMenu, setPendingSheetMenu] = useState<PendingSheetMenu | null>(null);
  const [navigationInterrupted, setNavigationInterrupted] = useState(false);
  const [navigationMotion, setNavigationMotion] = useState(false);
  const [workspaceSurfaceSize, setWorkspaceSurfaceSize] = useState<SheetFrameSize | null>(null);
  const workspaceSurfaceRef = useRef<HTMLElement | null>(null);
  const workspacePlaneRef = useRef<HTMLDivElement | null>(null);
  const displayedViewport = useDisplayedWorkspaceViewport(workspacePlaneRef, viewport);
  const navigationMayBeMoving = useRef(false);
  const viewportMovementIsUser = useRef(false);
  const pendingViewportRestore = useRef<{ id: number; onSettled: () => void; timeout?: number }>();
  const nextViewportRestoreId = useRef(0);
  useLayoutEffect(() => {
    const pending = pendingViewportRestore.current;
    if (!pending) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reducedMotion) {
      pendingViewportRestore.current = undefined;
      pending.onSettled();
      return;
    }
    setNavigationMotion(true);
    pending.timeout = window.setTimeout(() => {
      if (pendingViewportRestore.current?.id !== pending.id) return;
      pendingViewportRestore.current = undefined;
      setNavigationMotion(false);
      pending.onSettled();
    }, WORKSPACE_NAVIGATION_TRANSITION_MS);
  }, [viewport]);
  const isPanningWorkspace = useWorkspaceGestures(workspaceSurfaceRef, {
    start: interruptNavigation, pan: panWorkspace, zoom: zoomWorkspaceBy, closeMenu: closeSheetMenu, clearSelection: onClearSelection,
  }, interactionsEnabled);

  useLayoutEffect(() => {
    const workspace = workspaceSurfaceRef.current;
    if (!workspace) return;

    const updateSurfaceSize = (observedSize?: SheetFrameSize) => {
      const nextSize = observedSize ?? measureSurfaceSize(workspace);
      setWorkspaceSurfaceSize((currentSize) => currentSize
        && currentSize.width === nextSize.width
        && currentSize.height === nextSize.height
        ? currentSize
        : nextSize);
    };
    updateSurfaceSize();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => updateSurfaceSize({
      height: entry.contentRect.height,
      width: entry.contentRect.width,
    }));
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  function closeSheetMenu() {
    setPendingSheetMenu(null);
  }

  useLayoutEffect(() => {
    if (!interactionsEnabled) {
      closeSheetMenu();
      return;
    }
    if (!pendingSheetMenu) return;
    // The menu owns Escape even when focus is still in the underlying grid.
    const cancelMenu = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeSheetMenu();
    };
    document.addEventListener('keydown', cancelMenu, true);
    return () => document.removeEventListener('keydown', cancelMenu, true);
  }, [pendingSheetMenu, interactionsEnabled]);

  function openSheetMenu(sheetId: string, event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!interactionsEnabled) return;
    setPendingSheetMenu({
      sheetId,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function interruptNavigation() {
    // History restoration may have pending grid work. Retire it before sampling
    // or changing the viewport so a newly mounted grid cannot restore over this
    // gesture.
    onBeforeUserMovement?.();
    // Read before React removes the transition, and only once even for batched inputs.
    if (navigationMayBeMoving.current) {
      navigationMayBeMoving.current = false;
      const displayed = displayedWorkspaceViewport(workspacePlaneRef.current);
      cancelViewportRestore();
      cancelViewportAnimation();
      if (displayed) setViewport(displayed);
    } else {
      cancelViewportRestore();
      cancelViewportAnimation();
    }
    viewportMovementIsUser.current = true;
    setNavigationInterrupted(true);
    setNavigationMotion(false);
  }

  function panWorkspace(deltaX: number, deltaY: number) {
    interruptNavigation();
    setViewport((currentViewport) => ({
      ...currentViewport,
      x: addFiniteWorkspaceCoordinate(currentViewport.x, deltaX),
      y: addFiniteWorkspaceCoordinate(currentViewport.y, deltaY),
    }));
  }

  function zoomWorkspace(nextScale: number, origin?: WorkspacePosition) {
    interruptNavigation();
    setViewport((currentViewport) => zoomViewportAt(currentViewport, nextScale, zoomOrigin(origin)));
  }

  function zoomWorkspaceBy(factor: number, origin?: WorkspacePosition) {
    interruptNavigation();
    setViewport((currentViewport) => zoomViewportAt(
      currentViewport,
      zoomScaleBy(currentViewport.scale, factor),
      zoomOrigin(origin),
    ));
  }

  function zoomOrigin(origin?: WorkspacePosition): WorkspacePosition | undefined {
    if (origin || !workspaceSurfaceRef.current) return origin;
    const { width, height } = measureSurfaceSize(workspaceSurfaceRef.current);
    return { x: width / 2, y: height / 2 };
  }

  function resetViewport() {
    onBeforeUserMovement?.();
    cancelViewportRestore();
    cancelViewportAnimation();
    navigationMayBeMoving.current = false;
    viewportMovementIsUser.current = true;
    setNavigationInterrupted(true);
    setNavigationMotion(false);
    setViewport({ x: 0, y: 0, scale: 1 });
  }

  function cancelViewportRestore() {
    const pending = pendingViewportRestore.current;
    if (pending?.timeout !== undefined) window.clearTimeout(pending.timeout);
    pendingViewportRestore.current = undefined;
  }

  function cancelViewportAnimation() {
    workspacePlaneRef.current?.getAnimations().forEach((animation) => animation.cancel());
  }

  function restoreViewport(nextViewport: WorkspaceViewport, onSettled: () => void = () => {}) {
    cancelViewportRestore();
    cancelViewportAnimation();
    const id = ++nextViewportRestoreId.current;
    pendingViewportRestore.current = { id, onSettled };
    navigationMayBeMoving.current = true;
    viewportMovementIsUser.current = false;
    setNavigationInterrupted(false);
    setViewport(nextViewport);
    return () => {
      if (pendingViewportRestore.current?.id === id) cancelViewportRestore();
    };
  }

  function navigateToTarget(
    target: WorkspaceTargetRect,
    options: { forceOversized?: boolean; minimumScale?: number; naturalScale?: number; preserveVisibleAxes?: boolean; onSettled?: () => void } = {},
  ): () => void {
    const workspace = workspaceSurfaceRef.current;
    if (!workspace) {
      options.onSettled?.();
      return () => {};
    }
    const { height: surfaceHeight, width: surfaceWidth } = measureSurfaceSize(workspace);
    let id: number | undefined;
    if (options.onSettled) {
      cancelViewportRestore();
      id = ++nextViewportRestoreId.current;
      pendingViewportRestore.current = { id, onSettled: options.onSettled };
    }
    navigationMayBeMoving.current = true;
    viewportMovementIsUser.current = false;
    setNavigationInterrupted(false);
    const nextViewport = viewportForTarget({
      currentViewport: viewport,
      surfaceHeight,
      surfaceWidth,
      target,
      ...options,
    }).viewport;
    cancelViewportAnimation();
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (!reducedMotion && workspacePlaneRef.current?.animate) {
      workspacePlaneRef.current.animate([
        { transform: viewportTransform(viewport) },
        { transform: viewportTransform(nextViewport) },
      ], { duration: WORKSPACE_NAVIGATION_TRANSITION_MS, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'both' });
    }
    setNavigationMotion(true);
    setViewport(nextViewport);
    return () => {
      if (id !== undefined && pendingViewportRestore.current?.id === id) cancelViewportRestore();
    };
  }

  function createSheetAtViewportCenter() {
    if (!interactionsEnabled) return;
    const workspace = workspaceSurfaceRef.current;
    if (!workspace) return;
    closeSheetMenu();
    onCreateSheet(sheetFramePosition(workspacePointAtViewportCenter(workspace, viewport)), viewport.scale, 'Create sheet at viewport center');
  }

  function handleWorkspaceContextMenu(event: MouseEvent<HTMLElement>) {
    if (event.defaultPrevented || !isBackgroundTarget(event.target, event.currentTarget)) return;
    event.preventDefault();
    closeSheetMenu();
  }

  return {
    closeSheetMenu,
    consumeViewportMovementIsUser: () => {
      const isUserMovement = viewportMovementIsUser.current;
      viewportMovementIsUser.current = false;
      return isUserMovement;
    },
    createSheetAtViewportCenter,
    handleWorkspaceContextMenu,
    isPanningWorkspace,
    navigationInterrupted,
    navigationMotion,
    navigateToTarget,
    openSheetMenu,
    panWorkspace,
    pendingSheetMenu,
    resetViewport,
    restoreViewport,
    viewport,
    displayedViewport,
    workspacePlaneRef,
    workspaceSurfaceRef,
    workspaceSurfaceSize,
    zoomWorkspace,
    zoomWorkspaceBy,
  };
}

function sheetFramePosition(position: WorkspacePosition): WorkspacePosition {
  return { x: Math.round(position.x), y: Math.round(position.y) };
}

function viewportTransform(viewport: WorkspaceViewport) {
  return `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`;
}
