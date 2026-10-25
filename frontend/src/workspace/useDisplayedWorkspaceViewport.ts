import { useLayoutEffect, useState, type RefObject } from 'react';
import type { WorkspaceViewport } from './workspaceContracts';
import { displayedWorkspaceViewport } from './workspaceViewportMotion';

export function useDisplayedWorkspaceViewport(planeRef: RefObject<HTMLElement>, viewport: WorkspaceViewport) {
  const [displayedViewport, setDisplayedViewport] = useState(viewport);

  useLayoutEffect(() => {
    let animationFrame: number | undefined;
    const sample = () => {
      const plane = planeRef.current;
      const next = displayedWorkspaceViewport(plane) ?? viewport;
      setDisplayedViewport((current) => current.x === next.x && current.y === next.y && current.scale === next.scale
        ? current : next);
      if (plane?.getAnimations().some((animation) => animation.playState === 'running')) {
        animationFrame = requestAnimationFrame(sample);
      }
    };
    sample();
    return () => {
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
    };
  }, [planeRef, viewport]);

  return displayedViewport;
}
