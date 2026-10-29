import { classifyCellValue } from '@calculation/formulaValue';
import { decodeCellTextLiteral, encodeCellTextLiteral } from '@workbook/core/cellLiteral';
import type { Workbook } from '@workbook/core/model';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';

/** Prepare fresh editor text, never interpreting its spelling as trusted storage. */
export function prepareCellInput(text: string, workbook: Workbook, sheetId: string): string {
  if (text.startsWith('=')) return prepareUserFormula(text, workbook, sheetId);
  if (text && (decodeCellTextLiteral(text) !== undefined || classifyCellValue(text).kind === 'text')) return encodeCellTextLiteral(text);
  return text;
}
