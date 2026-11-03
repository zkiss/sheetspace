import { describe, expect, it } from 'vitest';
import { frameProjection } from '@workbook/read/queries';
import { sheetDocument } from '@test-support/workbookFactories';
import { extractionStacking } from './extractionStacking';

describe('extraction presentation stacking', () => {
  it('preserves adjacent and tied peer order while inserting the target immediately below the source', () => {
    const frame = frameProjection(sheetDocument({ id: 'base', name: 'Base' }));
    const frames = [
      { ...frame, id: 'lower', zIndex: -2 },
      { ...frame, id: 'tied-before', zIndex: -1 },
      { ...frame, id: 'source', zIndex: -1 },
      { ...frame, id: 'tied-after', zIndex: -1 },
      { ...frame, id: 'target', zIndex: 0 },
    ];
    const { slots, waiting } = extractionStacking(frames, 'source');
    expect([...slots.values()]).toEqual([0, 2, 4, 6, 8]);
    expect(waiting).toBe(3);
    expect(waiting).toBeGreaterThan(slots.get('tied-before')!);
    expect(waiting).toBeLessThan(slots.get('source')!);
  });

  it('does not invent a waiting level when the source has disappeared', () => {
    expect(extractionStacking([], 'missing').waiting).toBeUndefined();
  });

  it('orders unsorted siblings by z-index before assigning presentation slots', () => {
    const frame = frameProjection(sheetDocument({ id: 'base', name: 'Base' }));
    const { slots, waiting } = extractionStacking([
      { ...frame, id: 'above', zIndex: 9 },
      { ...frame, id: 'source', zIndex: 3 },
      { ...frame, id: 'below', zIndex: -4 },
    ], 'source');
    expect([...slots.entries()]).toEqual([['below', 0], ['source', 2], ['above', 4]]);
    expect(waiting).toBe(1);
  });
});
