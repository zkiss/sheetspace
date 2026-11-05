import type { CellRange } from '@workbook/core/address';
import type { SheetTabularProjection } from '@workbook/core/model';
import { projectSelection } from '@workbook/read/selection';
import type { CellSelection } from './cellInteractionContracts';

export function gridSelectionPresentation(sheet: SheetTabularProjection, logical: CellSelection | null | undefined, range?: CellRange) {
  if (logical !== undefined) {
    const projection = logical && projectSelection({ id: sheet.id, content: sheet }, logical);
    return {
      rows: new Set(projection?.rowRuns.flatMap(({ start, end }) => Array.from({ length: end - start + 1 }, (_, i) => start + i))),
      columns: new Set(projection?.columnRuns.flatMap(({ start, end }) => Array.from({ length: end - start + 1 }, (_, i) => start + i))),
      mode: logical?.mode,
    };
  }
  return {
    rows: new Set(range ? Array.from({ length: range.end.rowIndex - range.start.rowIndex + 1 }, (_, i) => range.start.rowIndex + i) : []),
    columns: new Set(range ? Array.from({ length: range.end.columnIndex - range.start.columnIndex + 1 }, (_, i) => range.start.columnIndex + i) : []),
    mode: undefined,
  };
}
