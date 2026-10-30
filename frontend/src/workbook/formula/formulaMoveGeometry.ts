import type { CellAddress } from '../core/address';
import type { FormulaMoveMapping, FormulaMoveTarget, FormulaReferenceResolver } from './formulaTransformTypes';

type GeometryResult = { ok: true; sheetId: string; addresses: CellAddress[]; changed: boolean } | { ok: false; reason: 'unrepresentable-range' };

/** Maps exact rectangular membership without enumerating the cells in a range. */
export function formulaMoveGeometry(resolver: FormulaReferenceResolver, mappings: readonly FormulaMoveMapping[]) {
  const key = (target: FormulaMoveTarget) => JSON.stringify([target.sheetId, target.cell.columnId, target.cell.rowId]);
  const mapped = new Map(mappings.map(({ source, destination }) => [key(source), { source, destination }]));
  const located = [...mapped].flatMap(([sourceKey, { source, destination }]) => {
    const address = resolver.addressOf(source.sheetId, source.cell);
    const target = resolver.addressOf(destination.sheetId, destination.cell);
    return address && target ? [{ sourceKey, sheetId: source.sheetId, source: address, destination, target }] : [];
  });
  return (sheetId: string, addresses: CellAddress[]): GeometryResult => {
    const first = addresses[0], last = addresses[addresses.length - 1];
    const lowRow = Math.min(first.rowIndex, last.rowIndex), highRow = Math.max(first.rowIndex, last.rowIndex);
    const lowColumn = Math.min(first.columnIndex, last.columnIndex), highColumn = Math.max(first.columnIndex, last.columnIndex);
    const inside = (address: CellAddress) => address.rowIndex >= lowRow && address.rowIndex <= highRow && address.columnIndex >= lowColumn && address.columnIndex <= highColumn;
    const affected = located.filter((entry) => entry.sheetId === sheetId && inside(entry.source));
    if (!affected.length) return { ok: true, sheetId, addresses, changed: false };
    const area = (highRow - lowRow + 1) * (highColumn - lowColumn + 1);
    const remaining = area - affected.length;
    const finalSheet = remaining ? sheetId : affected[0].destination.sheetId;
    if (affected.some(({ destination }) => destination.sheetId !== finalSheet)) return { ok: false, reason: 'unrepresentable-range' };
    let minRow = lowRow, maxRow = highRow, minColumn = lowColumn, maxColumn = highColumn;
    const rows = new Map<number, number>(), columns = new Map<number, number>();
    for (const { source } of affected) {
      rows.set(source.rowIndex, (rows.get(source.rowIndex) ?? 0) + 1);
      columns.set(source.columnIndex, (columns.get(source.columnIndex) ?? 0) + 1);
    }
    if (remaining) {
      while (rows.get(minRow) === highColumn - lowColumn + 1) minRow += 1;
      while (rows.get(maxRow) === highColumn - lowColumn + 1) maxRow -= 1;
      while (columns.get(minColumn) === highRow - lowRow + 1) minColumn += 1;
      while (columns.get(maxColumn) === highRow - lowRow + 1) maxColumn -= 1;
    } else { minRow = Infinity; maxRow = -Infinity; minColumn = Infinity; maxColumn = -Infinity; }
    const removed = new Set(affected.map(({ sourceKey }) => sourceKey));
    const additions = new Set<string>();
    for (const { destination, target } of affected) {
      minRow = Math.min(minRow, target.rowIndex); maxRow = Math.max(maxRow, target.rowIndex);
      minColumn = Math.min(minColumn, target.columnIndex); maxColumn = Math.max(maxColumn, target.columnIndex);
      const targetKey = key(destination);
      if (destination.sheetId !== sheetId || !inside(target) || removed.has(targetKey)) additions.add(targetKey);
    }
    if ((maxRow - minRow + 1) * (maxColumn - minColumn + 1) !== remaining + additions.size) return { ok: false, reason: 'unrepresentable-range' };
    const ends = addresses.length === 1 ? [{ rowIndex: minRow, columnIndex: minColumn }] : [
      { rowIndex: first.rowIndex <= last.rowIndex ? minRow : maxRow, columnIndex: first.columnIndex <= last.columnIndex ? minColumn : maxColumn },
      { rowIndex: first.rowIndex <= last.rowIndex ? maxRow : minRow, columnIndex: first.columnIndex <= last.columnIndex ? maxColumn : minColumn },
    ];
    return { ok: true, sheetId: finalSheet, addresses: ends, changed: true };
  };
}
