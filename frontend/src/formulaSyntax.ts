import {
  normalizeRange,
  parseA1Address,
  type CellAddress,
  type CellRange,
} from './cellAddress';

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
};

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
  if (!raw.startsWith('=')) {
    return { result: { kind: 'not-formula', raw }, references: [] };
  }
  return new FormulaParser(raw.slice(1)).parse(raw);
}

export function collectFormulaReferences(expression: FormulaExpression): FormulaReference[] {
  switch (expression.kind) {
    case 'cell':
    case 'range':
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

type ReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: FormulaErrorCode };

class FormulaParser {
  private index = 0;
  private readonly references: FormulaReference[] = [];

  constructor(private readonly input: string) {}

  parse(raw: string): FormulaSyntaxResult {
    this.skipWhitespace();
    const expression = this.readComparison();
    this.skipWhitespace();
    const trailingSyntax = expression.ok && !this.atEnd();
    if (!expression.ok || trailingSyntax) {
      this.recoverRemainingReferences();
    }
    const result: FormulaParseResult = !expression.ok
      ? { kind: 'error', raw, error: expression.error }
      : trailingSyntax
        ? { kind: 'error', raw, error: '#PARSE!' }
        : { kind: 'formula', raw, expression: expression.value };
    return { result, references: [...this.references] };
  }

  /**
   * Continues lexical reference recognition after AST construction fails.
   * This keeps qualifier transforms safe for in-progress formulas without
   * maintaining a second interpretation of reference syntax.
   */
  private recoverRemainingReferences(): void {
    while (!this.atEnd()) {
      this.skipWhitespace();
      if (this.atEnd()) {
        return;
      }
      if (this.peek() === '"') {
        this.skipTextLiteral();
        continue;
      }

      const candidateStart = this.index;
      const existingCount = this.references.length;
      const candidate = this.readReference();
      if (candidate.ok) {
        const recovered = this.references[this.references.length - 1];
        const duplicate = recovered && this.references
          .slice(0, -1)
          .some((reference) =>
            reference.sourceSpan.start === recovered.sourceSpan.start
            && reference.sourceSpan.end === recovered.sourceSpan.end,
          );
        if (duplicate) {
          this.references.pop();
        }
        continue;
      }

      const attemptedEnd = this.index;
      this.references.length = existingCount;
      this.index = this.input[candidateStart] === "'"
        ? Math.max(candidateStart + 1, attemptedEnd)
        : candidateStart + 1;
    }
  }

  private skipTextLiteral(): void {
    this.index += 1;
    while (!this.atEnd()) {
      if (this.peek() !== '"') {
        this.index += 1;
      } else if (this.input[this.index + 1] === '"') {
        this.index += 2;
      } else {
        this.index += 1;
        return;
      }
    }
  }

  private readComparison(): ReadResult<FormulaExpression> {
    const left = this.readAdditive();
    if (!left.ok) return left;
    this.skipWhitespace();
    const operator = this.readComparisonOperator();
    if (!operator) return left;
    const right = this.readAdditive();
    if (!right.ok) return right;
    return {
      ok: true,
      value: {
        kind: 'binary',
        operator,
        left: left.value,
        right: right.value,
        sourceSpan: { start: left.value.sourceSpan.start, end: right.value.sourceSpan.end },
      },
    };
  }

  private readComparisonOperator(): BinaryFormula['operator'] | undefined {
    for (const operator of ['<>', '<=', '>=', '=', '<', '>'] as const) {
      if (this.input.startsWith(operator, this.index)) {
        this.index += operator.length;
        return operator;
      }
    }
    return undefined;
  }

  private readAdditive(): ReadResult<FormulaExpression> {
    let left = this.readMultiplicative();
    if (!left.ok) return left;
    while (true) {
      this.skipWhitespace();
      const operator = this.peek();
      if (operator !== '+' && operator !== '-') return left;
      this.index += 1;
      const right = this.readMultiplicative();
      if (!right.ok) return right;
      left = {
        ok: true,
        value: {
          kind: 'binary',
          operator,
          left: left.value,
          right: right.value,
          sourceSpan: { start: left.value.sourceSpan.start, end: right.value.sourceSpan.end },
        },
      };
    }
  }

  private readMultiplicative(): ReadResult<FormulaExpression> {
    let left = this.readUnary();
    if (!left.ok) return left;
    while (true) {
      this.skipWhitespace();
      const operator = this.peek();
      if (operator !== '*' && operator !== '/') return left;
      this.index += 1;
      const right = this.readUnary();
      if (!right.ok) return right;
      left = {
        ok: true,
        value: {
          kind: 'binary',
          operator,
          left: left.value,
          right: right.value,
          sourceSpan: { start: left.value.sourceSpan.start, end: right.value.sourceSpan.end },
        },
      };
    }
  }

  private readUnary(): ReadResult<FormulaExpression> {
    this.skipWhitespace();
    const start = this.index;
    const operator = this.peek();
    if (operator === '+' || operator === '-') {
      this.index += 1;
      const operand = this.readUnary();
      return operand.ok
        ? {
            ok: true,
            value: {
              kind: 'unary',
              operator,
              operand: operand.value,
              sourceSpan: { start: start + 1, end: operand.value.sourceSpan.end },
            },
          }
        : operand;
    }
    if (this.consume('(')) {
      const expression = this.readComparison();
      if (!expression.ok) return expression;
      this.skipWhitespace();
      if (!this.consume(')')) return this.error();
      return {
        ok: true,
        value: { kind: 'group', expression: expression.value, sourceSpan: this.span(start) },
      };
    }
    if (this.peek() === '"') return this.readText();
    if (this.findUnquotedSheetSeparator() !== -1) return this.readReference();
    const number = this.readNumber();
    if (number) return { ok: true, value: number };

    const identifierStart = this.index;
    const identifier = this.readIdentifier();
    if (identifier) {
      const normalized = identifier.toUpperCase();
      if ((normalized === 'TRUE' || normalized === 'FALSE') && !this.identifierChar(this.peek())) {
        return {
          ok: true,
          value: {
            kind: 'boolean',
            value: normalized === 'TRUE',
            sourceSpan: this.span(identifierStart),
          },
        };
      }
      this.skipWhitespace();
      if (this.peek() === '(') return this.readFunction(normalized, identifierStart);
      this.index = identifierStart;
    }
    return this.readReference();
  }

  private readFunction(functionName: string, start: number): ReadResult<FormulaExpression> {
    this.consume('(');
    const args: FormulaExpression[] = [];
    this.skipWhitespace();
    if (this.consume(')')) {
      return {
        ok: true,
        value: { kind: 'function', functionName, arguments: args, sourceSpan: this.span(start) },
      };
    }
    while (true) {
      const argument = this.readComparison();
      if (!argument.ok) return argument;
      args.push(argument.value);
      this.skipWhitespace();
      if (this.consume(',')) {
        this.skipWhitespace();
        if (this.peek() === ')' || this.atEnd()) return this.error();
        continue;
      }
      if (!this.consume(')')) return this.error();
      return {
        ok: true,
        value: { kind: 'function', functionName, arguments: args, sourceSpan: this.span(start) },
      };
    }
  }

  private readNumber(): FormulaLiteral | undefined {
    const start = this.index;
    const match = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(
      this.input.slice(this.index),
    );
    if (!match) return undefined;
    this.index += match[0].length;
    return { kind: 'number', value: Number(match[0]), sourceSpan: this.span(start) };
  }

  private readText(): ReadResult<FormulaExpression> {
    const start = this.index++;
    let value = '';
    while (!this.atEnd()) {
      if (this.peek() !== '"') {
        value += this.peek();
        this.index += 1;
      } else if (this.input[this.index + 1] === '"') {
        value += '"';
        this.index += 2;
      } else {
        this.index += 1;
        return {
          ok: true,
          value: { kind: 'text', value, sourceSpan: this.span(start) },
        };
      }
    }
    return this.error();
  }

  private readReference(): ReadResult<FormulaExpression> {
    const start = this.index;
    const qualifier = this.readOptionalQualifier();
    if (qualifier === false) return this.error();
    const firstToken = this.readA1Token();
    if (!firstToken) return this.error();
    const firstEnd = this.index;
    const first = parseA1Address(firstToken, {
      columnCount: Number.MAX_SAFE_INTEGER,
      rowCount: Number.MAX_SAFE_INTEGER,
    });
    if (!first.ok) {
      return {
        ok: false,
        error: first.reason === 'out-of-bounds' ? '#REF!' : '#PARSE!',
      };
    }
    this.skipWhitespace();
    if (!this.consume(':')) {
      const reference: FormulaReference = {
        kind: 'cell',
        ...(qualifier.sheetId === undefined ? {} : { sheetId: qualifier.sheetId }),
        address: first.value,
        sourceSpan: this.spanTo(start, firstEnd),
        ...(qualifier.sourceSpan ? { sheetReferenceSpan: qualifier.sourceSpan } : {}),
      };
      this.references.push(reference);
      return { ok: true, value: reference };
    }

    this.skipWhitespace();
    const secondToken = this.readA1Token();
    if (!secondToken) {
      this.references.push({
        kind: 'cell',
        ...(qualifier.sheetId === undefined ? {} : { sheetId: qualifier.sheetId }),
        address: first.value,
        sourceSpan: this.spanTo(start, firstEnd),
        ...(qualifier.sourceSpan ? { sheetReferenceSpan: qualifier.sourceSpan } : {}),
      });
      return this.error();
    }
    const second = parseA1Address(secondToken, {
      columnCount: Number.MAX_SAFE_INTEGER,
      rowCount: Number.MAX_SAFE_INTEGER,
    });
    if (!second.ok) return this.error();
    const reference: FormulaReference = {
      kind: 'range',
      ...(qualifier.sheetId === undefined ? {} : { sheetId: qualifier.sheetId }),
      range: normalizeRange({ start: first.value, end: second.value }),
      sourceSpan: this.span(start),
      ...(qualifier.sourceSpan ? { sheetReferenceSpan: qualifier.sourceSpan } : {}),
    };
    this.references.push(reference);
    return { ok: true, value: reference };
  }

  private readOptionalQualifier(): { sheetId?: string; sourceSpan?: FormulaSourceSpan } | false {
    const start = this.index;
    const quoted = this.readQuotedSheetName();
    if (quoted === false) return false;
    if (quoted !== undefined) {
      const end = this.index;
      this.skipWhitespace();
      if (!this.consume('!')) return false;
      this.skipWhitespace();
      return { sheetId: quoted, sourceSpan: this.spanTo(start, end) };
    }
    this.index = start;
    const separator = this.findUnquotedSheetSeparator();
    if (separator === -1) return {};
    let end = separator;
    while (end > start && /\s/.test(this.input[end - 1])) end -= 1;
    const sheetId = this.input.slice(start, end);
    if (!sheetId || sheetId.includes("'")) return false;
    this.index = separator + 1;
    this.skipWhitespace();
    return { sheetId, sourceSpan: this.spanTo(start, end) };
  }

  private readQuotedSheetName(): string | undefined | false {
    if (this.peek() !== "'") return undefined;
    this.index += 1;
    let name = '';
    while (!this.atEnd()) {
      if (this.peek() !== "'") {
        name += this.peek();
        this.index += 1;
      } else if (this.input[this.index + 1] === "'") {
        name += "'";
        this.index += 2;
      } else {
        this.index += 1;
        return name || false;
      }
    }
    return false;
  }

  private findUnquotedSheetSeparator(): number {
    const separator = this.input.indexOf('!', this.index);
    const candidate = separator < 0 ? '' : this.input.slice(this.index, separator).trim();
    for (let cursor = this.index; cursor < this.input.length; cursor += 1) {
      const char = this.input[cursor];
      if (char === '!') return cursor;
      if (char === '(' || char === ',' || char === ')' || /[+*/=<>]/.test(char)) return -1;
      if (
        char === ':'
        && !(cursor === this.index + 'pending'.length && this.input.startsWith('pending:', this.index))
      ) return -1;
      if (
        char === '-'
        && !isUuidLike(candidate)
        && isCompletedScalar(this.input.slice(this.index, cursor).trim())
      ) return -1;
    }
    return -1;
  }

  private readA1Token(): string | undefined {
    const match = /^[A-Za-z]+[1-9][0-9]*/.exec(this.input.slice(this.index));
    if (!match) return undefined;
    this.index += match[0].length;
    return this.peek() && /[A-Za-z0-9]/.test(this.peek()) ? undefined : match[0];
  }

  private readIdentifier(): string | undefined {
    const match = /^[A-Za-z][A-Za-z0-9_]*/.exec(this.input.slice(this.index));
    if (!match) return undefined;
    this.index += match[0].length;
    return match[0];
  }

  private identifierChar(char: string): boolean {
    return char.length > 0 && /[A-Za-z0-9_]/.test(char);
  }

  private span(start: number): FormulaSourceSpan {
    return this.spanTo(start, this.index);
  }

  private spanTo(start: number, end: number): FormulaSourceSpan {
    return { start: start + 1, end: end + 1 };
  }

  private skipWhitespace(): void {
    while (!this.atEnd() && /\s/.test(this.peek())) this.index += 1;
  }

  private consume(char: string): boolean {
    if (this.peek() !== char) return false;
    this.index += 1;
    return true;
  }

  private peek(): string {
    return this.input[this.index] ?? '';
  }

  private atEnd(): boolean {
    return this.index >= this.input.length;
  }

  private error(): ReadResult<never> {
    return { ok: false, error: '#PARSE!' };
  }
}

function isUuidLike(candidate: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate);
}

function isCompletedScalar(candidate: string): boolean {
  return (
    /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(candidate)
    || /^(?:TRUE|FALSE)$/i.test(candidate)
    || /^[A-Za-z]+[1-9][0-9]*$/.test(candidate)
    || /!\s*[A-Za-z]+[1-9][0-9]*(?:\s*:\s*[A-Za-z]+[1-9][0-9]*)?$/.test(candidate)
    || candidate.endsWith(')')
  );
}
