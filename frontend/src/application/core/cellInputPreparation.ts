import { classifyTemporalInput, decodeTemporalValue, encodeTemporalValue, parseTemporalValue } from '@workbook/core/temporal';
import { classifyCellValue } from '@calculation/formulaValue';
import { decodeCellTextLiteral, encodeCellTextLiteral } from '@workbook/core/cellLiteral';
import type { Workbook } from '@workbook/core/model';
import { prepareFormulaEdit, prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { requireStoredFormula } from '@workbook/formula/storedFormula';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';

export type CellInputMode = 'auto' | 'text' | 'date' | 'datetime';

export function openCellInput(raw: string, workbook: Workbook, sheetId: string): { text: string; mode: CellInputMode } {
  const temporal = decodeTemporalValue(raw);
  if (temporal) return { text: temporal.value, mode: temporal.kind };
  const text = decodeCellTextLiteral(raw);
  if (text !== undefined) {
    const requiresLiteralMode = text.startsWith('=') || classifyTemporalInput(text).kind !== 'not-temporal'
      || classifyCellValue(text).kind !== 'text';
    return { text, mode: requiresLiteralMode ? 'text' : 'auto' };
  }
  return { text: raw.startsWith('=') ? projectStoredFormula(raw, workbook, sheetId).text : raw, mode: 'auto' };
}

export function prepareCellInputMode(text: string, mode: CellInputMode, workbook: Workbook, sheetId: string, original?: string):
  | { ok: true; raw: string }
  | { ok: false; message: string } {
  if (!text) return { ok: true, raw: '' };
  if (mode === 'text') return { ok: true, raw: encodeCellTextLiteral(text) };
  if (mode === 'date' || mode === 'datetime') {
    const value = parseTemporalValue(text, mode);
    return value ? { ok: true, raw: encodeTemporalValue(value) }
      : { ok: false, message: mode === 'date'
        ? 'Enter a valid date as YYYY-MM-DD.'
        : 'Enter a valid local date and time as YYYY-MM-DD HH:mm, without a timezone.' };
  }
  const temporal = classifyTemporalInput(text);
  if (temporal.kind === 'valid') return { ok: true, raw: encodeTemporalValue(temporal.value) };
  if (temporal.kind === 'invalid') return { ok: false, message: 'Enter a valid date as YYYY-MM-DD or a local date and time as YYYY-MM-DD HH:mm.' };
  return { ok: true, raw: prepareCellInput(text, workbook, sheetId, original) };
}

/** Prepare fresh editor text, never interpreting its spelling as trusted storage. */
export function prepareCellInput(text: string, workbook: Workbook, sheetId: string, original?: string): string {
  if (text.startsWith('=')) return original?.startsWith('=')
    ? prepareFormulaEdit(text, requireStoredFormula(original), workbook, sheetId)
    : prepareUserFormula(text, workbook, sheetId);
  if (text && (decodeCellTextLiteral(text) !== undefined || decodeTemporalValue(text) !== undefined || classifyCellValue(text).kind === 'text')) return encodeCellTextLiteral(text);
  return text;
}

export function prepareExternalPasteInput(raw: string): string | undefined {
  if (!raw) return raw;
  const temporal = classifyTemporalInput(raw);
  if (temporal.kind === 'valid') return encodeTemporalValue(temporal.value);
  if (temporal.kind === 'invalid') return undefined;
  if (decodeCellTextLiteral(raw) !== undefined || raw.startsWith('@date:') || raw.startsWith('@datetime:')
    || classifyCellValue(raw).kind === 'text') return encodeCellTextLiteral(raw);
  return raw;
}
