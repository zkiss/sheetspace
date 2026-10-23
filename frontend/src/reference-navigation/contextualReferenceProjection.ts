import { rangeReferenceIdentity, type FormulaReferenceIdentity } from '@workbook/core/referenceIdentity';
import { createSheetGridAxisMetrics } from '@grid/gridAxisMetrics';
import { projectGridAxes } from '@grid/gridAxisProjection';
import { GRID_COLUMN_HEADER_HEIGHT, GRID_ROW_HEADER_WIDTH } from '@grid/gridGeometry';
import { type FormulaInspectionReference, type FormulaReferenceTarget } from './formulaInspection';
import type { SheetDocument, SheetFrameProjection, SheetFrameSize, Workbook } from '@workbook/core/model';
import type { WorkspaceViewport } from '@workspace/workspaceContracts';
import { sheetFrameBodyGeometry, workspaceRectForFrame, workspaceRectsIntersect, type WorkspaceTargetRect } from '@workspace/workspaceGeometry';

export type ContextualReference = {
  reference: FormulaInspectionReference;
  identity?: FormulaReferenceIdentity;
  color?: string;
};

export type GridReferenceViewport = {
  scrollLeft: number;
  scrollTop: number;
  /** The body client area, excluding the sheet title but including sticky headers. */
  size: SheetFrameSize;
  mounted?: boolean;
  renderingMode?: 'detailed' | 'overview';
};

export type ProjectedReferenceGeometry =
  | { kind: 'visible'; rect: WorkspaceTargetRect }
  | { kind: 'unavailable'; reason: 'broken' | 'unmounted' | 'overview' | 'offscreen' | 'clipped' | 'occluded' };

/**
 * Converts inspected formula tokens into the shared, durable identities used by
 * editor token colours, source highlights, and reference links.
 */
export function contextualReferences(references: readonly FormulaInspectionReference[]): readonly ContextualReference[] {
  return references.map((reference, index) => {
    const identity = identityForTarget(reference.target);
    return { reference, identity, color: reference.broken ? undefined : referenceColour(index) };
  });
}

function referenceColour(index: number): string {
  const hue = (index * 137.508) % 360;
  const lightness = 34 + Math.floor(index / 360) % 3 * 9;
  return `hsl(${hue.toFixed(3)} 78% ${lightness}%)`;
}

/**
 * Projects durable target identities without reading mounted grid cells. A target
 * is visible only when its complete cell or range can be represented accurately;
 * callers must expose unavailable targets through their source-navigation UI.
 */
export function projectReferenceGeometry({
  reference,
  workbook,
  frames,
  gridViewports,
  workspaceViewport,
  surfaceSize,
}: {
  reference: FormulaInspectionReference;
  workbook: Workbook;
  /** Live frame projections, including in-progress movement and resize previews. */
  frames: readonly SheetFrameProjection[];
  gridViewports: Readonly<Record<string, GridReferenceViewport | undefined>>;
  workspaceViewport: WorkspaceViewport;
  surfaceSize: SheetFrameSize;
}): ProjectedReferenceGeometry {
  if (reference.broken || !reference.navigable) return { kind: 'unavailable', reason: 'broken' };
  const sheet = workbook.documents[reference.target.sheetId];
  const frame = frames.find((candidate) => candidate.id === reference.target.sheetId);
  const gridViewport = gridViewports[reference.target.sheetId];
  if (!sheet || !frame || !gridViewport || gridViewport.mounted === false) return { kind: 'unavailable', reason: 'unmounted' };
  if (gridViewport.renderingMode === 'overview') return { kind: 'unavailable', reason: 'overview' };

  const logicalRect = targetLogicalRect(reference.target, sheet);
  if (!logicalRect) return { kind: 'unavailable', reason: 'broken' };
  const body = sheetFrameBodyGeometry(frame.size);
  const viewport = {
    left: frame.position.x + (body.left + GRID_ROW_HEADER_WIDTH) * frame.visualScale,
    top: frame.position.y + (body.top + GRID_COLUMN_HEADER_HEIGHT) * frame.visualScale,
    right: frame.position.x + (body.left + Math.min(body.width, gridViewport.size.width)) * frame.visualScale,
    bottom: frame.position.y + (body.top + Math.min(body.height, gridViewport.size.height)) * frame.visualScale,
  };
  if (viewport.right <= viewport.left || viewport.bottom <= viewport.top) return { kind: 'unavailable', reason: 'clipped' };
  const target = {
    left: frame.position.x + (body.left + GRID_ROW_HEADER_WIDTH + logicalRect.left - safeOffset(gridViewport.scrollLeft)) * frame.visualScale,
    top: frame.position.y + (body.top + GRID_COLUMN_HEADER_HEIGHT + logicalRect.top - safeOffset(gridViewport.scrollTop)) * frame.visualScale,
    right: frame.position.x + (body.left + GRID_ROW_HEADER_WIDTH + logicalRect.right - safeOffset(gridViewport.scrollLeft)) * frame.visualScale,
    bottom: frame.position.y + (body.top + GRID_COLUMN_HEADER_HEIGHT + logicalRect.bottom - safeOffset(gridViewport.scrollTop)) * frame.visualScale,
  };
  const clipped = intersect(target, viewport);
  if (!clipped) return { kind: 'unavailable', reason: 'offscreen' };
  // A partly hidden range is safe only when the visible portion remains a rectangle
  // entirely inside the body; cell targets fall back instead of suggesting a false anchor.
  if (reference.target.kind === 'cell' && !sameRect(target, clipped)) return { kind: 'unavailable', reason: 'clipped' };
  const surface = workspaceSurfaceRect(workspaceViewport, surfaceSize);
  const visible = intersect(clipped, surface);
  if (!visible) return { kind: 'unavailable', reason: 'offscreen' };
  if (!sameRect(clipped, visible)) return { kind: 'unavailable', reason: 'clipped' };
  if (frames.some((candidate) => candidate.id !== frame.id && candidate.zIndex > frame.zIndex
    && workspaceRectsIntersect(workspaceRectForFrame(candidate), visible))) {
    return { kind: 'unavailable', reason: 'occluded' };
  }
  return { kind: 'visible', rect: toSurfaceRect(visible, workspaceViewport) };
}

function identityForTarget(target: FormulaReferenceTarget): FormulaReferenceIdentity | undefined {
  if (target.kind === 'cell') return target.identity && { kind: 'cell', sheetId: target.sheetId, ...target.identity };
  return target.range && rangeReferenceIdentity(target.sheetId, target.range.start, target.range.end);
}

function targetLogicalRect(target: FormulaReferenceTarget, sheet: SheetDocument): WorkspaceTargetRect | undefined {
  const range = target.kind === 'cell' ? target.identity && { start: target.identity, end: target.identity } : target.range;
  if (!range) return undefined;
  const metrics = createSheetGridAxisMetrics(projectGridAxes(sheet.content), sheet.presentation);
  const columns = axisExtent(sheet.content.columns, range.start.columnId, range.end.columnId, metrics.columns);
  const rows = axisExtent(sheet.content.rows, range.start.rowId, range.end.rowId, metrics.rows);
  return columns && rows ? { left: columns.start, right: columns.end, top: rows.start, bottom: rows.end } : undefined;
}

function axisExtent(ids: readonly string[], first: string, second: string, axis: ReturnType<typeof createSheetGridAxisMetrics>['rows']) {
  const firstIndex = ids.indexOf(first);
  const secondIndex = ids.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0) return undefined;
  const startIndex = Math.min(firstIndex, secondIndex);
  const endIndex = Math.max(firstIndex, secondIndex);
  const start = axis.itemOffset(startIndex);
  const endOffset = axis.itemOffset(endIndex);
  const size = axis.itemSize(endIndex);
  return start === undefined || endOffset === undefined || size === undefined ? undefined : { start, end: endOffset + size };
}

function workspaceSurfaceRect(viewport: WorkspaceViewport, size: SheetFrameSize): WorkspaceTargetRect {
  const scale = safeScale(viewport.scale);
  return { left: -safeOffset(viewport.x) / scale, top: -safeOffset(viewport.y) / scale, right: (size.width - safeOffset(viewport.x)) / scale, bottom: (size.height - safeOffset(viewport.y)) / scale };
}
function toSurfaceRect(rect: WorkspaceTargetRect, viewport: WorkspaceViewport): WorkspaceTargetRect {
  const scale = safeScale(viewport.scale);
  return { left: rect.left * scale + safeOffset(viewport.x), top: rect.top * scale + safeOffset(viewport.y), right: rect.right * scale + safeOffset(viewport.x), bottom: rect.bottom * scale + safeOffset(viewport.y) };
}
function intersect(first: WorkspaceTargetRect, second: WorkspaceTargetRect): WorkspaceTargetRect | undefined {
  const left = Math.max(first.left, second.left); const top = Math.max(first.top, second.top);
  const right = Math.min(first.right, second.right); const bottom = Math.min(first.bottom, second.bottom);
  return left < right && top < bottom ? { left, top, right, bottom } : undefined;
}
function sameRect(first: WorkspaceTargetRect, second: WorkspaceTargetRect) { return first.left === second.left && first.top === second.top && first.right === second.right && first.bottom === second.bottom; }
function safeOffset(value: number) { return Number.isFinite(value) ? value : 0; }
function safeScale(value: number) { return Number.isFinite(value) && value > 0 ? value : 1; }
