import type { CustomFunction, Workbook } from '../core/model';
import { namedColumns } from '../core/columnNames';
import { functionBodyReferences, prepareFunctionBody } from './formulaPreparation';
import { analyzeStoredFormula } from './storedFormulaAnalysis';
import { parseFormulaSyntax, type FormulaDiagnostic } from './syntax';

/** Analyze editable user text and bind its references only in the invoking sheet. */
export function analyzeFunctionBody(definition: CustomFunction, workbook: Workbook, callerSheetId: string) {
  const parameters = definition.parameters.map((parameter) => parameter.name);
  const syntax = parseFormulaSyntax(definition.body, {
    referenceMode: 'user', parameters,
    isNamedColumn: (qualifier, name) => {
      const sheet = qualifier === undefined ? workbook.documents[callerSheetId] : Object.values(workbook.documents).find((item) => item.name === qualifier);
      return Boolean(sheet && namedColumns(workbook, sheet).some((column) => column.name === name));
    },
  });
  if (syntax.result.kind === 'not-formula') {
    const diagnostics: FormulaDiagnostic[] = [{ kind: 'syntax', code: '#PARSE!', sourceSpan: { start: 0, end: definition.body.length } }];
    return { syntax, diagnostics, bound: undefined };
  }
  const content = definition.bodyBindings?.[callerSheetId] ?? (definition.bodyBindings === undefined ? prepareFunctionBody(definition.body, workbook, callerSheetId, parameters) : undefined);
  if (!content) {
    const diagnostics: FormulaDiagnostic[] = [{ kind: 'reference', code: '#REF!', sourceSpan: { start: 0, end: definition.body.length } }];
    return { syntax, diagnostics, bound: undefined };
  }
  const bound = analyzeStoredFormula(content, workbook, callerSheetId, parameters);
  const committed = functionBodyReferences(definition.body, content, workbook, callerSheetId, parameters);
  const referenceDiagnostics = syntax.referenceLexemes.flatMap((lexeme): FormulaDiagnostic[] => {
    const existing = committed.find(({ raw }) => raw.start === lexeme.sourceSpan.start && raw.end === lexeme.sourceSpan.end);
    if (existing) return existing.live ? [] : [{ kind: 'reference', code: '#REF!', sourceSpan: lexeme.sourceSpan }];
    const fragment = `=${definition.body.slice(lexeme.sourceSpan.start, lexeme.sourceSpan.end)}`;
    const reference = analyzeStoredFormula(prepareFunctionBody(fragment, workbook, callerSheetId, parameters), workbook, callerSheetId, parameters);
    return reference.references.length === 1 && reference.references[0].live ? [] : [{ kind: 'reference', code: '#REF!', sourceSpan: lexeme.sourceSpan }];
  });
  return { syntax, diagnostics: [...syntax.diagnostics.filter((diagnostic) => diagnostic.kind !== 'reference'), ...referenceDiagnostics], bound };
}
