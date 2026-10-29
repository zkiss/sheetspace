import type { CellAddress, CellRange } from '../core/address';

export type FormulaErrorCode =
  | '#PARSE!'
  | '#REF!'
  | '#NAME!'
  | '#VALUE!'
  | '#DIV/0!'
  | '#CYCLE!'
  | '#N/A';

export type FormulaSourceSpan = { start: number; end: number };
export type FormulaNamedColumnPredicate = (qualifier: string | undefined, name: string, payloadSpan: FormulaSourceSpan) => boolean;

export type FormulaReference =
  | {
      kind: 'named';
      sheetId?: string;
      endpoint: { propertyName: string; row: number };
      end?: { propertyName: string; row: number };
      sourceSpan: FormulaSourceSpan;
      sheetReferenceSpan?: FormulaSourceSpan;
    }
  | {
      kind: 'cell';
      sheetId?: string;
      address: CellAddress;
      sourceSpan: FormulaSourceSpan;
      sheetReferenceSpan?: FormulaSourceSpan;
    }
  | {
      kind: 'range';
      sheetId?: string;
      range: CellRange;
      sourceSpan: FormulaSourceSpan;
      sheetReferenceSpan?: FormulaSourceSpan;
    }
  | {
      kind: 'canonical';
      sheetId?: string;
      coordinate: { columnId: string; rowId: string };
      /** Present only for the parser-owned stable representation of a named property. */
      propertyId?: string;
      range?: { start: { columnId: string; rowId: string }; end: { columnId: string; rowId: string }; startPropertyId?: string; endPropertyId?: string };
      sourceSpan: FormulaSourceSpan;
      sheetReferenceSpan?: FormulaSourceSpan;
    };

export type FormulaLiteral =
  | { kind: 'number'; value: number; sourceSpan: FormulaSourceSpan }
  | { kind: 'text'; value: string; sourceSpan: FormulaSourceSpan }
  | { kind: 'boolean'; value: boolean; sourceSpan: FormulaSourceSpan };

export type GroupFormula = {
  kind: 'group';
  expression: FormulaExpression;
  sourceSpan: FormulaSourceSpan;
};

export type UnaryFormula = {
  kind: 'unary';
  operator: '+' | '-';
  operand: FormulaExpression;
  sourceSpan: FormulaSourceSpan;
};

export type BinaryFormula = {
  kind: 'binary';
  operator: '+' | '-' | '*' | '/' | '=' | '<>' | '<' | '<=' | '>' | '>=';
  left: FormulaExpression;
  right: FormulaExpression;
  sourceSpan: FormulaSourceSpan;
};

export type FunctionFormula = {
  kind: 'function';
  functionName: string;
  arguments: FormulaExpression[];
  sourceSpan: FormulaSourceSpan;
};

export type FormulaExpression =
  | FormulaReference
  | FormulaLiteral
  | GroupFormula
  | UnaryFormula
  | BinaryFormula
  | FunctionFormula;

export type FormulaParseResult =
  | { kind: 'not-formula'; raw: string }
  | { kind: 'formula'; raw: string; expression: FormulaExpression }
  | { kind: 'error'; raw: string; error: FormulaErrorCode };

/** A source-preserving presentation token. Spans are half-open offsets into raw input. */
export type FormulaSyntaxToken = {
  kind: 'text' | 'function' | 'literal' | 'operator' | 'reference' | 'punctuation' | 'whitespace' | 'invalid';
  sourceSpan: FormulaSourceSpan;
};

export type FormulaDiagnostic = {
  kind: 'syntax' | 'reference';
  code: '#PARSE!' | '#REF!';
  sourceSpan: FormulaSourceSpan;
};

export type FormulaSyntaxResult = {
  result: FormulaParseResult;
  /** Ordered references parsed before success or failure. */
  references: FormulaReference[];
  /** Exact transform tokens emitted by the parser in normal grammar contexts. */
  referenceLexemes: FormulaReferenceLexeme[];
  /** Ordered, non-overlapping tokens that reproduce raw input exactly. */
  tokens: FormulaSyntaxToken[];
  /** Recovery diagnostics leave the draft and valid surrounding references intact. */
  diagnostics: FormulaDiagnostic[];
};

/** Exact reference lexemes for source-preserving transforms.  This is the sole lexical authority. */
export type FormulaReferenceLexeme = {
  sourceSpan: FormulaSourceSpan;
  qualifier?: { value: string; sourceSpan: FormulaSourceSpan; payloadSpan: FormulaSourceSpan; broken: boolean };
  endpoints: readonly ({ anchors: { column: boolean; row: boolean }; sourceSpan: FormulaSourceSpan; payloadSpans: { column: FormulaSourceSpan; row: FormulaSourceSpan } } & (
    | { kind: 'a1'; value: CellAddress }
    | { kind: 'canonical'; value: { columnId: string; rowId: string } }
    | { kind: 'named'; value: { propertyName: string; row: number } }
    | { kind: 'stored-named'; value: { propertyId: string; columnId: string; rowId: string } }
  ))[];
};
