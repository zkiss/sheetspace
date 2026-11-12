import type { ColumnId, SheetDocument, SortCriterion, Workbook } from './model';

export function validSorting(columns: readonly ColumnId[], criteria: readonly SortCriterion[]): boolean {
  const seen = new Set<ColumnId>();
  return criteria.every(({ columnId, direction }) => {
    if (!columns.includes(columnId) || seen.has(columnId) || (direction !== 'ascending' && direction !== 'descending')) return false;
    seen.add(columnId);
    return true;
  });
}

export function setSheetSorting(workbook: Workbook, sheetId: string, criteria: readonly SortCriterion[]): { status: 'changed' | 'unchanged'; workbook: Workbook } | { status: 'rejected'; workbook: Workbook } {
  const sheet = workbook.documents[sheetId];
  if (!sheet || !validSorting(sheet.content.columns, criteria)) return { status: 'rejected', workbook };
  const previous = sheet.sorting ?? [];
  if (previous.length === criteria.length && previous.every((item, index) => item.columnId === criteria[index]?.columnId && item.direction === criteria[index]?.direction)) return { status: 'unchanged', workbook };
  return { status: 'changed', workbook: { ...workbook, documents: { ...workbook.documents, [sheetId]: { ...sheet, sorting: criteria.map((item) => ({ ...item })) } } } };
}

export function retainSortingColumns(sheet: SheetDocument, columns: readonly ColumnId[]): readonly SortCriterion[] | undefined {
  return sheet.sorting?.filter(({ columnId }) => columns.includes(columnId));
}

