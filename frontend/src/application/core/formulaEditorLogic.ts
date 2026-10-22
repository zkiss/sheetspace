import { builtInFormulaFunctions } from '@calculation/formulaBuiltins';
import type { FormulaScalarValue } from '@calculation/formulaValue';
import { analyzeFormulaSyntax, type FormulaReferenceResolver } from '@workbook/formula/reference';
import { rangeReferenceIdentity, type FormulaReferenceIdentity } from '@workbook/core/referenceIdentity';
import { formatSheetReferenceToken, parseFormulaSyntax, type FormulaReference, type FormulaSourceSpan, type FormulaSyntaxResult, type FormulaSyntaxToken } from '@workbook/formula/syntax';

export type FormulaEditorSelection = { start: number; end: number };
export type FormulaCompletion = {
  kind: 'function' | 'sheet' | 'property';
  label: string;
  insertText: string;
  replacement: FormulaSourceSpan;
};
export type FormulaFormattingResult =
  | { available: true; raw: string; selection: FormulaEditorSelection }
  | { available: false; raw: string; selection: FormulaEditorSelection };
export type FormulaReferenceHover =
  | { kind: 'broken'; identity?: FormulaReferenceIdentity }
  | { kind: 'value'; identity: FormulaReferenceIdentity; value: FormulaScalarValue }
  | { kind: 'range'; identity: FormulaReferenceIdentity; values: readonly FormulaScalarValue[]; truncated: boolean }
  | { kind: 'model-context'; identity: FormulaReferenceIdentity };

export type FormulaEditorAnalysis = Pick<FormulaSyntaxResult, 'tokens' | 'references' | 'diagnostics' | 'result'> & {
  referenceIdentities: readonly (FormulaReferenceIdentity | undefined)[];
};

/** The parser and resolver remain the source of syntax, diagnostics, and reference truth. */
export function analyzeFormulaEditor(raw: string, resolver: FormulaReferenceResolver): FormulaEditorAnalysis {
  const analysis = analyzeFormulaSyntax(raw, resolver);
  return {
    result: analysis.result,
    tokens: analysis.tokens,
    references: analysis.references,
    diagnostics: analysis.diagnostics,
    referenceIdentities: analysis.references.map((reference) => stableReferenceIdentity(reference, resolver)),
  };
}

export function formulaCompletions(
  raw: string,
  selection: FormulaEditorSelection,
  options: { sheetNames: readonly string[]; propertyNames?: readonly string[] },
): FormulaCompletion[] {
  const cursor = clamp(selection.start, 0, raw.length);
  const end = clamp(selection.end, cursor, raw.length);
  const syntax = parseFormulaSyntax(raw);
  if (cursorIsInStringLiteral(raw, cursor, syntax.tokens)) return [];
  const before = raw.slice(0, cursor);
  const reference = referenceCompletionContext(before, syntax.tokens);
  if (reference) {
    const replacement = completionReplacement(raw, cursor, end, reference.prefixStart);
    const candidates = reference.afterQualifier
      ? propertyCandidates(options.propertyNames ?? [], reference.query, raw, replacement)
      : [
        ...sheetCandidates(options.sheetNames, reference.query, raw, replacement),
        ...propertyCandidates(options.propertyNames ?? [], reference.query, raw, replacement),
      ];
    return candidates;
  }
  const replacement = completionReplacement(raw, cursor, end);
  const query = raw.slice(replacement.start, cursor).toUpperCase();
  return [...builtInFormulaFunctions.keys()]
    .filter((name) => name.startsWith(query))
    .map((name) => ({ kind: 'function' as const, label: name, insertText: name, replacement }));
}

/** Applies a selected completion without touching the surrounding draft. */
export function applyFormulaCompletion(raw: string, completion: FormulaCompletion): string {
  return raw.slice(0, completion.replacement.start) + completion.insertText + raw.slice(completion.replacement.end);
}

/** Formatting is deliberately opt-in and unavailable for incomplete syntax. */
export function formatFormula(raw: string, selection: FormulaEditorSelection): FormulaFormattingResult {
  const syntax = parseFormulaSyntax(raw);
  if (syntax.result.kind !== 'formula') return { available: false, raw, selection };
  const tokens = syntax.tokens.filter((token) => token.kind !== 'whitespace');
  const leadingRaw = raw.slice(0, tokens[0]!.sourceSpan.start);
  const trailingRaw = raw.slice(tokens[tokens.length - 1]!.sourceSpan.end);
  let output = '';
  const stack: boolean[] = [];
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const text = raw.slice(token.sourceSpan.start, token.sourceSpan.end);
    const previous = tokens[index - 1];
    if (text === '=' && index === 0) {
      output += text;
    } else if (token.kind === 'operator') {
      output = output.trimEnd() + ` ${text} `;
    } else if (text === '(') {
      const isFunction = previous?.kind === 'function';
      stack.push(Boolean(isFunction));
      depth += 1;
      output = output.trimEnd() + '(' + (isFunction ? `\n${'  '.repeat(depth)}` : '');
    } else if (text === ')') {
      const wasFunction = stack.pop() ?? false;
      depth = Math.max(0, depth - 1);
      output = wasFunction ? `${output.trimEnd()}\n${'  '.repeat(depth)})` : `${output.trimEnd()})`;
    } else if (text === ',') {
      output = output.trimEnd() + `,\n${'  '.repeat(depth)}`;
    } else {
      output += text;
    }
  }
  const formatted = leadingRaw + output + trailingRaw;
  return { available: true, raw: formatted, selection: remapSelection(raw, formatted, selection) };
}

export function indentFormulaSelection(raw: string, selection: FormulaEditorSelection): { raw: string; selection: FormulaEditorSelection } {
  return changeLineIndentation(raw, selection, (line) => `  ${line}`);
}

export function outdentFormulaSelection(raw: string, selection: FormulaEditorSelection): { raw: string; selection: FormulaEditorSelection } {
  return changeLineIndentation(raw, selection, (line) => line.startsWith('  ') ? line.slice(2) : line.startsWith('\t') ? line.slice(1) : line);
}

/** A stable target identity is independent of raw spelling and source position. */
export function stableReferenceIdentity(reference: FormulaReference, resolver: FormulaReferenceResolver): FormulaReferenceIdentity | undefined {
  const sheetId = reference.kind === 'canonical'
    ? reference.sheetId ?? resolver.currentSheetId
    : reference.sheetId === undefined ? resolver.currentSheetId : resolver.sheetByQualifier(reference.sheetId);
  if (!sheetId) return undefined;
  if (reference.kind === 'canonical') {
    if (!reference.range) return { kind: 'cell', sheetId, ...reference.coordinate };
    return rangeReferenceIdentity(sheetId, reference.range.start, reference.range.end);
  }
  if (reference.kind === 'named') {
    const coordinate = resolver.namedCoordinateAt?.(sheetId, reference.endpoint.propertyName, reference.endpoint.row)?.coordinate;
    if (!coordinate) return undefined;
    if (!reference.end) return { kind: 'cell', sheetId, ...coordinate };
    const end = resolver.namedCoordinateAt?.(sheetId, reference.end!.propertyName, reference.end!.row)?.coordinate;
    return end ? rangeReferenceIdentity(sheetId, coordinate, end) : undefined;
  }
  const coordinate = resolver.coordinateAt(sheetId, reference.kind === 'cell' ? reference.address : reference.range.start);
  if (!coordinate) return undefined;
  if (reference.kind === 'cell') return { kind: 'cell', sheetId, ...coordinate };
  const end = resolver.coordinateAt(sheetId, reference.range.end);
  return end ? rangeReferenceIdentity(sheetId, coordinate, end) : undefined;
}

export function formulaReferenceHover(
  reference: FormulaReference,
  resolver: FormulaReferenceResolver,
  values: (identity: FormulaReferenceIdentity) => FormulaScalarValue | readonly FormulaScalarValue[] | undefined,
  options: { modelOnly?: boolean; maximumRangeValues?: number } = {},
): FormulaReferenceHover {
  const identity = stableReferenceIdentity(reference, resolver);
  if (!identity) return { kind: 'broken' };
  if (options.modelOnly && reference.sheetId === undefined) return { kind: 'model-context', identity };
  const value = values(identity);
  if (value === undefined) return { kind: 'broken', identity };
  if (identity.kind === 'cell') return isRangeValues(value) ? { kind: 'broken', identity } : { kind: 'value', identity, value };
  const rangeValues = isRangeValues(value) ? value : [value];
  const maximum = options.maximumRangeValues ?? 20;
  return { kind: 'range', identity, values: rangeValues.slice(0, maximum), truncated: rangeValues.length > maximum };
}

function referenceCompletionContext(before: string, tokens: readonly FormulaSyntaxToken[]): { prefixStart: number; query: string; afterQualifier: boolean } | undefined {
  const at = before.lastIndexOf('@');
  if (at < lastCompletionBoundary(tokens, before.length)) return undefined;
  const fragment = before.slice(at + 1);
  const separator = fragment.lastIndexOf('!');
  const query = separator >= 0 ? fragment.slice(separator + 1) : fragment;
  const anchorLength = query.startsWith('$') ? 1 : 0;
  return {
    prefixStart: at + 1 + (separator >= 0 ? separator + 1 : 0) + anchorLength,
    query: unquotePartial(query.slice(anchorLength)),
    afterQualifier: separator >= 0,
  };
}

/** Parser tokens define expression boundaries; incomplete reference text remains raw by design. */
function lastCompletionBoundary(tokens: readonly FormulaSyntaxToken[], cursor: number): number {
  return tokens.reduce((boundary, token) =>
    token.sourceSpan.end <= cursor && (token.kind === 'operator' || token.kind === 'punctuation' || token.kind === 'whitespace')
      ? Math.max(boundary, token.sourceSpan.end)
      : boundary,
  0);
}

function sheetCandidates(names: readonly string[], query: string, raw: string, replacement: FormulaSourceSpan): FormulaCompletion[] {
  const separator = raw[replacement.end] === '!' ? '' : '!';
  return names.filter((name) => name.toUpperCase().startsWith(query.toUpperCase()))
    .map((name) => ({ kind: 'sheet' as const, label: name, insertText: `${formatSheetReferenceToken(name)}${separator}`, replacement }));
}

function propertyCandidates(names: readonly string[], query: string, raw: string, replacement: FormulaSourceSpan): FormulaCompletion[] {
  const rowSuffix = /^\[\$?[1-9][0-9]*\]/.test(raw.slice(replacement.end)) ? '' : '[1]';
  return names.filter((name) => name.toUpperCase().startsWith(query.toUpperCase()))
    .map((name) => ({ kind: 'property' as const, label: name, insertText: `'${name.replace(/'/g, "''")}'${rowSuffix}`, replacement }));
}

function completionReplacement(raw: string, cursor: number, selectionEnd: number, minimum = 0): FormulaSourceSpan {
  if (selectionEnd > cursor) return { start: cursor, end: selectionEnd };
  let start = cursor;
  let end = cursor;
  while (start > minimum && /[A-Za-z0-9_.']/.test(raw[start - 1]!)) start -= 1;
  while (end < raw.length && /[A-Za-z0-9_.']/.test(raw[end]!)) end += 1;
  return { start, end };
}

function cursorIsInStringLiteral(raw: string, cursor: number, tokens: readonly FormulaSyntaxToken[]): boolean {
  if (tokens.some((token) => token.kind === 'literal' && token.sourceSpan.start < cursor && cursor < token.sourceSpan.end)) return true;
  let quoted = false;
  for (let index = 0; index < cursor; index += 1) {
    if (raw[index] !== '"') continue;
    if (quoted && raw[index + 1] === '"') { index += 1; continue; }
    quoted = !quoted;
  }
  return quoted;
}

function unquotePartial(value: string): string { return value.startsWith("'") ? value.slice(1).replace(/''/g, "'") : value; }
function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)); }
function isRangeValues(value: FormulaScalarValue | readonly FormulaScalarValue[]): value is readonly FormulaScalarValue[] { return Array.isArray(value); }

function changeLineIndentation(raw: string, selection: FormulaEditorSelection, change: (line: string) => string): { raw: string; selection: FormulaEditorSelection } {
  const start = clamp(selection.start, 0, raw.length);
  const end = clamp(selection.end, start, raw.length);
  const lineStart = raw.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const lineEnd = end > start && raw[end - 1] === '\n' ? end - 1 : end;
  const affectedEnd = raw.indexOf('\n', lineEnd);
  const blockEnd = affectedEnd < 0 ? raw.length : affectedEnd;
  const block = raw.slice(lineStart, blockEnd);
  const lines = block.split('\n');
  const changed = lines.map(change);
  let relativeLineStart = lineStart;
  const lineChanges = lines.map((line, index) => {
    const entry = { start: relativeLineStart, change: changed[index]!.length - line.length };
    relativeLineStart += line.length + 1;
    return entry;
  });
  const remap = (position: number) => position + lineChanges
    .filter((line) => line.start <= position)
    .reduce((total, line) => total + line.change, 0);
  const selectedStart = remap(start);
  const selectedEnd = remap(end);
  return { raw: raw.slice(0, lineStart) + changed.join('\n') + raw.slice(blockEnd), selection: { start: selectedStart, end: selectedEnd } };
}

function remapSelection(before: string, after: string, selection: FormulaEditorSelection): FormulaEditorSelection {
  if (before === after) return selection;
  let unchangedSuffix = 0;
  while (unchangedSuffix < before.length && unchangedSuffix < after.length
    && before[before.length - unchangedSuffix - 1] === after[after.length - unchangedSuffix - 1]) unchangedSuffix += 1;
  if (selection.start >= before.length - unchangedSuffix) {
    return {
      start: after.length - (before.length - selection.start),
      end: after.length - (before.length - selection.end),
    };
  }
  const prefix = before.slice(0, selection.start).replace(/\s/g, '').length;
  const selected = before.slice(selection.start, selection.end).replace(/\s/g, '').length;
  let nonWhitespace = 0;
  let start = after.length;
  let end = after.length;
  for (let index = 0; index < after.length; index += 1) {
    if (!/\s/.test(after[index]!)) nonWhitespace += 1;
    if (nonWhitespace >= prefix && start === after.length) start = index + 1;
    if (nonWhitespace >= prefix + selected) { end = index + 1; break; }
  }
  const mappedEnd = selection.end >= before.length - unchangedSuffix
    ? after.length - (before.length - selection.end)
    : end;
  return { start, end: Math.max(start, mappedEnd) };
}
