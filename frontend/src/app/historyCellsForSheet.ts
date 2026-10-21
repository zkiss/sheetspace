import { cellKey } from '@workbook/core/address';
import { cellAddressOf } from '@workbook/core/cellIdentity';
import type { SheetDocument } from '@workbook/core/model';
import type { ContentHistoryFeedback } from '@application/react/useWorkbookController';

export function historyCellsForSheet(feedback: ContentHistoryFeedback, sheet: SheetDocument) {
  const beforeByIdentity = new Map(feedback.before.map((cell) => [
    `${cell.sheetId}:${cell.rowId}:${cell.columnId}`,
    cell,
  ]));
  const cells = new Map<string, { before: string | null; beforeDisplay: string | null; after: string | null }>();
  for (const after of feedback.after) {
    if (after.sheetId !== sheet.id) continue;
    const address = cellAddressOf(sheet.content, after);
    if (!address) continue;
    const before = beforeByIdentity.get(`${after.sheetId}:${after.rowId}:${after.columnId}`);
    cells.set(cellKey(address), {
      before: before?.raw ?? null,
      beforeDisplay: before?.display ?? null,
      after: after.raw,
    });
  }
  return cells;
}
