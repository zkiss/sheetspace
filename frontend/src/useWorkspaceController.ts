import { MouseEvent, PointerEvent, useRef, useState, WheelEvent } from 'react';
import type { PendingSheetMenu, WorkspaceViewport } from './appTypes';
import type { WorkspacePosition } from './workbook';
import {
  clampWorkspaceZoom,
  getViewportCenter,
  getWorkspacePoint,
  WORKSPACE_ZOOM_STEP,
} from './workspaceGeometry';

export function useWorkspaceController({
  onCreateSheet,
}: {
  onCreateSheet: (position: WorkspacePosition, label: string) => void;
}) {
  const [viewport, setViewport] = useState<WorkspaceViewport>({ x: 0, y: 0, scale: 1 });
  const [pendingSheetMenu, setPendingSheetMenu] = useState<PendingSheetMenu | null>(null);
  const [isPanningWorkspace, setIsPanningWorkspace] = useState(false);
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
    setViewport((currentViewport) => {
      const scale = clampWorkspaceZoom(nextScale);
      const zoomOrigin = origin ?? { x: 0, y: 0 };
      const workspaceOrigin = {
        x: (zoomOrigin.x - currentViewport.x) / currentViewport.scale,
        y: (zoomOrigin.y - currentViewport.y) / currentViewport.scale,
      };

      return {
        x: Math.round(zoomOrigin.x - workspaceOrigin.x * scale),
        y: Math.round(zoomOrigin.y - workspaceOrigin.y * scale),
        scale,
      };
    });
  }

  function resetViewport() {
    setViewport({ x: 0, y: 0, scale: 1 });
  }

  function createSheetAtViewportCenter(workspace: HTMLElement) {
    closeSheetMenu();
    onCreateSheet(getViewportCenter(workspace, viewport), 'Create sheet at viewport center');
  }

  function handleWorkspaceContextMenu(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    closeSheetMenu();
    onCreateSheet(getWorkspacePoint(event, event.currentTarget, viewport), 'Create sheet here');
  }

  function handleWorkspacePointerDown(event: PointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('.sheet-context-menu')) {
      return;
    }

    closeSheetMenu();

    if (
      (event.button !== 0 && event.button !== undefined) ||
      (event.target as HTMLElement).closest('[data-testid="sheet-frame"]')
    ) {
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
    if ((event.target as HTMLElement).closest('[data-testid="sheet-frame"]')) {
      return;
    }

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const origin = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
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
    openSheetMenu,
    panWorkspace,
    pendingSheetMenu,
    resetViewport,
    stopWorkspacePan,
    viewport,
    zoomWorkspace,
  };
}
