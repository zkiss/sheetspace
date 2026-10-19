import type { CellKey } from '@workbook/core/address';
import { APPLICATION_DEFAULT_NUMBER_FORMAT } from '@workbook/core/numberFormat';
import type { NumberFormat } from '@workbook/core/model';
import type { FormulaErrorCode } from '@workbook/formula/syntax';

export type FormulaScalarValue =
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'blank' }
  | { kind: 'error'; error: FormulaErrorCode };

export type FormulaRangeValue = {
  kind: 'range';
  values: Iterable<FormulaScalarValue>;
  rowCount: number;
  columnCount: number;
};

export type FormulaValue = FormulaScalarValue | FormulaRangeValue;

export type FormulaDisplayResult =
  | { kind: 'number'; value: number; display: string }
  | { kind: 'text'; value: string; display: string }
  | { kind: 'boolean'; value: boolean; display: 'TRUE' | 'FALSE' }
  | { kind: 'blank'; display: '' }
  | { kind: 'error'; error: FormulaErrorCode; display: FormulaErrorCode };

export type FormulaEvaluationSnapshot = Record<string, Record<CellKey, FormulaDisplayResult>>;

export function formulaErrorValue(error: FormulaErrorCode): FormulaScalarValue {
  return { kind: 'error', error };
}

export function formulaScalarValue(value: FormulaValue): FormulaScalarValue {
  return value.kind === 'range' ? formulaErrorValue('#VALUE!') : value;
}

export function formulaCollectionValues(value: FormulaValue): Iterable<FormulaScalarValue> {
  return value.kind === 'range' ? value.values : [value];
}

export function classifyCellValue(raw: string): FormulaScalarValue {
  if (raw.length === 0) {
    return { kind: 'blank' };
  }

  const trimmed = raw.trim();
  const numeric = /^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(trimmed)
    ? Number(trimmed)
    : undefined;
  if (numeric !== undefined && Number.isFinite(numeric)) {
    return { kind: 'number', value: numeric };
  }
  if (/^TRUE$/i.test(trimmed)) {
    return { kind: 'boolean', value: true };
  }
  if (/^FALSE$/i.test(trimmed)) {
    return { kind: 'boolean', value: false };
  }
  return { kind: 'text', value: raw };
}

export function displayRawCellValue(raw: string, format: NumberFormat = APPLICATION_DEFAULT_NUMBER_FORMAT): FormulaDisplayResult {
  return displayFormulaValue(classifyCellValue(raw), format);
}

export function displayFormulaValue(
  value: FormulaScalarValue,
  format: NumberFormat = APPLICATION_DEFAULT_NUMBER_FORMAT,
): FormulaDisplayResult {
  switch (value.kind) {
    case 'number':
      return {
        kind: 'number',
        value: value.value,
        display: formatNumber(value.value, format),
      };
    case 'text':
      return { ...value, display: value.value };
    case 'boolean':
      return { ...value, display: value.value ? 'TRUE' : 'FALSE' };
    case 'blank':
      return { kind: 'blank', display: '' };
    case 'error':
      return { ...value, display: value.error };
  }
}

function formatNumber(value: number, format: NumberFormat): string {
  if (format.kind === 'general' || !Number.isFinite(value)) return Object.is(value, -0) ? '0' : String(value);

  const scaled = format.kind === 'percent' ? value * 100 : value;
  if (!Number.isFinite(scaled)) return Object.is(value, -0) ? '0' : String(value);

  const display = new Intl.NumberFormat('en-US', {
    useGrouping: false,
    minimumFractionDigits: format.precision,
    maximumFractionDigits: format.precision,
  }).format(scaled);
  const normalized = /^-0(?:\.0+)?$/.test(display) ? display.slice(1) : display;
  return format.kind === 'percent' ? `${normalized}%` : normalized;
}
