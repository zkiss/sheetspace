import type { SheetFrameProjection, SheetFrameSize, WorkspacePosition } from '@workbook/core/model';
import type { WorkspaceViewport } from './workspaceContracts';
import { workspaceRectForFrame, workspaceViewportBounds, type WorkspaceTargetRect } from './workspaceGeometry';

const LIMIT = Number.MAX_VALUE;

type Frame = Pick<SheetFrameProjection, 'position' | 'size' | 'visualScale'>;
export type MinimapProjection = { world: WorkspaceTargetRect; scale: number; offset: WorkspacePosition };

function bounded(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(-LIMIT, Math.min(LIMIT, value));
}

function rect(bounds: WorkspaceTargetRect): WorkspaceTargetRect {
  return { left: bounded(bounds.left), top: bounded(bounds.top), right: bounded(bounds.right), bottom: bounded(bounds.bottom) };
}

function halfSpan(start: number, end: number): number {
  return end / 2 - start / 2;
}

function projectedDistance(start: number, end: number, scale: number): number {
  return (end / 2 - start / 2) * scale * 2;
}

function worldCoordinate(start: number, distance: number, scale: number): number {
  const delta = distance / scale;
  if (Number.isFinite(delta)) return bounded(start + delta);
  return bounded((start / 2 + distance / (scale * 2)) * 2);
}

export function minimapProjection(
  frames: readonly Frame[], surface: SheetFrameSize, viewport: WorkspaceViewport, size: SheetFrameSize, padding = 8,
): MinimapProjection | null {
  if (!(size.width > 0 && size.height > 0 && surface.width > 0 && surface.height > 0)
    || !Number.isFinite(size.width) || !Number.isFinite(size.height)
    || !Number.isFinite(surface.width) || !Number.isFinite(surface.height)) return null;
  const world = rect(workspaceViewportBounds(surface, viewport));
  for (const frame of frames) {
    const sheet = rect(workspaceRectForFrame(frame));
    world.left = Math.min(world.left, sheet.left);
    world.top = Math.min(world.top, sheet.top);
    world.right = Math.max(world.right, sheet.right);
    world.bottom = Math.max(world.bottom, sheet.bottom);
  }
  const inset = Math.max(0, Math.min(Number.isFinite(padding) ? padding : 0, size.width / 4, size.height / 4));
  const scale = Math.min((size.width / 2 - inset) / Math.max(0.5, halfSpan(world.left, world.right)),
    (size.height / 2 - inset) / Math.max(0.5, halfSpan(world.top, world.bottom)));
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  return {
    world, scale,
    offset: { x: (size.width - projectedDistance(world.left, world.right, scale)) / 2,
      y: (size.height - projectedDistance(world.top, world.bottom, scale)) / 2 },
  };
}

export function minimapPoint(projection: MinimapProjection, point: WorkspacePosition): WorkspacePosition {
  return { x: bounded(projection.offset.x + projectedDistance(projection.world.left, bounded(point.x), projection.scale)),
    y: bounded(projection.offset.y + projectedDistance(projection.world.top, bounded(point.y), projection.scale)) };
}

export function minimapRect(projection: MinimapProjection, bounds: WorkspaceTargetRect): WorkspaceTargetRect {
  const start = minimapPoint(projection, { x: bounds.left, y: bounds.top });
  const end = minimapPoint(projection, { x: bounds.right, y: bounds.bottom });
  return { left: start.x, top: start.y, right: end.x, bottom: end.y };
}

export function minimapWorldPoint(projection: MinimapProjection, point: WorkspacePosition): WorkspacePosition {
  return { x: worldCoordinate(projection.world.left, point.x - projection.offset.x, projection.scale),
    y: worldCoordinate(projection.world.top, point.y - projection.offset.y, projection.scale) };
}

export function minimapCenteredViewport(
  projection: MinimapProjection, point: WorkspacePosition, surface: SheetFrameSize, viewport: WorkspaceViewport,
): WorkspaceViewport {
  const world = minimapWorldPoint(projection, point);
  return { x: bounded(surface.width / 2 - world.x * viewport.scale),
    y: bounded(surface.height / 2 - world.y * viewport.scale), scale: viewport.scale };
}

export function minimapDraggedViewport(
  projection: MinimapProjection, start: WorkspacePosition, current: WorkspacePosition, viewport: WorkspaceViewport,
): WorkspaceViewport {
  return { x: bounded(viewport.x - (current.x - start.x) / projection.scale * viewport.scale),
    y: bounded(viewport.y - (current.y - start.y) / projection.scale * viewport.scale), scale: viewport.scale };
}
