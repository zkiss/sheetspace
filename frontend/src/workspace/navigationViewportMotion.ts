import type { WorkspaceViewport } from './workspaceContracts';
import { clampWorkspaceZoom, WORKSPACE_NAVIGATION_TRANSITION_MS } from './workspaceGeometry';

type ViewportVelocity = { x: number; y: number; scale: number };

/** Preserve velocity and acceleration when steering, then settle at rest. */
export function navigationViewportMotion(start: WorkspaceViewport, target: WorkspaceViewport, velocity: ViewportVelocity = { x: 0, y: 0, scale: 0 }, acceleration: ViewportVelocity = { x: 0, y: 0, scale: 0 }) {
  const duration = WORKSPACE_NAVIGATION_TRANSITION_MS;
  function sample(time: number) {
    const progress = Math.max(0, Math.min(1, time / duration));
    const remaining = 1 - progress;
    const t2 = progress * progress, t3 = t2 * progress, t4 = t3 * progress, t5 = t4 * progress;
    const blend = 10 * t3 - 15 * t4 + 6 * t5;
    const tangent = progress - 6 * t3 + 8 * t4 - 3 * t5;
    const curvature = .5 * t2 * remaining ** 3;
    const axis = (from: number, to: number, speed: number, rate: number) => ({
      position: from + (to - from) * blend + speed * duration * tangent + rate * duration ** 2 * curvature,
      speed: (to - from) * 30 * t2 * remaining ** 2 / duration
        + speed * (1 - 18 * t2 + 32 * t3 - 15 * t4)
        + rate * duration * .5 * (2 * progress - 9 * t2 + 12 * t3 - 5 * t4),
      acceleration: (to - from) * 60 * progress * remaining * (1 - 2 * progress) / duration ** 2
        + speed * (-36 * progress + 96 * t2 - 60 * t3) / duration
        + rate * (1 - 9 * progress + 18 * t2 - 10 * t3),
    });
    const x = axis(start.x, target.x, velocity.x, acceleration.x);
    const y = axis(start.y, target.y, velocity.y, acceleration.y);
    const zoom = axis(start.scale, target.scale, velocity.scale, acceleration.scale);
    const scale = clampWorkspaceZoom(zoom.position);
    return {
      viewport: { x: x.position, y: y.position, scale },
      velocity: { x: x.speed, y: y.speed, scale: scale === zoom.position ? zoom.speed : 0 },
      acceleration: { x: x.acceleration, y: y.acceleration, scale: scale === zoom.position ? zoom.acceleration : 0 },
    };
  }
  const keyframes = Array.from({ length: 81 }, (_, index) => {
    const offset = index / 80;
    const { viewport } = sample(offset * duration);
    return { offset, transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` };
  });
  return { duration, keyframes, sample };
}
