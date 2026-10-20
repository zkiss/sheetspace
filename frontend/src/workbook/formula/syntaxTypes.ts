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

export type FormulaReference =
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

export type FormulaSyntaxResult = {
  result: FormulaParseResult;
  /** Ordered references parsed before success or failure. */
  references: FormulaReference[];
  /** Exact transform tokens emitted by the parser in normal grammar contexts. */
  referenceLexemes: FormulaReferenceLexeme[];
};

/** Exact reference lexemes for source-preserving transforms.  This is the sole lexical authority. */
export type FormulaReferenceLexeme = {
  sourceSpan: FormulaSourceSpan;
  qualifier?: { value: string; sourceSpan: FormulaSourceSpan; broken: boolean };
  endpoints: readonly { kind: 'a1' | 'canonical' | 'named'; value: CellAddress | { columnId: string; rowId: string } | { propertyId: string; columnId: string; rowId: string }; anchors: { column: boolean; row: boolean }; sourceSpan: FormulaSourceSpan }[];
};
