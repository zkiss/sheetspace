import { MouseEvent, useLayoutEffect, useRef, useState } from 'react';
import { sheetCreationPlacement } from './sheetCreationPlacement';
import { useWorkspaceGestures } from './useWorkspaceGestures';
import { isBackgroundTarget } from './workspaceEventPolicy';
import { displayedWorkspaceViewport } from './workspaceViewportMotion';
import { useDisplayedWorkspaceViewport } from './useDisplayedWorkspaceViewport';
import { navigationViewportMotion } from './navigationViewportMotion';
import type { PendingSheetMenu, WorkspaceViewport } from './workspaceContracts';
import { SheetFrameSize, WorkspacePosition } from '@workbook/core/model';
import {
  addFiniteWorkspaceCoordinate,
  surfaceSize as measureSurfaceSize,
  viewportForTarget,
  type WorkspaceTargetRect,
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
  onCreateSheet: (position: WorkspacePosition, viewportScale: number, label: string, confirm: () => void) => void;
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
  const creationSequence = useRef<{ position?: WorkspacePosition; revision: number }>({ revision: 0 });
  const viewportRef = useRef(viewport);
  viewportRef.current = zoomPreview.current ?? panPreview.current ?? viewport;
  const displayedViewport = useDisplayedWorkspaceViewport(workspacePlaneRef, viewport);
  const navigationMayBeMoving = useRef(false);
  const activeViewportMotion = useRef<{ animation: Animation; motion: ReturnType<typeof navigationViewportMotion> }>();
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
    activeViewportMotion.current?.animation.cancel();
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

  function invalidateCreationSequence() {
    creationSequence.current = { revision: creationSequence.current.revision + 1 };
  }

  function panWorkspace(deltaX: number, deltaY: number) {
    if (deltaX !== 0 || deltaY !== 0) invalidateCreationSequence();
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
    const next = zoomViewportAt(viewportRef.current, nextScale, zoomOrigin(origin));
    if (next.scale !== viewportRef.current.scale) invalidateCreationSequence();
    setViewport(next);
  }

  function zoomWorkspaceBy(factor: number, origin?: WorkspacePosition) {
    if (!zoomPreview.current) {
      interruptNavigation();
      zoomPreview.current = viewportRef.current;
      zoomPublication.current = performance.now();
    }
    const current = zoomPreview.current;
    zoomPreview.current = zoomViewportAt(current, zoomScaleBy(current.scale, factor), zoomOrigin(origin));
    if (zoomPreview.current.scale !== current.scale) invalidateCreationSequence();
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
    if (viewportRef.current.x !== 0 || viewportRef.current.y !== 0 || viewportRef.current.scale !== 1) invalidateCreationSequence();
    setViewport({ x: 0, y: 0, scale: 1 });
  }

  function cancelViewportRestore() {
    const pending = pendingViewportRestore.current;
    if (pending?.timeout !== undefined) window.clearTimeout(pending.timeout);
    pendingViewportRestore.current = undefined;
  }

  function cancelViewportAnimation() {
    activeViewportMotion.current = undefined;
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
    const active = activeViewportMotion.current;
    const time = active?.animation.currentTime;
    const incoming = active?.motion.sample(typeof time === 'number' ? time : 0);
    const start = displayedWorkspaceViewport(workspacePlaneRef.current) ?? incoming?.viewport ?? viewportRef.current;
    cancelViewportRestore();
    const id = ++nextViewportRestoreId.current;
    const pending = { id, onSettled: onSettled ?? (() => {}), timeout: undefined as number | undefined };
    pendingViewportRestore.current = pending;
    navigationMayBeMoving.current = true;
    viewportMovementIsUser.current = false;
    setNavigationInterrupted(false);
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const changed = start.x !== nextViewport.x || start.y !== nextViewport.y || start.scale !== nextViewport.scale
      || (incoming && Object.values(incoming.velocity).some((speed) => Math.abs(speed) > 1e-6));
    if (changed) invalidateCreationSequence();
    if (!reducedMotion && changed && workspacePlaneRef.current?.animate) {
      const motion = navigationViewportMotion(start, nextViewport, incoming?.velocity, incoming?.acceleration);
      const timing = { duration: motion.duration, easing: 'linear', fill: 'both' as const };
      let animation: Animation;
      if (active?.animation.effect instanceof KeyframeEffect) {
        animation = active.animation;
        active.animation.effect.setKeyframes(motion.keyframes);
        active.animation.effect.updateTiming(timing);
      } else {
        cancelViewportAnimation();
        animation = workspacePlaneRef.current.animate(motion.keyframes, timing);
      }
      // Share the sampled frame's clock instead of waiting for a new animation's ready frame.
      if (document.timeline.currentTime !== null) animation.startTime = document.timeline.currentTime;
      activeViewportMotion.current = { animation, motion };
      animation.onfinish = () => {
        if (activeViewportMotion.current?.animation !== animation || pendingViewportRestore.current?.id !== id) return;
        activeViewportMotion.current = undefined;
        navigationMayBeMoving.current = false;
        setNavigationMotion(false);
        animation.cancel();
        pendingViewportRestore.current = undefined;
        pending.onSettled();
      };
      setNavigationMotion(true);
    } else {
      cancelViewportAnimation();
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
    const current = navigationMayBeMoving.current
      ? displayedWorkspaceViewport(workspacePlaneRef.current) ?? viewportRef.current
      : viewportRef.current;
    const sequence = creationSequence.current;
    const position = sheetCreationPlacement(measureSurfaceSize(workspace), current, sequence.position);
    onCreateSheet(position, current.scale, 'Create sheet at viewport center', () => {
      if (creationSequence.current.revision === sequence.revision) creationSequence.current.position = position;
    });
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

function viewportTransform(viewport: WorkspaceViewport) {
  return `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`;
}
