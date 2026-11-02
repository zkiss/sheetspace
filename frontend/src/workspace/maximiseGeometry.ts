import type { SheetFrameSize, WorkspacePosition } from '@workbook/core/model';
import type { WorkspaceViewport } from './workspaceContracts';
import { clampSheetFrameSize, clampSheetVisualScale, effectiveSheetScreenScale, sheetFrameBodyGeometry } from './workspaceGeometry';

export type Bounds = { left: number; top: number; width: number; height: number };
export type SavedFrame = { position: WorkspacePosition; size: SheetFrameSize; visualScale: number };
/** All bounds are CSS pixels relative to the workspace surface. */
export type SheetPresentation = { frame: Bounds; body: Bounds; tableScale: number; chrome: number };

export function canvasPresentation(frame: SavedFrame, viewport: WorkspaceViewport): SheetPresentation {
  const size = clampSheetFrameSize(frame.size);
  const scale = effectiveSheetScreenScale(viewport.scale, frame.visualScale);
  const visualScale = clampSheetVisualScale(frame.visualScale);
  const body = sheetFrameBodyGeometry(size);
  const left = frame.position.x * viewport.scale + viewport.x;
  const top = frame.position.y * viewport.scale + viewport.y;
  return {
    frame: { left, top, width: size.width * scale, height: size.height * scale },
    body: { left: left + body.left * scale, top: top + body.top * scale, width: body.width * scale, height: body.height * scale },
    tableScale: viewport.scale * visualScale,
    chrome: 1,
  };
}

export function maximisedPresentation(size: SheetFrameSize, zoom: number): SheetPresentation {
  const bounds = { left: 0, top: 0, width: size.width, height: size.height };
  return { frame: { ...bounds }, body: { ...bounds }, tableScale: zoom, chrome: 0 };
}

export function restoredViewport(frame: SavedFrame, size: SheetFrameSize): WorkspaceViewport {
  const scale = 1 / clampSheetVisualScale(frame.visualScale);
  const frameSize = clampSheetFrameSize(frame.size);
  return {
    x: (size.width - frameSize.width) / 2 - frame.position.x * scale,
    y: (size.height - frameSize.height) / 2 - frame.position.y * scale,
    scale,
  };
}

export function interpolatePresentation(from: SheetPresentation, to: SheetPresentation, progress: number): SheetPresentation {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const t = p * p * (3 - 2 * p);
  const mix = (a: number, b: number) => a + (b - a) * t;
  const bounds = (a: Bounds, b: Bounds): Bounds => ({ left: mix(a.left, b.left), top: mix(a.top, b.top), width: mix(a.width, b.width), height: mix(a.height, b.height) });
  return { frame: bounds(from.frame, to.frame), body: bounds(from.body, to.body), tableScale: mix(from.tableScale, to.tableScale), chrome: mix(from.chrome, to.chrome) };
}
