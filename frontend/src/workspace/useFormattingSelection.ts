import { useMemo, useRef } from 'react';
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
  const sheetRef = useRef(sheet);
  const selectionRef = useRef(selection);
  sheetRef.current = sheet;
  selectionRef.current = selection;
  const mode = selection?.mode;
  const anchor = selection?.anchor;
  const extent = selection?.extent;
  const descriptorInputs = useMemo(() => [
    sheet?.id, sheet?.content.rows, sheet?.content.columns, mode,
    anchor?.sheetId, anchor?.cell.rowId, anchor?.cell.columnId,
    extent?.sheetId, extent?.cell.rowId, extent?.cell.columnId,
  ], [
    sheet?.id, sheet?.content.rows, sheet?.content.columns, mode,
    anchor?.sheetId, anchor?.cell.rowId, anchor?.cell.columnId,
    extent?.sheetId, extent?.cell.rowId, extent?.cell.columnId,
  ]);
  const descriptor = useMemo(
    () => {
      void descriptorInputs;
      return validateFormattingSelection(sheetRef.current, selectionRef.current);
    },
    [descriptorInputs],
  );
  const overrides = sheet?.presentation.formatOverrides;
  const summary = useMemo(
    () => descriptor.valid ? summarizeFormatting(descriptor, overrides) : undefined,
    [descriptor, overrides],
  );
  const paletteInputs = useMemo(() => [sheet?.id, overrides] as const, [sheet?.id, overrides]);
  const customColours = useMemo(() => customColoursForOverrides(paletteInputs[1]), [paletteInputs]);
  return { descriptor, summary, customColours };
}
