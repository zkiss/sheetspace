import { columnLabelToIndex, normalizeRange, parseA1Address, type CellAddress } from '../core/address';
import { decodeStableId } from './stableId';
import type { FormulaReference, FormulaReferenceLexeme, FormulaSourceSpan, FormulaNamedColumnPredicate } from './syntaxTypes';

type Endpoint = FormulaReferenceLexeme['endpoints'][number];

export function parsePositionalEndpoint(input: string, start: number): { endpoint: Endpoint; end: number } | undefined {
  const match = /^%(\$?[A-Za-z]+\[\$?[1-9][0-9]*\])/.exec(input.slice(start));
  if (!match || /[A-Za-z0-9]/.test(input[start + match[0].length] ?? '')) return undefined;
  const token = match[1], end = start + match[0].length;
  const address = parseA1Address(token.replace(/[$[\]]/g, ''), { columnCount: Number.MAX_SAFE_INTEGER, rowCount: Number.MAX_SAFE_INTEGER });
  if (!address.ok) return undefined;
  return { end, endpoint: { kind: 'a1', value: address.value, anchors: { column: token.startsWith('$'), row: /\$[0-9]/.test(token) }, sourceSpan: { start: start + 1, end: end + 1 }, payloadSpans: referencePayloadSpans(start + 1 + Number(token.startsWith('$')), start + 1 + token.indexOf('['), start + 2 + token.indexOf('[') + Number(/\[\$/.test(token)), end - 1) } };
}

export function completeUserReferenceStart(input: string, start: number): boolean {
  const before = input.slice(0, start).trimEnd();
  return !before || /[+\-*/=<>(,]$/.test(before) || /\s/.test(input[start - 1]) && !/[:!@$[\]']$/.test(before);
}

export function referencePayloadSpans(columnStart: number, columnEnd: number, rowStart: number, rowEnd: number): Endpoint['payloadSpans'] {
  return { column: { start: columnStart + 1, end: columnEnd + 1 }, row: { start: rowStart + 1, end: rowEnd + 1 } };
}

export function qualifierPayloadSpan(input: string, span: FormulaSourceSpan): FormulaSourceSpan {
  return input[span.start - 1] === "'" ? { start: span.start + 1, end: span.end - 1 } : span;
}

export function makeFormulaReference(
  first: Endpoint,
  second: Endpoint | undefined,
  base: { sheetId?: string; sourceSpan: FormulaSourceSpan; sheetReferenceSpan?: FormulaSourceSpan },
): FormulaReference {
  if (first.kind === 'named') {
    return { kind: 'named', ...base, endpoint: first.value, ...(second?.kind === 'named' ? { end: second.value, ...(second.open ? { open: true } : {}) } : {}) };
  }
  if (first.kind === 'canonical' || first.kind === 'stored-named') {
    const named = first.kind === 'stored-named';
    const value = first.value as { propertyId?: string; columnId: string; rowId: string };
    const coordinate = { columnId: value.columnId, rowId: value.rowId };
    const endValue = second?.value as typeof value | undefined;
    return {
      kind: 'canonical', ...base, coordinate,
      ...(named ? { propertyId: value.propertyId } : {}),
      ...(second ? { range: {
        ...(second.open ? { open: true } : {}), start: coordinate, end: { columnId: endValue!.columnId, rowId: endValue!.rowId },
        ...(named ? { startPropertyId: value.propertyId, endPropertyId: endValue!.propertyId } : {}),
      } } : {}),
    };
  }
  if (!second) return { kind: 'cell', ...base, address: first.value as CellAddress };
  return { kind: 'range', ...base, range: normalizeRange({ start: first.value as CellAddress, end: second.value as CellAddress }), ...(second.open ? { open: true } : {}) };
}

export function parseOpenEndpoint(input: string, start: number, first: Endpoint, qualifier: string | undefined, isNamedColumn: FormulaNamedColumnPredicate | undefined, userReferences: boolean): { endpoint: Endpoint; end: number } | undefined {
  if (input[start] === '%' && first.kind === 'a1') {
    const match = /^%(\$?)([A-Za-z]+)/.exec(input.slice(start));
    const column = match && columnLabelToIndex(match[2]);
    if (!match || !column || !column.ok || input[start + match[0].length] === '[') return undefined;
    const end = start + match[0].length;
    return { end, endpoint: { kind: 'a1', open: true, anchors: { column: Boolean(match[1]), row: false }, value: { columnIndex: column.value, rowIndex: first.value.rowIndex }, sourceSpan: { start: start + 1, end: end + 1 }, payloadSpans: referencePayloadSpans(start + 1 + match[1].length, end, end, end) } };
  }
  const text = input.slice(start);
  const anchor = text.startsWith('$');
  const rest = text.slice(Number(anchor));
  const stable = !userReferences && (first.kind === 'canonical' || first.kind === 'stored-named') && /^~([0-9a-f]+)~([0-9a-f]+)/i.exec(rest);
  const named = /^(?:'((?:[^']|'')+)'|([A-Za-z][A-Za-z0-9_]*))/.exec(rest);
  const length = stable ? stable[0].length : named?.[0].length;
  if (!length || (!stable && rest[length] === '[')) return undefined;
  const end = start + Number(anchor) + length;
  const base = { open: true, anchors: { column: anchor, row: false }, sourceSpan: { start: start + 1, end: end + 1 }, payloadSpans: referencePayloadSpans(start + Number(anchor), end, end, end) };
  if (stable && (first.kind === 'canonical' || first.kind === 'stored-named')) {
    const left = decodeStableId(stable[1]), columnId = decodeStableId(stable[2]);
    if (!left || !columnId) return undefined;
    return { end, endpoint: first.kind === 'canonical'
      ? { ...base, kind: 'canonical', value: { columnId, rowId: first.value.rowId } }
      : { ...base, kind: 'stored-named', value: { propertyId: left, columnId, rowId: first.value.rowId } } };
  }
  const name = named?.[1]?.replace(/''/g, "'") ?? named?.[2];
  if (!name) return undefined;
  if (first.kind === 'named') return { end, endpoint: { ...base, kind: 'named', value: { propertyName: name, row: first.value.row } } };
  if (first.kind === 'a1' && !isNamedColumn?.(qualifier, name, base.payloadSpans.column)) {
    const column = columnLabelToIndex(name);
    if (column.ok) return { end, endpoint: { ...base, kind: 'a1', value: { columnIndex: column.value, rowIndex: first.value.rowIndex } } };
  }
  return undefined;
}
