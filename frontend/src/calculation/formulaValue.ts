import type { CellKey } from '@workbook/core/address';
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

export function displayFormulaValue(value: FormulaScalarValue): FormulaDisplayResult {
  switch (value.kind) {
    case 'number':
      return {
        kind: 'number',
        value: value.value,
        display: Object.is(value.value, -0) ? '0' : String(value.value),
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
