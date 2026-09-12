import type { MouseEvent, ReactNode, RefObject } from 'react';
import type { WorkspaceViewport } from './workspaceContracts';
import '@workspace/WorkspaceSurface.css';

export function WorkspaceSurface({
  children,
  contextMenu,
  hasSheets,
  isPanningWorkspace,
  navigationMotion,
  onContextMenu,
  viewport,
  workspacePlaneRef,
  workspaceSurfaceRef,
}: {
  children: ReactNode;
  contextMenu?: ReactNode;
  hasSheets: boolean;
  isPanningWorkspace: boolean;
  navigationMotion: boolean;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  viewport: WorkspaceViewport;
  workspacePlaneRef: RefObject<HTMLDivElement>;
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
      ref={workspaceSurfaceRef}
    >
      {!hasSheets ? (
        <p className="empty-workspace">Right-click the workspace or use New sheet to create a sheet.</p>
      ) : null}

      <div
        className={`workspace-plane${navigationMotion ? ' workspace-plane-navigating' : ''}`}
        data-navigation-motion={navigationMotion ? 'smooth' : 'instant'}
        data-testid="workspace-plane"
        ref={workspacePlaneRef}
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
