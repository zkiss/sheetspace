import { cellIdentityFromKey } from '@workbook/core/cellIdentity';
import type { Workbook } from '@workbook/core/model';

export function deleteColumn(workbook: Workbook, sheetId: string, columnId: string) {
  const sheet = workbook.documents[sheetId];
  if (!sheet || !sheet.content.columns.includes(columnId)) return { ok: false, reason: 'unknown-column' } as const;
  if (sheet.modelId) return { ok: false, reason: 'bound-sheet-structure' } as const;
  const withoutColumn = <T,>(values: Record<string, T>) => Object.fromEntries(Object.entries(values).filter(([id]) => id !== columnId));
  const withoutColumnCells = <T,>(values: Record<string, T>) => Object.fromEntries(Object.entries(values).filter(([key]) => cellIdentityFromKey(key)?.columnId !== columnId));
  const formats = sheet.presentation.formatOverrides;
  const next = {
    ...sheet,
    columnNames: sheet.columnNames && withoutColumn(sheet.columnNames),
    content: { ...sheet.content, columns: sheet.content.columns.filter((id) => id !== columnId), cells: withoutColumnCells(sheet.content.cells) },
    presentation: {
      ...sheet.presentation,
      columnWidths: withoutColumn(sheet.presentation.columnWidths),
      ...(formats ? { formatOverrides: { ...formats, columns: withoutColumn(formats.columns), cells: withoutColumnCells(formats.cells) } } : {}),
    },
  };
  return { ok: true, value: { ...workbook, documents: { ...workbook.documents, [sheetId]: next } } } as const;
}
