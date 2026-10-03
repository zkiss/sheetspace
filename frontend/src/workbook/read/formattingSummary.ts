import type { SheetFormatOverrides } from '@workbook/core/model';
import type { ValidFormattingSelection } from './formattingSelection';
import { summarizeFormattingDense } from './formattingSummaryDense';
import { summarizeFormattingSparse } from './formattingSummarySparse';

export { formattingProperties } from './formattingSummaryTypes';
export type { FormattingProperty, FormattingPropertySummary, FormattingSummary } from './formattingSummaryTypes';
export { summarizeFormattingDense, summarizeFormattingSparse };

// Initial engineering cutoff, not a measured runtime optimum. No density scan/cache.
export const DENSE_FORMATTING_SELECTION_LIMIT = 256;

export function summarizeFormatting(selection: ValidFormattingSelection, overrides: SheetFormatOverrides | undefined) {
  return selection.effectiveSize <= DENSE_FORMATTING_SELECTION_LIMIT
    ? summarizeFormattingDense(selection, overrides)
    : summarizeFormattingSparse(selection, overrides);
}
