import { expect } from 'vitest';
import { ContentHistory, EXTRACTION_HISTORY_MAX_BYTES } from '@application/core/contentHistory';
import type { Workbook } from '@workbook/core/model';

export function expectBoundedExtraction(history: ContentHistory, before: Workbook, after: Workbook) {
  const entry = history.peekUndo()!;
  expect(entry).toMatchObject({ snapshots: { before, after }, transitionId: 'dd36b1da-89af-4d7d-b81e-17a9c426f6e4' });
  expect(Object.keys(entry).sort()).toEqual(['affected', 'bytes', 'identity', 'kind', 'snapshots', 'transitionId', 'writes']);
  expect(entry.bytes).toBe(new TextEncoder().encode(JSON.stringify(entry)).byteLength);
  expect(entry.bytes).toBeLessThan(EXTRACTION_HISTORY_MAX_BYTES);
}
