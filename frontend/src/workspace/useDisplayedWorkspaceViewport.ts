import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { WorkspaceViewport } from './workspaceContracts';
import { displayedWorkspaceViewport } from './workspaceViewportMotion';

export function useDisplayedWorkspaceViewport(planeRef: RefObject<HTMLElement>, viewport: WorkspaceViewport, shouldRender?: (viewport: WorkspaceViewport) => boolean, onMotionSample?: (viewport: WorkspaceViewport) => void) {
  const [displayedViewport, setDisplayedViewport] = useState(viewport);
  const shouldRenderRef = useRef(shouldRender);
  shouldRenderRef.current = shouldRender;
  const onMotionSampleRef = useRef(onMotionSample);
  onMotionSampleRef.current = onMotionSample;

  useLayoutEffect(() => {
    let animationFrame: number | undefined;
    let wasRunning = false;
    const sample = () => {
      const plane = planeRef.current;
      const next = displayedWorkspaceViewport(plane) ?? viewport;
      const running = plane?.getAnimations().some((animation) => animation.playState === 'running') ?? false;
      if (running || wasRunning) onMotionSampleRef.current?.(next);
      wasRunning = running;
      if (!running || !shouldRenderRef.current || shouldRenderRef.current(next)) {
        setDisplayedViewport((current) => current.x === next.x && current.y === next.y && current.scale === next.scale
          ? current : next);
      }
      if (running) {
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
