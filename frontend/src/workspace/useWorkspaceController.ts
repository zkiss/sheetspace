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
  shouldRenderPanViewport,
  interactionsEnabled = true,
}: {
  onBeforeUserMovement?: () => void;
  onClearSelection: () => void;
  onCreateSheet: (position: WorkspacePosition, viewportScale: number, label: string) => void;
  shouldRenderPanViewport?: (viewport: WorkspaceViewport) => boolean;
  interactionsEnabled?: boolean;
}) {
  const [viewport, setViewport] = useState<WorkspaceViewport>({ x: 0, y: 0, scale: 1 });
  const [pendingSheetMenu, setPendingSheetMenu] = useState<PendingSheetMenu | null>(null);
  const [navigationInterrupted, setNavigationInterrupted] = useState(false);
  const [navigationMotion, setNavigationMotion] = useState(false);
  const [workspaceSurfaceSize, setWorkspaceSurfaceSize] = useState<SheetFrameSize | null>(null);
  const workspaceSurfaceRef = useRef<HTMLElement | null>(null);
  const workspacePlaneRef = useRef<HTMLDivElement | null>(null);
  const panPreview = useRef<WorkspaceViewport | null>(null);
  const panFrame = useRef<number>();
  const panPublication = useRef({ time: 0, x: 0, y: 0 });
  const zoomPreview = useRef<WorkspaceViewport | null>(null);
  const zoomFrame = useRef<number>();
  const zoomTimer = useRef<number>();
  const zoomPublication = useRef(0);
  const viewportRef = useRef(viewport);
  viewportRef.current = zoomPreview.current ?? panPreview.current ?? viewport;
  const displayedViewport = useDisplayedWorkspaceViewport(workspacePlaneRef, viewport);
  const navigationMayBeMoving = useRef(false);
  const viewportMovementIsUser = useRef(false);
  const pendingViewportRestore = useRef<{ id: number; onSettled: () => void; timeout?: number }>();
  const nextViewportRestoreId = useRef(0);
  const isPanningWorkspace = useWorkspaceGestures(workspaceSurfaceRef, {
    start: interruptNavigation, panStart: beginPanPreview, panEnd: finishPanPreview,
    pan: panWorkspace, zoom: zoomWorkspaceBy, closeMenu: closeSheetMenu, clearSelection: onClearSelection,
  }, interactionsEnabled);

  useLayoutEffect(() => {
    if (zoomPreview.current) paintPanViewport(zoomPreview.current);
    else if (panPreview.current) paintPanViewport(panPreview.current);
  });

  useLayoutEffect(() => () => {
    if (zoomFrame.current !== undefined) cancelAnimationFrame(zoomFrame.current);
    if (zoomTimer.current !== undefined) window.clearTimeout(zoomTimer.current);
  }, []);

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
    finishZoomPreview();
    finishPanPreview();
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
      if (displayed) { viewportRef.current = displayed; setViewport(displayed); }
    } else {
      cancelViewportRestore();
      cancelViewportAnimation();
    }
    viewportMovementIsUser.current = true;
    setNavigationInterrupted(true);
    setNavigationMotion(false);
  }

  function panWorkspace(deltaX: number, deltaY: number) {
    if (panPreview.current) {
      panPreview.current = {
        ...panPreview.current,
        x: addFiniteWorkspaceCoordinate(panPreview.current.x, deltaX),
        y: addFiniteWorkspaceCoordinate(panPreview.current.y, deltaY),
      };
      if (panFrame.current === undefined) panFrame.current = requestAnimationFrame((time) => {
        panFrame.current = undefined;
        const next = panPreview.current;
        if (!next) return;
        paintPanViewport(next);
        const published = panPublication.current;
        if (time - published.time >= 100 || Math.max(Math.abs(next.x - published.x), Math.abs(next.y - published.y)) >= 160) {
          panPublication.current = { time, x: next.x, y: next.y };
          if (!shouldRenderPanViewport || shouldRenderPanViewport(next)) {
            viewportMovementIsUser.current = true;
            setViewport(next);
          }
        }
      });
      return;
    }
    interruptNavigation();
    setViewport((currentViewport) => ({
      ...currentViewport,
      x: addFiniteWorkspaceCoordinate(currentViewport.x, deltaX),
      y: addFiniteWorkspaceCoordinate(currentViewport.y, deltaY),
    }));
  }

  function beginPanPreview() {
    panPreview.current = viewportRef.current;
    panPublication.current = { time: performance.now(), x: viewportRef.current.x, y: viewportRef.current.y };
  }

  function finishPanPreview() {
    if (panFrame.current !== undefined) cancelAnimationFrame(panFrame.current);
    panFrame.current = undefined;
    const next = panPreview.current;
    if (!next) return;
    paintPanViewport(next);
    panPreview.current = null;
    viewportRef.current = next;
    viewportMovementIsUser.current = true;
    setViewport(next);
  }

  function paintPanViewport(next: WorkspaceViewport) {
    const surface = workspaceSurfaceRef.current;
    const plane = workspacePlaneRef.current;
    if (!surface || !plane) return;
    plane.style.transform = viewportTransform(next);
    surface.dataset.viewportX = String(next.x);
    surface.dataset.viewportY = String(next.y);
    const grid = surface.querySelector<HTMLElement>('.workspace-grid');
    const size = 40 * 2 ** Math.ceil(Math.log2(1 / next.scale)) * next.scale;
    if (surface.dataset.viewportScale !== String(next.scale)) {
      const phase = Math.max(0, Math.min(1, (size - 40) / 40));
      surface.dataset.viewportScale = String(next.scale);
      surface.style.setProperty('--workspace-grid-major-size', `${size}px`);
      surface.style.setProperty('--workspace-grid-minor-size', `${size / 2}px`);
      surface.style.setProperty('--workspace-grid-fine-size', `${size / 4}px`);
      surface.style.setProperty('--workspace-grid-minor-opacity', String(0.35 + 0.65 * phase));
      surface.style.setProperty('--workspace-grid-fine-opacity', String(0.35 * phase));
    }
    if (grid && size > 0) grid.style.transform = `translate(${next.x % size}px, ${next.y % size}px)`;
  }

  function zoomWorkspace(nextScale: number, origin?: WorkspacePosition) {
    interruptNavigation();
    setViewport((currentViewport) => zoomViewportAt(currentViewport, nextScale, zoomOrigin(origin)));
  }

  function zoomWorkspaceBy(factor: number, origin?: WorkspacePosition) {
    if (!zoomPreview.current) {
      interruptNavigation();
      zoomPreview.current = viewportRef.current;
      zoomPublication.current = performance.now();
    }
    const current = zoomPreview.current;
    zoomPreview.current = zoomViewportAt(current, zoomScaleBy(current.scale, factor), zoomOrigin(origin));
    viewportRef.current = zoomPreview.current;
    if (zoomFrame.current === undefined) zoomFrame.current = requestAnimationFrame((time) => {
      zoomFrame.current = undefined;
      const next = zoomPreview.current;
      if (!next) return;
      paintPanViewport(next);
      if (time - zoomPublication.current >= 150) {
        zoomPublication.current = time;
        viewportMovementIsUser.current = true;
        setViewport(next);
      }
    });
    if (zoomTimer.current !== undefined) window.clearTimeout(zoomTimer.current);
    zoomTimer.current = window.setTimeout(finishZoomPreview, 150);
  }

  function finishZoomPreview() {
    if (zoomFrame.current !== undefined) cancelAnimationFrame(zoomFrame.current);
    if (zoomTimer.current !== undefined) window.clearTimeout(zoomTimer.current);
    zoomFrame.current = undefined; zoomTimer.current = undefined;
    const next = zoomPreview.current;
    if (!next) return;
    paintPanViewport(next);
    zoomPreview.current = null;
    viewportRef.current = next;
    viewportMovementIsUser.current = true;
    setViewport(next);
  }

  function zoomOrigin(origin?: WorkspacePosition): WorkspacePosition | undefined {
    if (origin || !workspaceSurfaceRef.current) return origin;
    const { width, height } = measureSurfaceSize(workspaceSurfaceRef.current);
    return { x: width / 2, y: height / 2 };
  }

  function resetViewport() {
    finishZoomPreview();
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
    return animateViewport(nextViewport, onSettled);
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
    const start = displayedWorkspaceViewport(workspacePlaneRef.current) ?? viewportRef.current;
    const nextViewport = viewportForTarget({
      currentViewport: start,
      surfaceHeight,
      surfaceWidth,
      target,
      ...options,
    }).viewport;
    return animateViewport(nextViewport, options.onSettled);
  }

  function animateViewport(nextViewport: WorkspaceViewport, onSettled?: () => void): () => void {
    finishZoomPreview();
    const start = displayedWorkspaceViewport(workspacePlaneRef.current) ?? viewportRef.current;
    cancelViewportRestore();
    cancelViewportAnimation();
    const id = ++nextViewportRestoreId.current;
    const pending = { id, onSettled: onSettled ?? (() => {}), timeout: undefined as number | undefined };
    pendingViewportRestore.current = pending;
    navigationMayBeMoving.current = true;
    viewportMovementIsUser.current = false;
    setNavigationInterrupted(false);
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const changed = start.x !== nextViewport.x || start.y !== nextViewport.y || start.scale !== nextViewport.scale;
    if (!reducedMotion && changed && workspacePlaneRef.current?.animate) {
      const animation = workspacePlaneRef.current.animate([
        { transform: viewportTransform(start) },
        { transform: viewportTransform(nextViewport) },
      ], { duration: WORKSPACE_NAVIGATION_TRANSITION_MS, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'both' });
      animation.onfinish = () => {
        if (pendingViewportRestore.current?.id !== id) return;
        pendingViewportRestore.current = undefined;
        navigationMayBeMoving.current = false;
        setNavigationMotion(false);
        animation.cancel();
        pending.onSettled();
      };
      setNavigationMotion(true);
    } else {
      pending.timeout = window.setTimeout(() => {
        if (pendingViewportRestore.current?.id !== id) return;
        pendingViewportRestore.current = undefined;
        navigationMayBeMoving.current = false;
        setNavigationMotion(false);
        pending.onSettled();
      }, 0);
      setNavigationMotion(false);
    }
    viewportRef.current = nextViewport;
    setViewport(nextViewport);
    return () => {
      if (pendingViewportRestore.current?.id === id) cancelViewportRestore();
    };
  }

  function createSheetAtViewportCenter() {
    if (!interactionsEnabled) return;
    const workspace = workspaceSurfaceRef.current;
    if (!workspace) return;
    closeSheetMenu();
    const current = viewportRef.current;
    onCreateSheet(sheetFramePosition(workspacePointAtViewportCenter(workspace, current)), current.scale, 'Create sheet at viewport center');
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
