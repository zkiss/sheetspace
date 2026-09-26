import { cellIdentityKey } from './cellIdentity';
import type { AppearancePatch, AppearanceWrite, CellAppearance, FillColor, FontWeight, HorizontalAlignment, NumberFormat, SheetFormatOverrides, StableCellIdentity, TextColor } from './model';

export const NUMBER_FORMAT_PRECISION_LIMITS = { min: 0, max: 10 } as const;
export const GENERAL_NUMBER_FORMAT: NumberFormat = Object.freeze({ kind: 'general' });
export const DEFAULT_NUMBER_FORMAT: NumberFormat = Object.freeze({ kind: 'number', precision: 2 });
export const DEFAULT_PERCENT_FORMAT: NumberFormat = Object.freeze({ kind: 'percent', precision: 0 });
export const APPLICATION_DEFAULT_NUMBER_FORMAT = GENERAL_NUMBER_FORMAT;
export const APPLICATION_DEFAULT_FONT_WEIGHT: FontWeight = 'normal';
export const APPLICATION_DEFAULT_HORIZONTAL_ALIGNMENT: HorizontalAlignment = 'general';
export const APPLICATION_DEFAULT_TEXT_COLOR: TextColor = 'automatic';
export const APPLICATION_DEFAULT_FILL_COLOR: FillColor = 'none';

export function emptySheetFormatOverrides(): SheetFormatOverrides {
  return { rows: {}, columns: {}, cells: {} };
}

export function validFormatWrites(content: { rows: string[]; columns: string[] }, writes: readonly { scope: string; targetId: string; properties: unknown }[]): boolean {
  if (!Array.isArray(writes) || writes.length === 0) return false;
  const targets = new Set<string>();
  return writes.every((write) => {
    if (!write || !['row', 'column', 'cell'].includes(write.scope) || typeof write.targetId !== 'string') return false;
    const ids = write.scope === 'cell' ? write.targetId.split('\u0000') : [write.targetId];
    const belongs = write.scope === 'row' ? content.rows.includes(write.targetId) : write.scope === 'column' ? content.columns.includes(write.targetId) : ids.length === 2 && content.rows.includes(ids[0]) && content.columns.includes(ids[1]);
    const key = `${write.scope}\u0000${write.targetId}`;
    if (!belongs || targets.has(key) || !isValidAppearancePatch(write.properties)) return false;
    targets.add(key); return true;
  });
}

export function applyFormatWrites(overrides: SheetFormatOverrides | undefined, writes: readonly AppearanceWrite[]): SheetFormatOverrides {
  const next = overrides ?? emptySheetFormatOverrides();
  const result = { rows: { ...next.rows }, columns: { ...next.columns }, cells: { ...next.cells } };
  for (const write of writes) {
    const target = write.scope === 'row' ? result.rows : write.scope === 'column' ? result.columns : result.cells;
    const previous = target[write.targetId] ?? {};
    const appearance: CellAppearance = { ...previous };
    for (const property of appearanceProperties) {
      const value = write.properties[property];
      if (value === undefined) continue;
      if (value === null) delete appearance[property];
      else setAppearanceProperty(appearance, property, value);
    }
    if (Object.keys(appearance).length === 0) delete target[write.targetId]; else target[write.targetId] = appearance;
  }
  return result;
}

const appearanceProperties = ['numberFormat', 'fontWeight', 'horizontalAlignment', 'textColor', 'fillColor'] as const;

export function isValidAppearancePatch(value: unknown): value is AppearancePatch {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => appearanceProperties.includes(key as typeof appearanceProperties[number])
    && (value[key] === null || isValidAppearanceProperty(key as keyof CellAppearance, value[key])));
}

export function isValidCellAppearance(value: unknown): value is CellAppearance {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => appearanceProperties.includes(key as typeof appearanceProperties[number])
    && isValidAppearanceProperty(key as keyof CellAppearance, value[key]));
}

export function isValidAppearanceProperty(property: keyof CellAppearance, value: unknown): boolean {
  if (property === 'numberFormat') return isValidNumberFormat(value);
  if (property === 'fontWeight') return value === 'normal' || value === 'bold';
  if (property === 'horizontalAlignment') return value === 'general' || value === 'left' || value === 'center' || value === 'right';
  if (property === 'textColor') return value === 'automatic' || isHexColor(value);
  return value === 'none' || isHexColor(value);
}

function isHexColor(value: unknown): value is `#${string}` {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function setAppearanceProperty<Property extends keyof CellAppearance>(appearance: CellAppearance, property: Property, value: NonNullable<CellAppearance[Property]>): void {
  if (property === 'numberFormat') appearance.numberFormat = { ...(value as NumberFormat) };
  else (appearance[property] as CellAppearance[Property]) = value;
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
  return resolveAppearanceProperty(overrides, identity, 'numberFormat', APPLICATION_DEFAULT_NUMBER_FORMAT);
}

/** Every appearance property resolves independently in the same scope order. */
export function resolveAppearanceProperty<Property extends keyof CellAppearance>(
  overrides: SheetFormatOverrides,
  identity: StableCellIdentity,
  property: Property,
  applicationDefault: NonNullable<CellAppearance[Property]>,
): NonNullable<CellAppearance[Property]> {
  return own(overrides.cells, cellIdentityKey(identity))?.[property]
    ?? own(overrides.rows, identity.rowId)?.[property]
    ?? own(overrides.columns, identity.columnId)?.[property]
    ?? applicationDefault;
}

export function resolveCellAppearance(overrides: SheetFormatOverrides, identity: StableCellIdentity): Required<CellAppearance> {
  return {
    numberFormat: resolveNumberFormat(overrides, identity),
    fontWeight: resolveAppearanceProperty(overrides, identity, 'fontWeight', APPLICATION_DEFAULT_FONT_WEIGHT),
    horizontalAlignment: resolveAppearanceProperty(overrides, identity, 'horizontalAlignment', APPLICATION_DEFAULT_HORIZONTAL_ALIGNMENT),
    textColor: resolveAppearanceProperty(overrides, identity, 'textColor', APPLICATION_DEFAULT_TEXT_COLOR),
    fillColor: resolveAppearanceProperty(overrides, identity, 'fillColor', APPLICATION_DEFAULT_FILL_COLOR),
  };
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
