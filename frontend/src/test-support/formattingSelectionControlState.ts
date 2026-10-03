import type { SheetDocument } from '@workbook/core/model';
import { validateFormattingSelection, type FormattingSelection } from '@workbook/read/formattingSelection';
import { summarizeFormatting } from '@workbook/read/formattingSummary';
import { appearanceControlState, emptyAppearanceControlState, formatControlState } from '@workspace/formattingControlState';

/** Compose the pure read owners and UI adaptors for selection characterization. */
export function formattingSelectionControlState(sheet: SheetDocument | undefined, selection: FormattingSelection | null) {
  const descriptor = validateFormattingSelection(sheet, selection);
  if (!descriptor.valid) {
    return {
      format: { format: null, hasLocalOverrides: false },
      appearance: emptyAppearanceControlState(),
    };
  }
  const summary = summarizeFormatting(descriptor, sheet?.presentation.formatOverrides);
  return { format: formatControlState(summary), appearance: appearanceControlState(summary) };
}
