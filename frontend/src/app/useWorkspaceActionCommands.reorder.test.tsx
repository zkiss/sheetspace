import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkspaceActionCommands } from './useWorkspaceActionCommands';

it('dispatches axis moves using the current workbook order and selected identities', () => {
  const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 3 });
  const cell = { sheetId: sheet.id, cell: { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! } };
  const live = { ...sheet, content: { ...sheet.content, columns: [...sheet.content.columns].reverse() } };
  const shiftAxis = vi.fn();
  const props = {
    commands: { currentWorkbook: () => workbookWithSheets([live]), shiftAxis }, sheet,
    workbook: workbookWithSheets([sheet]), activeCell: cell,
    selection: { mode: 'columns', anchor: cell, extent: cell, members: [sheet.content.columns[0]!, sheet.content.columns[2]!] },
    controller: {}, formatting: { descriptor: { valid: false } }, navigation: {}, clipboardAccess: { canWrite: () => true, canRead: () => true },
  } as unknown as Parameters<typeof useWorkspaceActionCommands>[0];
  const hook = renderHook(() => useWorkspaceActionCommands(props));
  act(() => hook.result.current.commands.find((action) => action.id === 'move-column-right')!.run());
  expect(shiftAxis).toHaveBeenCalledWith(sheet.id, 'column', [sheet.content.columns[2], sheet.content.columns[0]], 1);
});
