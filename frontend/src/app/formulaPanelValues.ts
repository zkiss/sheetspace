import type { FormulaReferenceIdentity } from '@application/core/formulaEditorLogic';
import type { FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import { cellKey } from '@workbook/core/address';
import type { FormulaReferenceResolver } from '@workbook/formula/reference';

export function formulaPanelReferenceValues(identity: FormulaReferenceIdentity, resolver: FormulaReferenceResolver, results: FormulaEvaluationSnapshot) {
  const addresses = identity.kind === 'cell' ? [resolver.addressOf(identity.sheetId, identity)] : (() => {
    const start = resolver.addressOf(identity.sheetId, identity.start); const end = resolver.addressOf(identity.sheetId, identity.end);
    return start && end ? Array.from({ length: (Math.abs(end.rowIndex - start.rowIndex) + 1) * (Math.abs(end.columnIndex - start.columnIndex) + 1) }, (_, index) => ({ rowIndex: Math.min(start.rowIndex, end.rowIndex) + Math.floor(index / (Math.abs(end.columnIndex - start.columnIndex) + 1)), columnIndex: Math.min(start.columnIndex, end.columnIndex) + index % (Math.abs(end.columnIndex - start.columnIndex) + 1) })) : [];
  })();
  const values = addresses.map((address) => address && results[identity.sheetId]?.[cellKey(address)]).filter((value): value is NonNullable<typeof value> => value !== undefined);
  return identity.kind === 'cell' ? values[0] : values;
}
