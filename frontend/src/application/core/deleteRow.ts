import { cellIdentityFromKey } from '@workbook/core/cellIdentity';
import type { Workbook } from '@workbook/core/model';

export function deleteRow(workbook: Workbook, sheetId: string, rowId: string) {
  const sheet = workbook.documents[sheetId];
  if (!sheet || !sheet.content.rows.includes(rowId)) return { ok: false, reason: 'unknown-row' } as const;
  const withoutRow = <T,>(values: Record<string, T>) => Object.fromEntries(Object.entries(values).filter(([id]) => id !== rowId));
  const withoutRowCells = <T,>(values: Record<string, T>) => Object.fromEntries(Object.entries(values).filter(([key]) => cellIdentityFromKey(key)?.rowId !== rowId));
  const formats = sheet.presentation.formatOverrides;
  const next = {
    ...sheet,
    content: { ...sheet.content, rows: sheet.content.rows.filter((id) => id !== rowId), cells: withoutRowCells(sheet.content.cells) },
    presentation: {
      ...sheet.presentation,
      rowHeights: withoutRow(sheet.presentation.rowHeights),
      ...(formats ? { formatOverrides: { ...formats, rows: withoutRow(formats.rows), cells: withoutRowCells(formats.cells) } } : {}),
    },
  };
  return { ok: true, value: { ...workbook, documents: { ...workbook.documents, [sheetId]: next } } } as const;
}
