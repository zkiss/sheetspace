import type { WorkspaceTargetRect } from '@workspace/workspaceGeometry';

type Point = { x: number; y: number };

export function referenceLineEndpoints(source: WorkspaceTargetRect, target: WorkspaceTargetRect | Point) {
  const sourceCenter = rectCenter(source);
  const targetCenter = 'left' in target ? rectCenter(target) : target;
  return {
    source: facingEdge(source, targetCenter),
    target: 'left' in target ? facingEdge(target, sourceCenter) : target,
  };
}

function rectCenter(rect: WorkspaceTargetRect): Point {
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
}

function facingEdge(rect: WorkspaceTargetRect, toward: Point): Point {
  const center = rectCenter(rect);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return { x: rect.right, y: center.y };
  const fraction = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : (rect.right - rect.left) / (2 * Math.abs(dx)),
    dy === 0 ? Number.POSITIVE_INFINITY : (rect.bottom - rect.top) / (2 * Math.abs(dy)),
  );
  return { x: center.x + dx * fraction, y: center.y + dy * fraction };
}
