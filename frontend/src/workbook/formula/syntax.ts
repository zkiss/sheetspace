import type {
  FormulaExpression,
  FormulaParseResult,
  FormulaSourceSpan,
  FormulaReference,
  FormulaReferenceLexeme,
  FormulaSyntaxResult,
} from './syntaxTypes';
import { FormulaParser } from './syntaxParser';

export { mergeFormulaDiagnostics } from './diagnostics';

export type {
  BinaryFormula,
  FormulaErrorCode,
  FormulaExpression,
  FormulaLiteral,
  FormulaParseResult,
  FormulaReference,
  FormulaReferenceLexeme,
  FormulaSourceSpan,
  FormulaSyntaxResult,
  FormulaSyntaxToken,
  FormulaDiagnostic,
  FunctionFormula,
  GroupFormula,
  UnaryFormula,
} from './syntaxTypes';

export function formulaReferenceLexemes(raw: string): FormulaReferenceLexeme[] {
  return parseFormulaSyntax(raw, { preserveUnknownFunctions: true }).referenceLexemes;
}

/** Syntactically valid calls retain one general function AST. */
export function parseFormula(raw: string): FormulaParseResult {
  return parseFormulaSyntax(raw).result;
}

export function parseFormulaForInspection(raw: string): FormulaParseResult {
  return parseFormulaSyntax(raw).result;
}

/**
 * Shared parse result for evaluation, transformation, inspection, and navigation.
 * References remain available when later syntax makes the complete formula invalid.
 */
export function parseFormulaSyntax(
  raw: string,
  _options: { preserveUnknownFunctions?: boolean } = {},
): FormulaSyntaxResult {
  void _options;
  if (!raw.startsWith('=')) {
    return { result: { kind: 'not-formula', raw }, references: [], referenceLexemes: [], tokens: raw ? [{ kind: 'text', sourceSpan: { start: 0, end: raw.length } }] : [], diagnostics: [] };
  }
  return new FormulaParser(raw.slice(1)).parse(raw);
}

export function collectFormulaReferences(expression: FormulaExpression): FormulaReference[] {
  switch (expression.kind) {
    case 'cell':
    case 'range':
    case 'canonical':
      return [expression];
    case 'number':
    case 'text':
    case 'boolean':
      return [];
    case 'group':
      return collectFormulaReferences(expression.expression);
    case 'unary':
      return collectFormulaReferences(expression.operand);
    case 'binary':
      return [
        ...collectFormulaReferences(expression.left),
        ...collectFormulaReferences(expression.right),
      ];
    case 'function':
      return expression.arguments.flatMap(collectFormulaReferences);
  }
}

export type FormulaQualifierReplacement = FormulaSourceSpan & {
  sheetReference: string;
};

/** Replaces qualifier text only. All other raw spelling and whitespace survives. */
export function replaceFormulaQualifiers(
  raw: string,
  replacement: (sheetReference: string) => string,
): string {
  const replacements = parseFormulaSyntax(raw, { preserveUnknownFunctions: true }).references
    .flatMap((reference): FormulaQualifierReplacement[] =>
      reference.sheetReferenceSpan && reference.sheetId !== undefined
        ? [{ ...reference.sheetReferenceSpan, sheetReference: reference.sheetId }]
        : [],
    );
  return replacements
    .sort((a, b) => b.start - a.start)
    .reduce(
      (result, token) =>
        result.slice(0, token.start) + replacement(token.sheetReference) + result.slice(token.end),
      raw,
    );
}

export function formulaSheetReferences(raw: string): string[] {
  return parseFormulaSyntax(raw, { preserveUnknownFunctions: true }).references.flatMap(
    (reference) => reference.sheetId === undefined ? [] : [reference.sheetId],
  );
}

export function formatSheetReferenceToken(sheetName: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(sheetName)
    ? sheetName
    : `'${sheetName.replace(/'/g, "''")}'`;
}
