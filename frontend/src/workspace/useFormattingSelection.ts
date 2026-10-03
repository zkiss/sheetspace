import { useMemo } from 'react';
import type { SheetDocument } from '@workbook/core/model';
import { summarizeFormatting, type FormattingSummary } from '@workbook/read/formattingSummary';
import {
  validateFormattingSelection,
  type FormattingSelection,
  type FormattingSelectionValidation,
} from '@workbook/read/formattingSelection';
import { customColoursForOverrides } from './colourPalette';

export type FormattingSelectionProjection = {
  descriptor: FormattingSelectionValidation;
  summary: FormattingSummary | undefined;
  customColours: readonly string[];
};

/**
 * Owns the current formatting read projection.  Its dependencies deliberately
 * exclude sheet content, frame state, revisions, and command callbacks.
 */
export function useFormattingSelection(
  sheet: SheetDocument | undefined,
  selection: FormattingSelection | null,
): FormattingSelectionProjection {
  const mode = selection?.mode;
  const anchor = selection?.anchor;
  const extent = selection?.extent;
  const descriptor = useMemo(() => validateFormattingSelection(sheet, selection), [
    sheet?.id,
    sheet?.content.rows,
    sheet?.content.columns,
    mode,
    anchor?.sheetId,
    anchor?.cell.rowId,
    anchor?.cell.columnId,
    extent?.sheetId,
    extent?.cell.rowId,
    extent?.cell.columnId,
  ]);
  const overrides = sheet?.presentation.formatOverrides;
  const summary = useMemo(
    () => descriptor.valid ? summarizeFormatting(descriptor, overrides) : undefined,
    [descriptor, overrides],
  );
  const customColours = useMemo(
    () => customColoursForOverrides(overrides),
    [sheet?.id, overrides],
  );
  return { descriptor, summary, customColours };
}
