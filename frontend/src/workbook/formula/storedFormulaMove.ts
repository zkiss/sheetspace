import type { Workbook } from '../core/model';
import { formulaMoveGeometry } from './formulaMoveGeometry';
import { workbookFormulaReferenceResolver, type FormulaMoveMapping } from './reference';
import { storedFormulaTransform } from './storedFormulaTransform';

export type StoredFormulaMoveResult = { ok: true; content: string } | { ok: false; reason: 'unrepresentable-range' };

export function moveStoredFormula(content: string, workbook: Workbook, currentSheetId: string, destinationSheetId = currentSheetId, mappings: readonly FormulaMoveMapping[] = []): StoredFormulaMoveResult {
  const transform = storedFormulaTransform(content, workbook);
  const resolver = workbookFormulaReferenceResolver(workbook, currentSheetId);
  const geometry = formulaMoveGeometry(resolver, mappings);
  for (const reference of transform.analysis.references) {
    if (!reference.occurrence || !reference.sheet) continue;
    let finalSheet = reference.sheet.id;
    const columns = reference.occurrence.endpoints.map((endpoint) => reference.slots.find(({ slot }) => slot.id === endpoint.columnSlotId)!);
    const rows = reference.occurrence.endpoints.map((endpoint) => reference.slots.find(({ slot }) => slot.id === endpoint.rowSlotId)!);
    const endpoints = columns.map(({ slot }, index) => slot.status === 'retained' && rows[index].slot.status === 'retained'
      ? resolver.addressOf(finalSheet, { columnId: slot.targetIds[slot.kind === 'property' ? 1 : 0], rowId: rows[index].slot.targetIds[0] })
      : undefined);
    if (endpoints.every((address) => address !== undefined)) {
      const moved = geometry(finalSheet, endpoints);
      if (!moved.ok) return moved;
      finalSheet = moved.sheetId;
      if (moved.changed) {
        const coordinates = moved.addresses.map((address) => resolver.coordinateAt(finalSheet, address)!);
        const properties = coordinates.map((coordinate) => resolver.namedAddressAt?.(finalSheet, coordinate));
        const useNamed = coordinates.length === 1 || columns.every((column, index) => !column.live || properties[index]);
        if (!useNamed && columns.some((column) => !column.live && column.slot.kind === 'property')) return { ok: false, reason: 'unrepresentable-range' };
        coordinates.forEach((coordinate, index) => {
          const column = columns[index];
          const property = column.slot.kind === 'property' && useNamed ? properties[index] : undefined;
          if (column.live) transform.column(reference, index, finalSheet, coordinate.columnId, property);
          if (rows[index].live || column.live && !property) transform.row(reference, index, finalSheet, rows[index].live ? coordinate.rowId : undefined, column.live && !property);
        });
      }
    }
    transform.sheet(reference, finalSheet, Boolean(reference.lexeme.qualifier) || finalSheet !== destinationSheetId);
  }
  return { ok: true, content: transform.finish() };
}
