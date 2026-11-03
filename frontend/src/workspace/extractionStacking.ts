import type { SheetFrameProjection } from '@workbook/core/model';

export function extractionStacking(frames: SheetFrameProjection[], sourceId: string) {
  const ordered = [...frames].sort((left, right) => left.zIndex - right.zIndex);
  const slots = new Map(ordered.map((frame, index) => [frame.id, index * 2]));
  const source = slots.get(sourceId);
  return { slots, waiting: source === undefined ? undefined : source - 1 };
}
