import type { Workbook } from '../core/model';
import { analyzeFormulaSyntax, workbookFormulaReferenceResolver } from './reference';
import { requireStoredFormula } from './storedFormula';
import type { FormulaDiagnostic, FormulaParseResult, FormulaReference, FormulaReferenceLexeme, FormulaSyntaxResult } from './syntax';

export type StoredReferenceAnalysis = {
  lexeme: FormulaReferenceLexeme;
  reference?: Extract<FormulaReference, { kind: 'canonical' }>;
  live: boolean;
};
export type StoredFormulaAnalysis = {
  syntax: FormulaSyntaxResult;
  references: StoredReferenceAnalysis[];
  result: FormulaParseResult;
  diagnostics: FormulaDiagnostic[];
};

/** Opaque payloads are never decoded into the parser or resolver on passive reads. */
export function analyzeStoredFormula(content: string, workbook: Workbook, currentSheetId = ''): StoredFormulaAnalysis {
  requireStoredFormula(content);
  const syntax = analyzeFormulaSyntax(content, workbookFormulaReferenceResolver(workbook, currentSheetId), true);
  const references = syntax.referenceLexemes.map((lexeme): StoredReferenceAnalysis => {
    const reference = syntax.references.find((reference) => reference.kind === 'canonical' && reference.sourceSpan.start === lexeme.sourceSpan.start) as StoredReferenceAnalysis['reference'];
    return { lexeme, reference, live: Boolean(reference) && !syntax.diagnostics.some((diagnostic) => diagnostic.sourceSpan.start === lexeme.sourceSpan.start && diagnostic.kind === 'reference') };
  });
  return { syntax, references, result: syntax.result, diagnostics: syntax.diagnostics };
}
