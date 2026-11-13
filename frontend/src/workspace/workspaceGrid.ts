import type { WorkspaceViewport } from './workspaceContracts';

/** Grid lines are kept between 40 and 80 rendered pixels by promoting a level. */
export const WORKSPACE_GRID_MIN_RENDERED_SIZE = 40;
const WORKSPACE_GRID_COLOR = '200 214 219';

export type WorkspaceGridGeometry = {
  majorSize: number;
  majorX: number;
  majorY: number;
  minorSize: number;
  minorX: number;
  minorY: number;
  minorOpacity: number;
  fineSize: number;
  fineX: number;
  fineY: number;
  fineOpacity: number;
};

/**
 * Screen-space geometry for the background grid. A viewport coordinate moves
 * the pattern by the world offset it represents, so lines stay attached to
 * world coordinates instead of the surface.
 */
export function workspaceGridGeometry(viewport: WorkspaceViewport): WorkspaceGridGeometry {
  const majorSize = WORKSPACE_GRID_MIN_RENDERED_SIZE * 2 ** Math.ceil(Math.log2(1 / viewport.scale)) * viewport.scale;
  const minorSize = majorSize / 2;
  const fineSize = minorSize / 2;
  const phase = Math.max(0, Math.min(1, (majorSize - WORKSPACE_GRID_MIN_RENDERED_SIZE) / WORKSPACE_GRID_MIN_RENDERED_SIZE));
  return {
    majorSize,
    majorX: viewport.x % majorSize,
    majorY: viewport.y % majorSize,
    minorSize,
    minorX: viewport.x % minorSize,
    minorY: viewport.y % minorSize,
    minorOpacity: 0.35 + 0.65 * phase,
    fineSize,
    fineX: viewport.x % fineSize,
    fineY: viewport.y % fineSize,
    fineOpacity: 0.35 * phase,
  };
}

/**
 * Redraws the grid onto a canvas that covers the workspace surface. A canvas
 * costs one cheap drawing pass per frame, while moving a scaled CSS gradient
 * layer makes the browser re-rasterize it on every zoom frame.
 */
export function drawWorkspaceGrid(canvas: HTMLCanvasElement, viewport: WorkspaceViewport): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width <= 0 || height <= 0) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  const pixelRatio = canvas.ownerDocument.defaultView?.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * pixelRatio);
  const pixelHeight = Math.round(height * pixelRatio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const geometry = workspaceGridGeometry(viewport);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  drawGridLines(context, width, height, geometry.fineSize, geometry.fineX, geometry.fineY, geometry.fineOpacity);
  drawGridLines(context, width, height, geometry.minorSize, geometry.minorX, geometry.minorY, geometry.minorOpacity);
  drawGridLines(context, width, height, geometry.majorSize, geometry.majorX, geometry.majorY, 1);
}

function drawGridLines(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  size: number,
  offsetX: number,
  offsetY: number,
  opacity: number,
): void {
  if (!(size > 1) || opacity <= 0) return;
  const startX = positiveModulo(offsetX, size);
  const startY = positiveModulo(offsetY, size);
  context.strokeStyle = `rgb(${WORKSPACE_GRID_COLOR} / ${opacity})`;
  context.lineWidth = 1;
  context.beginPath();
  for (let x = startX; x <= width; x += size) {
    const line = Math.floor(x) + 0.5;
    context.moveTo(line, 0);
    context.lineTo(line, height);
  }
  for (let y = startY; y <= height; y += size) {
    const line = Math.floor(y) + 0.5;
    context.moveTo(0, line);
    context.lineTo(width, line);
  }
  context.stroke();
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
