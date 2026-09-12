import { MouseEvent, useLayoutEffect, useRef, useState } from 'react';
import { useWorkspaceGestures } from './useWorkspaceGestures';
import { displayedWorkspaceViewport } from './workspaceViewportMotion';
import type { PendingSheetMenu, WorkspaceViewport } from './workspaceContracts';
import { SheetFrameSize, WorkspacePosition } from '@workbook/core/model';
import {
  addFiniteWorkspaceCoordinate,
  surfaceSize as measureSurfaceSize,
  viewportForTarget,
  workspacePointAtViewportCenter,
  workspacePointFromClient,
  type WorkspaceTargetRect,
  zoomScaleBy,
  zoomViewportAt,
} from '@workspace/workspaceGeometry';

export function useWorkspaceController({
  onCreateSheet,
}: {
  onCreateSheet: (position: WorkspacePosition, label: string) => void;
}) {
  const [viewport, setViewport] = useState<WorkspaceViewport>({ x: 0, y: 0, scale: 1 });
  const [pendingSheetMenu, setPendingSheetMenu] = useState<PendingSheetMenu | null>(null);
  const [navigationInterrupted, setNavigationInterrupted] = useState(false);
  const [workspaceSurfaceSize, setWorkspaceSurfaceSize] = useState<SheetFrameSize | null>(null);
  const workspaceSurfaceRef = useRef<HTMLElement | null>(null);
  const workspacePlaneRef = useRef<HTMLDivElement | null>(null);
  const navigationMayBeMoving = useRef(false);
  const isPanningWorkspace = useWorkspaceGestures(workspaceSurfaceRef, {
    start: interruptNavigation, pan: panWorkspace, zoom: zoomWorkspaceBy, closeMenu: closeSheetMenu,
  });

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

  function openSheetMenu(sheetId: string, event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setPendingSheetMenu({
      sheetId,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function interruptNavigation() {
    // Read before React removes the transition, and only once even for batched inputs.
    if (navigationMayBeMoving.current) {
      navigationMayBeMoving.current = false;
      const displayed = displayedWorkspaceViewport(workspacePlaneRef.current);
      if (displayed) setViewport(displayed);
    }
    setNavigationInterrupted(true);
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
    navigationMayBeMoving.current = false;
    setNavigationInterrupted(true);
    setViewport({ x: 0, y: 0, scale: 1 });
  }

  function navigateToTarget(
    target: WorkspaceTargetRect,
    forceOversized = false,
  ) {
    const workspace = workspaceSurfaceRef.current;
    if (!workspace) return;
    const { height: surfaceHeight, width: surfaceWidth } = measureSurfaceSize(workspace);
    navigationMayBeMoving.current = true;
    setNavigationInterrupted(false);
    setViewport((currentViewport) =>
      viewportForTarget({
        currentViewport,
        surfaceHeight,
        surfaceWidth,
        target,
        forceOversized,
      }).viewport,
    );
  }

  function createSheetAtViewportCenter() {
    const workspace = workspaceSurfaceRef.current;
    if (!workspace) return;
    closeSheetMenu();
    onCreateSheet(sheetFramePosition(workspacePointAtViewportCenter(workspace, viewport)), 'Create sheet at viewport center');
  }

  function handleWorkspaceContextMenu(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    closeSheetMenu();
    onCreateSheet(sheetFramePosition(workspacePointFromClient(
      { x: event.clientX, y: event.clientY },
      event.currentTarget,
      viewport,
    )), 'Create sheet here');
  }

  return {
    closeSheetMenu,
    createSheetAtViewportCenter,
    handleWorkspaceContextMenu,
    isPanningWorkspace,
    navigationInterrupted,
    navigateToTarget,
    openSheetMenu,
    panWorkspace,
    pendingSheetMenu,
    resetViewport,
    viewport,
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
