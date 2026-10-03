import { expect, vi } from 'vitest';
import type { SheetDocument } from '@workbook/core/model';
import * as geometry from '@workbook/read/formattingSelection';
import * as summaries from '@workbook/read/formattingSummary';
import * as palette from '@workspace/colourPalette';

export const formattingModes = ['cells', 'rows', 'columns'] as const;

export function formattingSelection(sheet: SheetDocument, mode: geometry.FormattingSelection['mode']) {
  const target = (index: number) => ({
    sheetId: sheet.id,
    cell: { rowId: sheet.content.rows[index]!, columnId: sheet.content.columns[index]! },
  });
  return { mode, anchor: target(0), extent: target(2) };
}

/** Observe only formatting projection work, never unrelated grid rendering. */
export function observeFormattingProjection() {
  const validate = vi.spyOn(geometry, 'validateFormattingSelection');
  const summarize = vi.spyOn(summaries, 'summarizeFormatting');
  const colours = vi.spyOn(palette, 'customColoursForOverrides');
  return {
    expectCalls(validation: number, summary: number, scans: number) {
      expect(validate).toHaveBeenCalledTimes(validation);
      expect(summarize).toHaveBeenCalledTimes(summary);
      expect(colours).toHaveBeenCalledTimes(scans);
    },
    clear() {
      validate.mockClear();
      summarize.mockClear();
      colours.mockClear();
    },
  };
}
