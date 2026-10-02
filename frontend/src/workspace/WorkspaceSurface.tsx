import type { CSSProperties, MouseEvent, ReactNode, RefObject } from 'react';
import type { WorkspaceViewport } from './workspaceContracts';
import '@workspace/WorkspaceSurface.css';

export function WorkspaceSurface({
  children,
  contextMenu,
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
  // Keep the primary grid between 40 and 80 rendered pixels. Crossing a zoom
  // level promotes the current small grid and reveals its next subdivision.
  const gridWorldSize = 40 * 2 ** Math.ceil(Math.log2(1 / viewport.scale));
  const majorGridSize = gridWorldSize * viewport.scale;
  const minorGridSize = majorGridSize / 2;
  const fineGridSize = minorGridSize / 2;
  const zoomPhase = Math.max(0, Math.min(1, (majorGridSize - 40) / 40));
  const gridStyle = {
    '--workspace-grid-major-size': `${majorGridSize}px`,
    '--workspace-grid-major-x': `${viewport.x % majorGridSize}px`,
    '--workspace-grid-major-y': `${viewport.y % majorGridSize}px`,
    '--workspace-grid-minor-size': `${minorGridSize}px`,
    '--workspace-grid-minor-x': `${viewport.x % minorGridSize}px`,
    '--workspace-grid-minor-y': `${viewport.y % minorGridSize}px`,
    '--workspace-grid-minor-opacity': String(0.35 + 0.65 * zoomPhase),
    '--workspace-grid-fine-size': `${fineGridSize}px`,
    '--workspace-grid-fine-x': `${viewport.x % fineGridSize}px`,
    '--workspace-grid-fine-y': `${viewport.y % fineGridSize}px`,
    '--workspace-grid-fine-opacity': String(0.35 * zoomPhase),
  } as CSSProperties;
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
      style={gridStyle}
    >
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
