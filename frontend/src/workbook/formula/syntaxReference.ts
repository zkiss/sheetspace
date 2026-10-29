import { normalizeRange, type CellAddress } from '../core/address';
import type { FormulaReference, FormulaReferenceLexeme, FormulaSourceSpan } from './syntaxTypes';

type Endpoint = FormulaReferenceLexeme['endpoints'][number];

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
    return { kind: 'named', ...base, endpoint: first.value, ...(second?.kind === 'named' ? { end: second.value } : {}) };
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
        start: coordinate, end: { columnId: endValue!.columnId, rowId: endValue!.rowId },
        ...(named ? { startPropertyId: value.propertyId, endPropertyId: endValue!.propertyId } : {}),
      } } : {}),
    };
  }
  if (!second) return { kind: 'cell', ...base, address: first.value as CellAddress };
  return { kind: 'range', ...base, range: normalizeRange({ start: first.value as CellAddress, end: second.value as CellAddress }) };
}
