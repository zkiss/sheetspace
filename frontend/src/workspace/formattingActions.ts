import type { FormatWrite, HorizontalAlignment, NumberFormat } from '@workbook/core/model';
import { DEFAULT_NUMBER_FORMAT, DEFAULT_PERCENT_FORMAT, GENERAL_NUMBER_FORMAT, isValidNumberFormatPrecision } from '@workbook/core/numberFormat';
import type { FormattingSelectionValidation } from '@workbook/read/formattingSelection';
import type { FormattingSummary } from '@workbook/read/formattingSummary';
import { materializeFormattingWrites } from '@workbook/read/formattingWrites';
import { formatControlState } from './formattingControlState';

export type FormattingAction =
  | { type: 'numberFormat'; kind: NumberFormat['kind'] }
  | { type: 'bold' }
  | { type: 'alignment'; value: HorizontalAlignment };

type FormattingActionProjection = {
  descriptor: FormattingSelectionValidation;
  summary: FormattingSummary | undefined;
};

/** Shared toolbar/keyboard policy; summaries contain data, never dispatch callbacks. */
export function formattingActionWrites(
  projection: FormattingActionProjection,
  action: FormattingAction,
  guards: { editing: boolean; modal: boolean } = { editing: false, modal: false },
): readonly FormatWrite[] {
  const { descriptor, summary } = projection;
  if (!descriptor.valid || guards.editing || guards.modal) return [];
  if (action.type === 'bold') {
    return materializeFormattingWrites(descriptor, 'fontWeight', summary?.fontWeight.effectiveValue === 'bold' ? 'normal' : 'bold');
  }
  if (action.type === 'alignment') return materializeFormattingWrites(descriptor, 'horizontalAlignment', action.value);
  const current = summary ? formatControlState(summary).format : null;
  return materializeFormattingWrites(descriptor, 'numberFormat', numberFormatForKind(current, action.kind));
}

export function numberFormatForKind(current: NumberFormat | null, kind: NumberFormat['kind']): NumberFormat {
  if (kind === 'general') return GENERAL_NUMBER_FORMAT;
  if (current?.kind === kind) return { kind, precision: current.precision };
  return kind === 'number' ? DEFAULT_NUMBER_FORMAT : DEFAULT_PERCENT_FORMAT;
}

export function numberFormatWithPrecision(current: NumberFormat | null, precision: number): NumberFormat | null {
  return current && current.kind !== 'general' && isValidNumberFormatPrecision(precision)
    ? { ...current, precision } : null;
}
