import { normalizeRange, parseA1Address, type CellAddress } from '../core/address';
import type {
  BinaryFormula,
  FormulaErrorCode,
  FormulaExpression,
  FormulaLiteral,
  FormulaParseResult,
  FormulaReference,
  FormulaReferenceLexeme,
  FormulaSourceSpan,
  FormulaSyntaxResult,
} from './syntaxTypes';

type ReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: FormulaErrorCode };

export class FormulaParser {
  private index = 0;
  private readonly references: FormulaReference[] = [];
  private readonly referenceLexemes: FormulaReferenceLexeme[] = [];

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
    return { result, references: [...this.references], referenceLexemes: [...this.referenceLexemes] };
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
      this.index = this.input[candidateStart + 1] === "'"
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
    if (this.peek() === '@') return this.readReference();
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
    if (!this.consume('@')) return this.error();
    const qualifier = this.readOptionalQualifier();
    if (qualifier === false) return this.error();
    const first = this.readReferenceEndpoint();
    if (!first) return this.error();
    const firstEnd = this.index;
    this.skipWhitespace();
    if (!this.consume(':')) {
      const reference = this.makeReference(first, undefined, qualifier, start, firstEnd);
      this.recordReference(reference, qualifier, [first]);
      return { ok: true, value: reference };
    }

    this.skipWhitespace();
    const second = this.readReferenceEndpoint();
    if (!second || !this.referenceEndpointsMatch(first, second)) {
      return this.error();
    }
    const reference = this.makeReference(first, second, qualifier, start, this.index);
    this.recordReference(reference, qualifier, [first, second]);
    return { ok: true, value: reference };
  }

  private referenceEndpointsMatch(first: FormulaReferenceLexeme['endpoints'][number], second: FormulaReferenceLexeme['endpoints'][number]): boolean {
    return first.kind === second.kind;
  }

  private isStoredNamedEndpoint(endpoint: FormulaReferenceLexeme['endpoints'][number]): boolean {
    return endpoint.kind === 'named' && Boolean((endpoint.value as { columnId: string }).columnId);
  }

  private readReferenceEndpoint(): FormulaReferenceLexeme['endpoints'][number] | undefined {
    const start = this.index;
    const named = /^(\$?)~([0-9a-f]+)~([0-9a-f]+)\[(\$?)([0-9a-f]+)\]/i.exec(this.input.slice(this.index));
    if (named) {
      const propertyId = decodeStableId(named[2]);
      const columnId = decodeStableId(named[3]);
      const rowId = decodeStableId(named[5]);
      if (propertyId === undefined || columnId === undefined || rowId === undefined) return undefined;
      this.index += named[0].length;
      return { kind: 'named', value: { propertyId, columnId, rowId }, anchors: { column: named[1] === '$', row: named[4] === '$' }, sourceSpan: this.span(start) };
    }
    const propertyStart = this.index;
    const propertyAnchor = this.consume('$');
    const property = this.readQuotedProperty();
    if (property !== undefined) {
      const row = /^\[(\$?)([1-9][0-9]*)\]/.exec(this.input.slice(this.index));
      if (!row) return undefined;
      this.index += row[0].length;
      return { kind: 'named', value: { propertyId: property, columnId: '', rowId: row[2] }, anchors: { column: propertyAnchor, row: row[1] === '$' }, sourceSpan: this.span(start) };
    }
    this.index = propertyStart;
    const canonical = /^(\$?)([A-Za-z0-9_:-]+)\[(\$?)([A-Za-z0-9_:-]+)\]/.exec(this.input.slice(this.index));
    if (canonical && !/^[A-Za-z]+$/.test(canonical[2])) {
      this.index += canonical[0].length;
      return {
        kind: 'canonical',
        value: { columnId: canonical[2], rowId: canonical[4] },
        anchors: { column: canonical[1] === '$', row: canonical[3] === '$' },
        sourceSpan: this.span(start),
      };
    }
    const token = this.readA1Token();
    if (!token) return undefined;
    const address = parseA1Address(token.replace(/[$[\]]/g, ''), {
      columnCount: Number.MAX_SAFE_INTEGER,
      rowCount: Number.MAX_SAFE_INTEGER,
    });
    if (!address.ok) return undefined;
    return {
      kind: 'a1',
      value: address.value,
      anchors: { column: token.startsWith('$'), row: /\$[0-9]/.test(token) },
      sourceSpan: this.span(start),
    };
  }

  private makeReference(
    first: FormulaReferenceLexeme['endpoints'][number],
    second: FormulaReferenceLexeme['endpoints'][number] | undefined,
    qualifier: Exclude<ReturnType<FormulaParser['readOptionalQualifier']>, false>,
    start: number,
    end: number,
  ): FormulaReference {
    const base = {
      ...(qualifier.sheetId === undefined ? {} : { sheetId: qualifier.sheetId }),
      sourceSpan: this.spanTo(start, end),
      ...(qualifier.sourceSpan ? { sheetReferenceSpan: qualifier.sourceSpan } : {}),
    };
    if (first.kind === 'canonical' || first.kind === 'named') {
      const named = this.isStoredNamedEndpoint(first);
      const value = first.value as { propertyId?: string; columnId: string; rowId: string };
      const coordinate = { columnId: value.columnId, rowId: value.rowId };
      const endValue = second?.value as { propertyId?: string; columnId: string; rowId: string } | undefined;
      return {
        kind: 'canonical',
        ...base,
        coordinate,
        ...(named ? { propertyId: value.propertyId } : {}),
        ...(second ? { range: { start: coordinate, end: { columnId: endValue!.columnId, rowId: endValue!.rowId }, ...(named || this.isStoredNamedEndpoint(second) ? { startPropertyId: named ? value.propertyId : undefined, endPropertyId: this.isStoredNamedEndpoint(second) ? endValue!.propertyId : undefined } : {}) } } : {}),
      };
    }
    if (!second) return { kind: 'cell', ...base, address: first.value as CellAddress };
    return { kind: 'range', ...base, range: normalizeRange({ start: first.value as CellAddress, end: second.value as CellAddress }) };
  }

  private recordReference(
    reference: FormulaReference,
    qualifier: Exclude<ReturnType<FormulaParser['readOptionalQualifier']>, false>,
    endpoints: FormulaReferenceLexeme['endpoints'],
  ): void {
    this.references.push(reference);
    this.referenceLexemes.push({
      sourceSpan: reference.sourceSpan,
      ...(qualifier.sourceSpan && qualifier.sheetId !== undefined
        ? { qualifier: { value: qualifier.sheetId, sourceSpan: qualifier.sourceSpan, broken: qualifier.sheetId === '#REF' } }
        : {}),
      endpoints,
    });
  }

  private readOptionalQualifier(): { sheetId?: string; sourceSpan?: FormulaSourceSpan } | false {
    const start = this.index;
    const quoted = this.readQuotedSheetName();
    if (quoted === false) return false;
    if (quoted !== undefined) {
      const end = this.index;
      this.skipWhitespace();
      if (!this.consume('!')) { this.index = start; return {}; }
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

  private readQuotedProperty(): string | undefined {
    const start = this.index;
    if (this.peek() !== "'") { this.index = start; return undefined; }
    const name = this.readQuotedSheetName();
    if (name === false || name === undefined) { this.index = start; return undefined; }
    // The raw property name is carried in this temporary endpoint until semantic resolution.
    // Prefixing it keeps it distinct from persisted IDs before reference.ts replaces it.
    return name;
  }

  private findUnquotedSheetSeparator(): number {
    const match = /^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*|#REF)\s*!/.exec(this.input.slice(this.index));
    return match ? this.index + match[0].length - 1 : -1;
  }

  private readA1Token(): string | undefined {
    const match = /^(?:\$?[A-Za-z]+\[\$?[1-9][0-9]*\])/.exec(this.input.slice(this.index));
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

/** Decodes the fixed-width UTF-16 representation emitted for named stable IDs. */
function decodeStableId(value: string): string | undefined {
  if (value.length === 0 || value.length % 4 !== 0) return undefined;
  let decoded = '';
  for (let index = 0; index < value.length; index += 4) decoded += String.fromCharCode(Number.parseInt(value.slice(index, index + 4), 16));
  return decoded;
}
