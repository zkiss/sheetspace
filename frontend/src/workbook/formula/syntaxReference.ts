import { normalizeRange, type CellAddress } from '../core/address';
import type { FormulaReference, FormulaReferenceLexeme, FormulaSourceSpan } from './syntaxTypes';

type Endpoint = FormulaReferenceLexeme['endpoints'][number];

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
