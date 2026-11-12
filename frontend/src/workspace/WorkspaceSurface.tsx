import type { MouseEvent, ReactNode, RefObject } from 'react';
import type { WorkspaceViewport } from './workspaceContracts';
import '@workspace/WorkspaceSurface.css';

export function WorkspaceSurface({
  children,
  contextMenu,
  concealBackground,
  concealPeers,
  hasSheets,
  isPanningWorkspace,
  navigationMotion,
  onCreateSheet,
  onContextMenu,
  overlay,
  viewport,
  workspacePlaneRef,
  workspaceSurfaceRef,
}: {
  children: ReactNode;
  contextMenu?: ReactNode;
  concealBackground?: boolean;
  concealPeers?: boolean;
  hasSheets: boolean;
  isPanningWorkspace: boolean;
  navigationMotion: boolean;
  onCreateSheet?: () => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
  overlay?: ReactNode;
  viewport: WorkspaceViewport;
  workspacePlaneRef: RefObject<HTMLDivElement>;
  workspaceSurfaceRef: RefObject<HTMLElement>;
}) {
  return (
    <section
      aria-label="Spatial workspace"
      className={`workspace-surface${isPanningWorkspace ? ' workspace-surface-panning' : ''}${concealBackground ? ' workspace-surface-concealed' : ''}`}
      data-viewport-scale={viewport.scale}
      data-viewport-x={viewport.x}
      data-viewport-y={viewport.y}
      data-testid="workspace-surface"
      onContextMenu={onContextMenu}
      ref={workspaceSurfaceRef}
    >
      <canvas aria-hidden="true" className="workspace-grid" />
      <div
        className={`workspace-plane${navigationMotion ? ' workspace-plane-navigating' : ''}`}
        data-navigation-motion={navigationMotion ? 'smooth' : 'instant'}
        data-testid="workspace-plane"
        data-conceal-peers={concealPeers ? 'true' : undefined}
        ref={workspacePlaneRef}
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        {children}
      </div>

      {contextMenu}
      {overlay}
      {!hasSheets ? (
        <div className="empty-workspace">
          <p>Start by placing your first sheet.</p>
          <button onClick={onCreateSheet} type="button">Create your first sheet</button>
        </div>
      ) : null}
    </section>
  );
}
