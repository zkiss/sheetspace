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

type Term = { factors: number[]; divisor?: number };

function differenceTerms(value: number, start: number, factors: number[], divisor?: number): Term[] {
  const difference = value - start;
  return Number.isFinite(difference)
    ? [{ factors: [difference, ...factors], divisor }]
    : [{ factors: [value, ...factors], divisor }, { factors: [-start, ...factors], divisor }];
}

function affine(terms: Term[]): number {
  const normalized = terms.map(({ factors, divisor = 1 }) => {
    let mantissa = 1;
    let exponent = 0;
    for (const [value, direction] of [...factors.map((factor) => [factor, 1]), [divisor, -1]]) {
      if (value === 0) return { mantissa: 0, exponent: 0 };
      const power = Math.max(-1074, Math.min(1023, Math.floor(Math.log2(Math.abs(value)))));
      const part = value / 2 ** power;
      mantissa = direction === 1 ? mantissa * part : mantissa / part;
      exponent += direction * power;
    }
    return { mantissa, exponent };
  }).filter(({ mantissa }) => mantissa !== 0);
  if (normalized.length === 0) return 0;
  const exponent = Math.max(...normalized.map((term) => term.exponent));
  const sum = normalized.map((term) => term.exponent - exponent < -1074
    ? 0 : term.mantissa * 2 ** (term.exponent - exponent))
    .sort((a, b) => Math.abs(b) - Math.abs(a)).reduce((value, term) => value + term, 0);
  if (sum === 0) return 0;
  const power = Math.floor(Math.log2(Math.abs(sum)));
  const finalExponent = exponent + power;
  if (finalExponent > 1023) return Math.sign(sum) * LIMIT;
  if (finalExponent < -1075) return 0;
  if (finalExponent === -1075) return (sum / 2 ** power / 2) * Number.MIN_VALUE;
  return bounded((sum / 2 ** power) * 2 ** finalExponent);
}

function projectedDistance(start: number, end: number, scale: number): number {
  const difference = end - start;
  if (Number.isFinite(difference) && Number.isFinite(difference * scale)) return difference * scale;
  return affine([{ factors: [end, scale] }, { factors: [-start, scale] }]);
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
  const coordinate = (value: number, start: number, offset: number) => affine([
    { factors: [offset] }, ...differenceTerms(bounded(value), start, [projection.scale]),
  ]);
  return { x: coordinate(point.x, projection.world.left, projection.offset.x),
    y: coordinate(point.y, projection.world.top, projection.offset.y) };
}

export function minimapRect(projection: MinimapProjection, bounds: WorkspaceTargetRect): WorkspaceTargetRect {
  const start = minimapPoint(projection, { x: bounds.left, y: bounds.top });
  const end = minimapPoint(projection, { x: bounds.right, y: bounds.bottom });
  return { left: start.x, top: start.y, right: end.x, bottom: end.y };
}

export function minimapWorldPoint(projection: MinimapProjection, point: WorkspacePosition): WorkspacePosition {
  const coordinate = (value: number, start: number, offset: number) => affine([
    { factors: [start] }, ...differenceTerms(value, offset, [], projection.scale),
  ]);
  return { x: coordinate(point.x, projection.world.left, projection.offset.x),
    y: coordinate(point.y, projection.world.top, projection.offset.y) };
}

export function minimapCenteredViewport(
  projection: MinimapProjection, point: WorkspacePosition, surface: SheetFrameSize, viewport: WorkspaceViewport,
): WorkspaceViewport {
  const coordinate = (value: number, start: number, offset: number, extent: number) => affine([
    { factors: [extent / 2] }, { factors: [-start, viewport.scale] },
    ...differenceTerms(value, offset, [-viewport.scale], projection.scale),
  ]);
  return { x: coordinate(point.x, projection.world.left, projection.offset.x, surface.width),
    y: coordinate(point.y, projection.world.top, projection.offset.y, surface.height), scale: viewport.scale };
}

export function minimapDraggedViewport(
  projection: MinimapProjection, start: WorkspacePosition, current: WorkspacePosition, viewport: WorkspaceViewport,
): WorkspaceViewport {
  const coordinate = (initial: number, from: number, to: number) => from === to ? initial : affine([
    { factors: [initial] }, ...differenceTerms(to, from, [-viewport.scale], projection.scale),
  ]);
  return { x: coordinate(viewport.x, start.x, current.x),
    y: coordinate(viewport.y, start.y, current.y), scale: viewport.scale };
}
