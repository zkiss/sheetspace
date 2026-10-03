import type { AppearanceControlState } from './appearanceControlState';
import type { FormattingSummary } from '@workbook/read/formattingSummary';
import type { NumberFormat } from '@workbook/core/model';

export type FormatControlState = { format: NumberFormat | null; hasLocalOverrides: boolean };
export type AppearanceFormattingControlState = Omit<AppearanceControlState, 'numberFormat'>;

export function formatControlState(summary: FormattingSummary): FormatControlState {
  const numberFormat = summary.numberFormat;
  return {
    format: numberFormat.effectiveValue === null || numberFormat.localOverrideState === 'mixed'
      ? null : numberFormat.localValue ?? numberFormat.effectiveValue,
    hasLocalOverrides: numberFormat.hasLocalOverrides,
  };
}

export function appearanceControlState(summary: FormattingSummary): AppearanceFormattingControlState {
  const adapt = <Value,>(property: { effectiveValue: Value | null; localValue: Value | null; localOverrideState: 'inherited' | 'explicit' | 'mixed'; hasLocalOverrides: boolean }) => ({
    value: property.effectiveValue,
    localValue: property.localValue,
    localOverrideState: property.localOverrideState,
    hasLocalOverrides: property.hasLocalOverrides,
  });
  return {
    fontWeight: adapt(summary.fontWeight), horizontalAlignment: adapt(summary.horizontalAlignment),
    textColor: adapt(summary.textColor), fillColor: adapt(summary.fillColor),
  };
}

export function emptyAppearanceControlState(): AppearanceFormattingControlState {
  const empty = { value: null, localValue: null, localOverrideState: 'inherited' as const, hasLocalOverrides: false };
  return { fontWeight: empty, horizontalAlignment: empty, textColor: empty, fillColor: empty };
}
