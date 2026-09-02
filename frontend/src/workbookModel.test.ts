import { describe, expect, it } from 'vitest';
import { DEFAULT_SHEET_FRAME_SIZE, WORKBOOK_SCHEMA_VERSION } from './workbook/core/model';

describe('workbookModel', () => {
  it('defines the persisted workbook schema defaults', () => {
    expect(WORKBOOK_SCHEMA_VERSION).toBe(1);
    expect(DEFAULT_SHEET_FRAME_SIZE).toEqual({ width: 240, height: 160 });
  });
});
