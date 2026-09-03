import type { MouseEvent, PointerEvent, ReactNode, RefObject, WheelEvent } from 'react';
import type { WorkspaceViewport } from '@app/contracts';
import '@workspace/WorkspaceSurface.css';

export function WorkspaceSurface({
  children,
  contextMenu,
  hasSheets,
  isPanningWorkspace,
  navigationMotion,
  onContextMenu,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  viewport,
  workspaceSurfaceRef,
}: {
  children: ReactNode;
  contextMenu?: ReactNode;
  hasSheets: boolean;
  isPanningWorkspace: boolean;
  navigationMotion: boolean;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onWheel: (event: WheelEvent<HTMLElement>) => void;
  viewport: WorkspaceViewport;
  workspaceSurfaceRef: RefObject<HTMLElement>;
}) {
  return (
    <section
      aria-label="Spatial workspace"
      className={`workspace-surface${isPanningWorkspace ? ' workspace-surface-panning' : ''}`}
      data-viewport-scale={viewport.scale}
      data-viewport-x={viewport.x}
      data-viewport-y={viewport.y}
      data-testid="workspace-surface"
      onContextMenu={onContextMenu}
      onPointerCancel={onPointerCancel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
      ref={workspaceSurfaceRef}
    >
      {!hasSheets ? (
        <p className="empty-workspace">Right-click the workspace or use New sheet to create a sheet.</p>
      ) : null}

      <div
        className={`workspace-plane${navigationMotion ? ' workspace-plane-navigating' : ''}`}
        data-navigation-motion={navigationMotion ? 'smooth' : 'instant'}
        data-testid="workspace-plane"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        {children}
      </div>

      {contextMenu}
    </section>
  );
}
