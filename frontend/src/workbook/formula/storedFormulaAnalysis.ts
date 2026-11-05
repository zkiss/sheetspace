import type { Workbook } from '../core/model';
import { analyzeFormulaSyntax, resolveStoredEndpoint, workbookFormulaReferenceResolver } from './reference';
import { requireStoredFormula } from './storedFormula';
import { mergeFormulaDiagnostics, type FormulaDiagnostic, type FormulaParseResult, type FormulaReference, type FormulaReferenceLexeme, type FormulaSyntaxResult } from './syntax';

export type StoredReferenceAnalysis = {
  lexeme: FormulaReferenceLexeme;
  reference?: Extract<FormulaReference, { kind: 'canonical' }>;
  rowReference?: Extract<FormulaReference, { kind: 'row-reference' }>;
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
  const rowLexemes = syntax.referenceLexemes.filter((lexeme) => lexeme.endpoints.some((endpoint) => endpoint.kind === 'positional-canonical' || endpoint.kind === 'open-canonical'));
  const retainedDiagnostics = syntax.diagnostics.filter((diagnostic) => diagnostic.kind !== 'reference' || !rowLexemes.some((lexeme) => lexeme.sourceSpan.start === diagnostic.sourceSpan.start));
  const replacementDiagnostics: FormulaDiagnostic[] = [];
  for (const lexeme of rowLexemes) {
    const sheetId = lexeme.qualifier?.value ?? currentSheetId;
    const start = resolveStoredEndpoint(workbook, sheetId, lexeme.endpoints[0]);
    const resolved = lexeme.endpoints.map((endpoint) => resolveStoredEndpoint(workbook, sheetId, endpoint, start?.address.rowIndex));
    if (lexeme.qualifier?.broken || resolved.some((endpoint) => !endpoint || !endpoint.exists)) replacementDiagnostics.push({ kind: 'reference', code: '#REF!', sourceSpan: lexeme.sourceSpan });
  }
  syntax.diagnostics = mergeFormulaDiagnostics(retainedDiagnostics, replacementDiagnostics);
  const references = syntax.referenceLexemes.map((lexeme): StoredReferenceAnalysis => {
    const reference = syntax.references.find((reference) => reference.kind === 'canonical' && reference.sourceSpan.start === lexeme.sourceSpan.start) as StoredReferenceAnalysis['reference'];
    const rowReference = syntax.references.find((reference) => reference.kind === 'row-reference' && reference.sourceSpan.start === lexeme.sourceSpan.start) as StoredReferenceAnalysis['rowReference'];
    return { lexeme, reference, rowReference, live: Boolean(reference || rowReference) && !syntax.diagnostics.some((diagnostic) => diagnostic.sourceSpan.start === lexeme.sourceSpan.start && diagnostic.kind === 'reference') };
  });
  return { syntax, references, result: syntax.result, diagnostics: syntax.diagnostics };
}
