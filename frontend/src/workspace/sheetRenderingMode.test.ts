import { describe, expect, it } from 'vitest';
import { effectiveSheetScreenScale } from '@workspace/workspaceGeometry';
import {
  resolveSheetRenderingMode,
  SHEET_DETAILED_ENTRY_EFFECTIVE_SCALE,
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

  it('treats equivalent viewport and sheet-scale products identically', () => {
    const products = [
      effectiveSheetScreenScale(1, 0.3),
      effectiveSheetScreenScale(0.5, 0.6),
      effectiveSheetScreenScale(0.25, 1.2),
    ];
    expect(new Set(products.map((scale) => resolveSheetRenderingMode(scale, 'detailed'))))
      .toEqual(new Set(['overview']));
  });
});
