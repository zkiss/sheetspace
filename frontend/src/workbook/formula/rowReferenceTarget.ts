import type { FormulaCoordinate, FormulaReferenceResolver } from './formulaTransformTypes';
import type { FormulaReference } from './syntax';

type RowReference = Extract<FormulaReference, { kind: 'row-reference' }>;

export function rowReferenceTarget(reference: RowReference, resolver: FormulaReferenceResolver) {
  const stored = reference.endpoints.some((endpoint) => 'columnId' in endpoint.value);
  const sheetId = reference.sheetId === undefined ? resolver.currentSheetId
    : stored ? reference.sheetId : resolver.sheetByQualifier(reference.sheetId);
  if (!sheetId) return undefined;
  const resolve = (endpoint: RowReference['endpoints'][number]): FormulaCoordinate | undefined => {
    if (endpoint.kind === 'a1') return resolver.coordinateAt(sheetId, endpoint.value);
    if (endpoint.kind === 'named') return resolver.namedCoordinateAt?.(sheetId, endpoint.value.propertyName, endpoint.value.row)?.coordinate;
    if (endpoint.kind === 'canonical' || endpoint.kind === 'stored-named') {
      return resolver.addressOf(sheetId, endpoint.value) && (endpoint.kind !== 'stored-named' || resolver.namedAddressOf?.(sheetId, endpoint.value.propertyId, endpoint.value)) ? endpoint.value : undefined;
    }
    const columnIndex = resolver.columnIndexOf?.(sheetId, endpoint.value.columnId, endpoint.value.propertyId);
    if (columnIndex === undefined) return undefined;
    if (endpoint.kind === 'open-canonical') {
      const rowId = resolver.lastRowId?.(sheetId);
      return rowId ? { columnId: endpoint.value.columnId, rowId } : undefined;
    }
    return resolver.coordinateAt(sheetId, { columnIndex, rowIndex: endpoint.value.rowIndex });
  };
  const start = resolve(reference.endpoints[0]!);
  if (!start) return undefined;
  if (!reference.endpoints[1]) return { sheetId, start };
  const endpoint = reference.endpoints[1];
  let end = resolve(endpoint);
  if (endpoint.open && endpoint.kind !== 'open-canonical' && end) {
    const rowId = resolver.lastRowId?.(sheetId);
    end = rowId ? { ...end, rowId } : undefined;
  }
  return end ? { sheetId, start, end } : undefined;
}
