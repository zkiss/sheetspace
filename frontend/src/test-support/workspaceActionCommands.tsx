import { renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkspaceActionCommands } from '@app/useWorkspaceActionCommands';

export type Props = Parameters<typeof useWorkspaceActionCommands>[0];
export function setup(columnCount = 1) {
  const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount });
  const cell = { sheetId: sheet.id, cell: { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! } };
  const commands = { currentWorkbook: () => ({ documents: new Proxy({}, { get: () => sheet }) }), appendRow: vi.fn(), setSheetVisualScale: vi.fn(), changeSheetZOrder: vi.fn(), undo: vi.fn(), redo: vi.fn(), retryFailedSaves: vi.fn(), renameColumn: vi.fn(), deleteRow: vi.fn(), deleteColumn: vi.fn(), replaceModelDeclaration: vi.fn() };
  const controller = { createSheetAtViewportCenter: vi.fn(), zoomWorkspaceBy: vi.fn(), resetViewport: vi.fn() };
  const clipboard = { canWrite: () => true, canRead: () => true, write: vi.fn().mockResolvedValue(undefined), read: vi.fn() };
  const props = {
    commands, controller, sheet, workbook: workbookWithSheets([sheet]), activeCell: cell, selection: null,
    formatting: { descriptor: { valid: false } }, referencesVisible: true,
    canUndo: false, canRedo: false, canRetryFailedSaves: false,
    navigation: { canGoBack: false, canGoForward: false, traverse: vi.fn() }, closePalette: vi.fn(), openPanel: vi.fn(), onCreateSheet: vi.fn(),
    onOpenDataModels: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onEdit: vi.fn(), onClear: vi.fn(),
    onSelectAxis: vi.fn(), onSelectAll: vi.fn(), onRowDeleted: vi.fn(), onColumnDeleted: vi.fn(), onToggleReferences: vi.fn(), onFeedback: vi.fn(),
    onCopy: vi.fn(), onCut: vi.fn(), onPaste: vi.fn(), onCancelCut: vi.fn(), hasPendingCut: false, clipboardAccess: clipboard,
  } as unknown as Props;
  const hook = renderHook(() => useWorkspaceActionCommands(props));
  const command = (id: string) => hook.result.current.commands.find((item) => item.id === id)!;
  return { hook, command, props, commands, controller, clipboard, sheet, cell };
}

