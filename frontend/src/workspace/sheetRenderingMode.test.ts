import { describe, expect, it } from 'vitest';
import { SHEET_DETAILED_ENTRY_EFFECTIVE_SCALE } from '@workbook/core/sheetRenderingPolicy';
import { effectiveSheetScreenScale } from '@workspace/workspaceGeometry';
import {
  resolveSheetRenderingMode,
  SHEET_OVERVIEW_ENTRY_EFFECTIVE_SCALE,
  type SheetRenderingMode,
} from '@workspace/sheetRenderingMode';

describe('sheet rendering mode policy', () => {
  it('uses inclusive named boundaries in both hysteresis directions', () => {
    expect(resolveSheetRenderingMode(SHEET_OVERVIEW_ENTRY_EFFECTIVE_SCALE, 'detailed')).toBe('overview');
    expect(resolveSheetRenderingMode(SHEET_OVERVIEW_ENTRY_EFFECTIVE_SCALE + 0.01, 'detailed')).toBe('detailed');
    expect(resolveSheetRenderingMode(SHEET_DETAILED_ENTRY_EFFECTIVE_SCALE, 'overview')).toBe('detailed');
    expect(resolveSheetRenderingMode(SHEET_DETAILED_ENTRY_EFFECTIVE_SCALE - 0.01, 'overview')).toBe('overview');
  });

  it('retains the prior mode throughout the hysteresis band', () => {
    const scales = [0.36, 0.42, 0.49, 0.4, 0.37];
    expect(scales.reduce<SheetRenderingMode>((mode, scale) => resolveSheetRenderingMode(scale, mode), 'detailed'))
      .toBe('detailed');
    expect(scales.reduce<SheetRenderingMode>((mode, scale) => resolveSheetRenderingMode(scale, mode), 'overview'))
      .toBe('overview');
  });

  it.each([
    {
      expected: 'overview' as const,
      previous: 'detailed' as const,
      products: [[0.35, 1], [0.1, 3.5], [0.5, 0.7]],
      threshold: SHEET_OVERVIEW_ENTRY_EFFECTIVE_SCALE,
    },
    {
      expected: 'detailed' as const,
      previous: 'overview' as const,
      products: [[0.5, 1], [0.1, 5], [0.2, 2.5]],
      threshold: SHEET_DETAILED_ENTRY_EFFECTIVE_SCALE,
    },
  ])('treats equivalent products identically at the $threshold boundary', ({ expected, previous, products }) => {
    const effectiveScales = products.map(([viewportScale, visualScale]) => (
      effectiveSheetScreenScale(viewportScale, visualScale)
    ));
    expect(new Set(effectiveScales.map((scale) => resolveSheetRenderingMode(scale, previous))))
      .toEqual(new Set([expected]));
  });
});
