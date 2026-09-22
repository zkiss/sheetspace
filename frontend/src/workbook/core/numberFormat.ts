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

export function validFormatWrites(content: { rows: string[]; columns: string[] }, writes: readonly { scope: string; targetId: string; numberFormat: unknown }[]): boolean {
  if (!Array.isArray(writes) || writes.length === 0) return false;
  const targets = new Set<string>();
  return writes.every((write) => {
    if (!write || !['row', 'column', 'cell'].includes(write.scope) || typeof write.targetId !== 'string') return false;
    const ids = write.scope === 'cell' ? write.targetId.split('\u0000') : [write.targetId];
    const belongs = write.scope === 'row' ? content.rows.includes(write.targetId) : write.scope === 'column' ? content.columns.includes(write.targetId) : ids.length === 2 && content.rows.includes(ids[0]) && content.columns.includes(ids[1]);
    const key = `${write.scope}\u0000${write.targetId}`;
    if (!belongs || targets.has(key) || (write.numberFormat !== null && !isValidNumberFormat(write.numberFormat))) return false;
    targets.add(key); return true;
  });
}

export function applyFormatWrites(overrides: SheetFormatOverrides | undefined, writes: readonly { scope: 'row' | 'column' | 'cell'; targetId: string; numberFormat: NumberFormat | null }[]): SheetFormatOverrides {
  const next = overrides ?? emptySheetFormatOverrides();
  const result = { rows: { ...next.rows }, columns: { ...next.columns }, cells: { ...next.cells } };
  for (const write of writes) {
    const target = write.scope === 'row' ? result.rows : write.scope === 'column' ? result.columns : result.cells;
    if (write.numberFormat === null) delete target[write.targetId]; else target[write.targetId] = { numberFormat: { ...write.numberFormat } };
  }
  return result;
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
