import type { ComponentProps } from 'react';
import { vi } from 'vitest';
import type { WorkbookCommands } from '@application/react/useWorkbookController';
import type { SheetDocument } from '@workbook/core/model';
import type { FormattingSelection } from '@workbook/read/formattingSelection';
import { workbookWithSheets } from '@test-support/workbookFactories';
import type { Workspace } from '@app/Workspace';

/** Non-mutating commands isolate action-time reads from a post-write refresh. */
export function formattingCommands(): WorkbookCommands {
  return {
    writeNumberFormats: vi.fn(), writeAxisSizes: vi.fn(), appendColumn: vi.fn(), appendRow: vi.fn(),
    changeSheetZOrder: vi.fn(), createSheet: vi.fn(), deleteSheet: vi.fn(), moveSheetFrame: vi.fn(),
    pasteCells: vi.fn(), moveCells: vi.fn(), renameSheet: vi.fn(), retryFailedSaves: vi.fn(),
    undo: vi.fn(), redo: vi.fn(), resizeSheetFrame: vi.fn(), setSheetVisualScale: vi.fn(),
    updateCellContent: vi.fn(), writeCells: vi.fn(),
  };
}

export function formattingWorkspaceProps(sheet: SheetDocument, selection: FormattingSelection): ComponentProps<typeof Workspace> {
  return {
    workbook: workbookWithSheets([sheet]), selectionRange: selection, activeCell: selection.anchor,
    commands: formattingCommands(), formulaResults: {}, contentHistoryFeedback: undefined,
    editingCell: null, keyboardFocusRequest: null, referenceSelection: null,
    canRetryFailedSaves: false, saveStatus: 'saved', creatingAxes: {}, creatingFrames: [],
    onKeyboardFocusRequestConsumed: vi.fn(), onKeyboardFocusRequestCancelled: vi.fn(),
    onCancelEdit: vi.fn(), onClearCell: vi.fn(), onClearSelection: vi.fn(), onActivateSheet: vi.fn(),
    onCommitEdit: vi.fn(), onCommitEditAndNavigate: vi.fn(), onCreateSheet: vi.fn(), onEditValueChange: vi.fn(),
    onNavigateCell: vi.fn(), onNavigateKeyboardCell: vi.fn(), onOpenRenameDialog: vi.fn(),
    onRetryFailedSaves: vi.fn(), onSelectCell: vi.fn(), onExtendSelection: vi.fn(), onFocusSelection: vi.fn(),
    onSettleSelectionGesture: vi.fn(), onRestoreGridFocus: vi.fn(() => null), onSelectAxis: vi.fn(),
    onSelectReferenceTarget: vi.fn(), onStartEdit: vi.fn(),
  };
}
