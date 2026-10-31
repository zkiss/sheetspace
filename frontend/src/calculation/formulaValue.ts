import type { CellKey } from '@workbook/core/address';
import { APPLICATION_DEFAULT_NUMBER_FORMAT } from '@workbook/core/numberFormat';
import type { ModelColumnType, NumberFormat } from '@workbook/core/model';
import type { FormulaErrorCode } from '@workbook/formula/syntax';
import { decodeCellTextLiteral, encodeCellTextLiteral } from '@workbook/core/cellLiteral';

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

export type FormulaDiagnostic = {
  message: string;
  cell?: { sheetId: string; rowId: string; columnId: string };
  causes: readonly FormulaDiagnostic[];
};

const diagnostics = new WeakMap<object, FormulaDiagnostic>();

export function formulaDiagnostic(value: FormulaScalarValue | FormulaDisplayResult): FormulaDiagnostic | undefined {
  return diagnostics.get(value);
}

export function diagnosticError(error: FormulaErrorCode, message: string, causes: readonly FormulaDiagnostic[] = []): FormulaScalarValue {
  const value = formulaErrorValue(error);
  diagnostics.set(value, { message, causes });
  return value;
}

export function diagnosticAtCell(value: FormulaScalarValue, cell: FormulaDiagnostic['cell']): FormulaScalarValue {
  if (value.kind !== 'error') return value;
  const diagnostic = formulaDiagnostic(value) ?? { message: value.error, causes: [] };
  if (!cell || (diagnostic.cell?.sheetId === cell.sheetId && diagnostic.cell.rowId === cell.rowId && diagnostic.cell.columnId === cell.columnId)) return value;
  const result = formulaErrorValue(value.error);
  diagnostics.set(result, diagnostic.cell
    ? { message: `Propagated ${value.error}`, cell, causes: [diagnostic] }
    : { ...diagnostic, cell });
  return result;
}

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
  return value.kind === 'range'
    ? diagnosticError('#VALUE!', `Expected a scalar value, got a ${value.rowCount} by ${value.columnCount} range.`)
    : value;
}

export function formulaCollectionValues(value: FormulaValue): Iterable<FormulaScalarValue> {
  return value.kind === 'range' ? value.values : [value];
}

export function classifyCellValue(raw: string): FormulaScalarValue {
  const literal = decodeCellTextLiteral(raw);
  if (literal !== undefined) return { kind: 'text', value: literal };
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

export function matchesModelColumnType(value: FormulaScalarValue, type: ModelColumnType): boolean {
  if (value.kind === 'blank' || value.kind === 'error') return true;
  if (type === 'string') return value.kind === 'text';
  if (type === 'boolean') return value.kind === 'boolean';
  return value.kind === 'number' && (type === 'float' || Number.isInteger(value.value));
}

/** Freezes underlying values, independently of display formatting. */
export function materializeFormulaValue(value: FormulaScalarValue): string {
  switch (value.kind) {
    case 'text': return encodeCellTextLiteral(value.value);
    case 'error': return encodeCellTextLiteral(value.error);
    case 'number': return Object.is(value.value, -0) ? '-0' : String(value.value);
    case 'boolean': return value.value ? 'TRUE' : 'FALSE';
    case 'blank': return '';
  }
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
    case 'error': {
      const result: FormulaDisplayResult = { ...value, display: value.error };
      const diagnostic = formulaDiagnostic(value);
      if (diagnostic) diagnostics.set(result, diagnostic);
      return result;
    }
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
