import { decodeTemporalValue, encodeTemporalValue, parseTemporalValue } from '@workbook/core/temporal';
import { classifyCellValue } from '@calculation/formulaValue';
import { decodeCellTextLiteral, encodeCellTextLiteral } from '@workbook/core/cellLiteral';
import type { Workbook } from '@workbook/core/model';
import { prepareFormulaEdit, prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { requireStoredFormula } from '@workbook/formula/storedFormula';

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
  const temporal = parseTemporalValue(raw, 'date') ?? parseTemporalValue(raw, 'datetime');
  if (temporal) return encodeTemporalValue(temporal);
  if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(raw)) return undefined;
  if (decodeCellTextLiteral(raw) !== undefined || raw.startsWith('@date:') || raw.startsWith('@datetime:')
    || classifyCellValue(raw).kind === 'text') return encodeCellTextLiteral(raw);
  return raw;
}
