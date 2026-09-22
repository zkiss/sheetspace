import { cellIdentityKey } from './cellIdentity';
import type { NumberFormat, SheetFormatOverrides, StableCellIdentity } from './model';

export const NUMBER_FORMAT_PRECISION_LIMITS = { min: 0, max: 10 } as const;
export const GENERAL_NUMBER_FORMAT: NumberFormat = Object.freeze({ kind: 'general' });
export const DEFAULT_NUMBER_FORMAT: NumberFormat = Object.freeze({ kind: 'number', precision: 2 });
export const DEFAULT_PERCENT_FORMAT: NumberFormat = Object.freeze({ kind: 'percent', precision: 0 });
export const APPLICATION_DEFAULT_NUMBER_FORMAT = GENERAL_NUMBER_FORMAT;

export function emptySheetFormatOverrides(): SheetFormatOverrides {
  return { rows: {}, columns: {}, cells: {} };
}

export function isValidNumberFormat(value: unknown): value is NumberFormat {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'general') return hasOnlyKeys(value, ['kind']);
  if (value.kind !== 'number' && value.kind !== 'percent') return false;
  return hasOnlyKeys(value, ['kind', 'precision']) && isValidNumberFormatPrecision(value.precision);
}

export function isValidNumberFormatPrecision(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= NUMBER_FORMAT_PRECISION_LIMITS.min
    && value <= NUMBER_FORMAT_PRECISION_LIMITS.max;
}

/** Resolve this property independently so later format properties can use the same scope order. */
export function resolveNumberFormat(overrides: SheetFormatOverrides, identity: StableCellIdentity): NumberFormat {
  return own(overrides.cells, cellIdentityKey(identity))?.numberFormat
    ?? own(overrides.rows, identity.rowId)?.numberFormat
    ?? own(overrides.columns, identity.columnId)?.numberFormat
    ?? APPLICATION_DEFAULT_NUMBER_FORMAT;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}
