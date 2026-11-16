import { builtInFormulaFunctions } from '@calculation/formulaBuiltins';
import type { FormulaScalarValue } from '@calculation/formulaValue';
import { analyzeFormulaSyntax, type FormulaReferenceResolver } from '@workbook/formula/reference';
import { rangeReferenceIdentity, type FormulaReferenceIdentity } from '@workbook/core/referenceIdentity';
import { formatPropertyReferenceToken, formatSheetReferenceToken, parseFormulaSyntax, type FormulaReference, type FormulaSourceSpan, type FormulaSyntaxResult } from '@workbook/formula/syntax';
import { rowReferenceTarget } from '@workbook/formula/rowReferenceTarget';

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
export function analyzeFormulaEditor(raw: string, resolver: FormulaReferenceResolver, parameters?: readonly string[]): FormulaEditorAnalysis {
  const analysis = analyzeFormulaSyntax(raw, resolver, false, parameters);
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
  options: { sheetNames: readonly string[]; propertyNames?: readonly string[]; propertyNamesForSheet?: (qualifier: string) => readonly string[]; automatic?: boolean },
): FormulaCompletion[] {
  if (!raw.startsWith('=') || selection.start !== selection.end) return [];
  const cursor = clamp(selection.start, 0, raw.length);
  const context = referenceCompletionContext(raw, cursor);
  if (context.kind === 'suppressed') return [];
  if (context.kind === 'reference') {
    const properties = context.qualifier !== undefined
      ? options.propertyNamesForSheet?.(context.qualifier) ?? []
      : options.propertyNames ?? [];
    return [
      ...(context.sheets ? sheetCandidates(options.sheetNames, context.query, raw, context.replacement) : []),
      ...(context.properties ? propertyCandidates(properties, context.query, context.replacement) : []),
    ];
  }
  const replacement = context.replacement;
  const query = raw.slice(replacement.start, cursor).toUpperCase();
  if (options.automatic && (query.length < 2 || !/^[A-Z][A-Z0-9_]*$/.test(query))) return [];
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
  if (reference.kind === 'row-reference') {
    const target = rowReferenceTarget(reference, resolver);
    if (!target) return undefined;
    return target.end ? rangeReferenceIdentity(target.sheetId, target.start, target.end) : { kind: 'cell', sheetId: target.sheetId, ...target.start };
  }
  const sheetId = reference.kind === 'canonical'
    ? reference.sheetId ?? resolver.currentSheetId
    : reference.sheetId === undefined ? resolver.currentSheetId : resolver.sheetByQualifier(reference.sheetId);
  if (!sheetId) return undefined;
  if (reference.kind === 'canonical') {
    if (!reference.range) return { kind: 'cell', sheetId, ...reference.coordinate };
    const lastRow = reference.range.open ? resolver.lastRowId?.(sheetId) : reference.range.end.rowId;
    return lastRow ? rangeReferenceIdentity(sheetId, reference.range.start, { ...reference.range.end, rowId: lastRow }) : undefined;
  }
  if (reference.kind === 'named') {
    const coordinate = resolver.namedCoordinateAt?.(sheetId, reference.endpoint.propertyName, reference.endpoint.row)?.coordinate;
    if (!coordinate) return undefined;
    if (!reference.end) return { kind: 'cell', sheetId, ...coordinate };
    const end = resolver.namedCoordinateAt?.(sheetId, reference.end!.propertyName, reference.end!.row)?.coordinate;
    const lastRow = reference.open ? resolver.lastRowId?.(sheetId) : end?.rowId;
    return end && lastRow ? rangeReferenceIdentity(sheetId, coordinate, { ...end, rowId: lastRow }) : undefined;
  }
  const coordinate = resolver.coordinateAt(sheetId, reference.kind === 'cell' ? reference.address : reference.range.start);
  if (!coordinate) return undefined;
  if (reference.kind === 'cell') return { kind: 'cell', sheetId, ...coordinate };
  const end = resolver.coordinateAt(sheetId, reference.range.end);
  const lastRow = reference.open ? resolver.lastRowId?.(sheetId) : end?.rowId;
  return end && lastRow ? rangeReferenceIdentity(sheetId, coordinate, { ...end, rowId: lastRow }) : undefined;
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

type CompletionName = { start: number; end: number; closed: boolean };

function completionName(raw: string, start: number, cursor: number, qualifier = false): CompletionName {
  if (raw[start] !== "'") {
    let end = start;
    const pattern = qualifier ? /[A-Za-z0-9_.-]/ : /[A-Za-z0-9_]/;
    if (qualifier ? /[A-Za-z0-9_]/.test(raw[end] ?? '') : /[A-Za-z]/.test(raw[end] ?? '')) {
      while (end < raw.length && pattern.test(raw[end]!)) end += 1;
    } else if (qualifier && raw.startsWith('#REF', start)) end += 4;
    return { start, end, closed: true };
  }
  let end = start + 1;
  while (end < raw.length) {
    if (raw[end] === "'") {
      if (raw[end + 1] === "'") { end += 2; continue; }
      return { start, end: end + 1, closed: true };
    }
    end += 1;
  }
  let partialEnd = cursor;
  while (partialEnd < raw.length && /[A-Za-z0-9_]/.test(raw[partialEnd]!)) partialEnd += 1;
  return { start, end: partialEnd, closed: false };
}

function decodedName(raw: string, name: CompletionName, end = name.end): string {
  const text = raw.slice(name.start, end);
  if (!text.startsWith("'")) return text;
  const payload = name.closed && end === name.end ? text.slice(1, -1) : text.slice(1);
  return payload.replace(/''/g, "'");
}

type CompletionContext =
  | { kind: 'suppressed' }
  | { kind: 'function'; replacement: FormulaSourceSpan }
  | { kind: 'reference'; replacement: FormulaSourceSpan; query: string; qualifier?: string; sheets: boolean; properties: boolean };

function referenceCompletionContext(raw: string, cursor: number): CompletionContext {
  const suppressed: CompletionContext = { kind: 'suppressed' };
  if (cursor < 1) return suppressed;
  let operand = true;
  for (let index = 1; index < raw.length;) {
    if (index >= cursor && !(operand && /[A-Za-z]/.test(raw[index]!))) {
      return operand ? { kind: 'function', replacement: { start: cursor, end: cursor } } : suppressed;
    }
    if (/\s/.test(raw[index]!)) { index += 1; continue; }
    if (raw[index] === '"') {
      let end = index + 1;
      while (end < raw.length) {
        if (raw[end] === '"') {
          if (raw[end + 1] === '"') { end += 2; continue; }
          end += 1;
          break;
        }
        end += 1;
      }
      if (cursor > index && cursor < end || cursor === end && raw[end - 1] !== '"') return suppressed;
      index = end;
      operand = false;
      continue;
    }
    if (raw[index] === '@' && operand) {
      const qualifier = completionName(raw, index + 1, cursor, true);
      let separator = qualifier.end;
      while (/\s/.test(raw[separator] ?? '') && separator < raw.length) separator += 1;
      const qualified = qualifier.closed && qualifier.end > qualifier.start && raw[separator] === '!';
      const firstStart = index + 1 + (raw[index + 1] === '$' ? 1 : 0);
      const first = qualified ? qualifier : completionName(raw, firstStart, cursor);
      if (cursor >= first.start && cursor <= first.end) {
        if (raw[first.start] === '$') return suppressed;
        if (raw[first.start] === "'" && raw[cursor - 1] === "'" && raw[cursor] === "'") return suppressed;
        const suffix = raw.slice(first.end).trimStart();
        const anchored = raw[index + 1] === '$';
        return { kind: 'reference', replacement: { start: first.start, end: first.end }, query: decodedName(raw, first, cursor),
          sheets: qualified || (!anchored && !suffix.startsWith('[') && !suffix.startsWith(':')), properties: !qualified };
      }
      if (qualified) {
        let start = separator + 1;
        while (/\s/.test(raw[start] ?? '') && start < raw.length) start += 1;
        if (raw[start] === '$') start += 1;
        const property = completionName(raw, start, cursor);
        if (cursor >= property.start && cursor <= property.end) {
          if (raw[property.start] === "'" && raw[cursor - 1] === "'" && raw[cursor] === "'") return suppressed;
          return { kind: 'reference', replacement: { start: property.start, end: property.end }, query: decodedName(raw, property, cursor), qualifier: decodedName(raw, first), sheets: false, properties: true };
        }
        index = property.end;
      } else {
        index = first.end;
      }
      if (cursor <= index) return suppressed;
      // Rows and range endpoints belong to the reference, even when malformed.
      let bracket = false;
      let quoted = false;
      while (index < raw.length) {
        const char = raw[index]!;
        if (char === "'" && !bracket) {
          if (quoted && raw[index + 1] === "'") { index += 2; continue; }
          quoted = !quoted;
        } else if (!quoted && char === '[') bracket = true;
        else if (!quoted && char === ']') bracket = false;
        else if (!quoted && !bracket && /[+\-*/=<>(),]/.test(char)) break;
        index += 1;
      }
      if (cursor <= index) return suppressed;
      operand = false;
      continue;
    }
    if (/[+\-*/=<>(),]/.test(raw[index]!)) {
      operand = raw[index] !== ')';
      index += 1;
      continue;
    }
    if (operand && /[A-Za-z]/.test(raw[index]!)) {
      const start = index;
      while (/[A-Za-z0-9_]/.test(raw[index] ?? '')) index += 1;
      if (cursor >= start && cursor <= index) return { kind: 'function', replacement: { start, end: index } };
      operand = false;
      continue;
    }
    operand = false;
    index += 1;
  }
  return operand ? { kind: 'function', replacement: { start: cursor, end: cursor } } : suppressed;
}

function sheetCandidates(names: readonly string[], query: string, raw: string, replacement: FormulaSourceSpan): FormulaCompletion[] {
  const separator = /^\s*!/.test(raw.slice(replacement.end)) ? '' : '!';
  return names.filter((name) => name.toUpperCase().startsWith(query.toUpperCase()))
    .map((name) => ({ kind: 'sheet' as const, label: name, insertText: `${formatSheetReferenceToken(name)}${separator}`, replacement }));
}

function propertyCandidates(names: readonly string[], query: string, replacement: FormulaSourceSpan): FormulaCompletion[] {
  return names.filter((name) => name.toUpperCase().startsWith(query.toUpperCase()))
    .map((name) => ({ kind: 'property' as const, label: name, insertText: formatPropertyReferenceToken(name), replacement }));
}

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
