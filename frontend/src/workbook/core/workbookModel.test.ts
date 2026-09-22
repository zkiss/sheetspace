import { describe, expect, it } from 'vitest';
import {
  clampSheetVisualScale,
  DEFAULT_SHEET_FRAME_SIZE,
  isValidSheetVisualScale,
  WORKBOOK_SCHEMA_VERSION,
} from '@workbook/core/model';

describe('workbookModel', () => {
  it('defines the persisted workbook schema defaults', () => {
    expect(WORKBOOK_SCHEMA_VERSION).toBe(1);
    expect(DEFAULT_SHEET_FRAME_SIZE).toEqual({ width: 240, height: 160 });
  });

  it('validates and clamps finite sheet visual scales', () => {
    expect(isValidSheetVisualScale(0.1)).toBe(true);
    expect(isValidSheetVisualScale(8)).toBe(true);
    expect(isValidSheetVisualScale(0.09)).toBe(false);
    expect(isValidSheetVisualScale(9)).toBe(false);
    expect(isValidSheetVisualScale(Number.NaN)).toBe(false);
    expect(clampSheetVisualScale(0.01)).toBe(0.1);
    expect(clampSheetVisualScale(9)).toBe(8);
    expect(clampSheetVisualScale(Number.NaN)).toBe(1);
    expect(clampSheetVisualScale(-1)).toBe(1);
  });
});
