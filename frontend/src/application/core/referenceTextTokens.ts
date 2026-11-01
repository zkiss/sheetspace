import type { FormulaInspectionReference } from '@workbook/formula/formulaInspectionContracts';
import type { FormulaSyntaxToken } from '@workbook/formula/syntax';

/** Tokenize diagnostic text using known references, without parsing it as a formula. */
export function referenceTextTokens(raw: string, references: readonly FormulaInspectionReference[]): FormulaSyntaxToken[] {
  const tokens: FormulaSyntaxToken[] = [];
  let start = 0;
  for (const reference of references) {
    const span = reference.displaySpan;
    if (span.start > start) tokens.push({ kind: 'text', sourceSpan: { start, end: span.start } });
    tokens.push({ kind: 'reference', sourceSpan: span });
    start = span.end;
  }
  if (start < raw.length) tokens.push({ kind: 'text', sourceSpan: { start, end: raw.length } });
  return tokens;
}
