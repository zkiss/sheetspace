import type { CellAddress } from '../core/address';
import type { ColumnId, RowId, SheetId } from '../core/model';

export type FormulaCoordinate = { columnId: ColumnId; rowId: RowId };
export type FormulaReferenceResolver = { currentSheetId: SheetId; sheetByQualifier(qualifier: string): SheetId | undefined; displaySheetQualifier?(sheetId: SheetId): string | undefined; lastRowId?(sheetId: SheetId): RowId | undefined; coordinateAt(sheetId: SheetId, address: CellAddress): FormulaCoordinate | undefined; addressOf(sheetId: SheetId, coordinate: FormulaCoordinate): CellAddress | undefined; hasNamedColumn?(sheetId: SheetId, name: string): boolean; namedCoordinateAt?(sheetId: SheetId, name: string, row: number): { propertyId: string; coordinate: FormulaCoordinate } | undefined; namedAddressOf?(sheetId: SheetId, propertyId: string, coordinate: FormulaCoordinate): { name: string; address: CellAddress } | undefined; namedAddressAt?(sheetId: SheetId, coordinate: FormulaCoordinate): { propertyId: string; name: string; address: CellAddress } | undefined };
export type FormulaMoveTarget = { sheetId: SheetId; cell: FormulaCoordinate };
export type FormulaMoveMapping = { source: FormulaMoveTarget; destination: FormulaMoveTarget };
