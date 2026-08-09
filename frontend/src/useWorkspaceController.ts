import { MouseEvent, PointerEvent, useRef, useState, WheelEvent } from 'react';
import type { PendingSheetMenu, WorkspaceViewport } from './appTypes';
import type { WorkspacePosition } from './workbook';
import {
  surfacePointFromClient,
  surfaceSize,
  viewportForTarget,
  workspacePointAtViewportCenter,
  workspacePointFromClient,
  type WorkspaceTargetRect,
  WORKSPACE_ZOOM_STEP,
  zoomViewportAt,
} from './workspaceGeometry';

export function useWorkspaceController({
  onCreateSheet,
}: {
  onCreateSheet: (position: WorkspacePosition, label: string) => void;
}) {
  const [viewport, setViewport] = useState<WorkspaceViewport>({ x: 0, y: 0, scale: 1 });
  const [pendingSheetMenu, setPendingSheetMenu] = useState<PendingSheetMenu | null>(null);
  const [isPanningWorkspace, setIsPanningWorkspace] = useState(false);
  const workspaceSurfaceRef = useRef<HTMLElement | null>(null);
  const panDrag = useRef<{ pointerId: number; clientX: number; clientY: number } | null>(null);

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

  function panWorkspace(deltaX: number, deltaY: number) {
    setViewport((currentViewport) => ({
      ...currentViewport,
      x: currentViewport.x + deltaX,
      y: currentViewport.y + deltaY,
    }));
  }

  function zoomWorkspace(nextScale: number, origin?: WorkspacePosition) {
    setViewport((currentViewport) => zoomViewportAt(currentViewport, nextScale, origin));
  }

  function resetViewport() {
    setViewport({ x: 0, y: 0, scale: 1 });
  }

  function navigateToTarget(
    target: WorkspaceTargetRect,
    forceOversized = false,
  ) {
    const workspace = workspaceSurfaceRef.current;
    if (!workspace) return;
    const { height: surfaceHeight, width: surfaceWidth } = surfaceSize(workspace);
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
    onCreateSheet(workspacePointAtViewportCenter(workspace, viewport), 'Create sheet at viewport center');
  }

  function handleWorkspaceContextMenu(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    closeSheetMenu();
    onCreateSheet(workspacePointFromClient(
      { x: event.clientX, y: event.clientY },
      event.currentTarget,
      viewport,
    ), 'Create sheet here');
  }

  function handleWorkspacePointerDown(event: PointerEvent<HTMLElement>) {
    closeSheetMenu();

    if (event.button !== 0 && event.button !== undefined) {
      return;
    }

    panDrag.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    setIsPanningWorkspace(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleWorkspacePointerMove(event: PointerEvent<HTMLElement>) {
    if (!panDrag.current || panDrag.current.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - panDrag.current.clientX;
    const deltaY = event.clientY - panDrag.current.clientY;
    panDrag.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    panWorkspace(deltaX, deltaY);
  }

  function stopWorkspacePan(event: PointerEvent<HTMLElement>) {
    if (!panDrag.current || panDrag.current.pointerId !== event.pointerId) {
      return;
    }

    panDrag.current = null;
    setIsPanningWorkspace(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function handleWorkspaceWheel(event: WheelEvent<HTMLElement>) {
    event.preventDefault();
    const origin = surfacePointFromClient(
      { x: event.clientX, y: event.clientY },
      event.currentTarget,
    );
    const delta = event.deltaY < 0 ? WORKSPACE_ZOOM_STEP : -WORKSPACE_ZOOM_STEP;
    zoomWorkspace(viewport.scale + delta, origin);
  }

  return {
    closeSheetMenu,
    createSheetAtViewportCenter,
    handleWorkspaceContextMenu,
    handleWorkspacePointerDown,
    handleWorkspacePointerMove,
    handleWorkspaceWheel,
    isPanningWorkspace,
    navigateToTarget,
    openSheetMenu,
    panWorkspace,
    pendingSheetMenu,
    resetViewport,
    stopWorkspacePan,
    viewport,
    workspaceSurfaceRef,
    zoomWorkspace,
  };
}
