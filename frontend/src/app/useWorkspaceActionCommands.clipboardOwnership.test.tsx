import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkspaceActionCommands } from './useWorkspaceActionCommands';

type Props = Parameters<typeof useWorkspaceActionCommands>[0];
function setup(columnCount = 1) {
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


describe('clipboard route ownership', () => {
  it.each(['resolve', 'reject'])('invalidates a pending read without stale effects on %s', async (outcome) => {
    const { command, hook, props, clipboard } = setup();
    let resolve!: (content: { text: string }) => void;
    let reject!: (error: Error) => void;
    clipboard.read.mockReturnValueOnce(new Promise((done, fail) => { resolve = done; reject = fail; }));
    act(() => command('paste').run());
    act(() => hook.result.current.invalidateClipboardOperation());
    expect(hook.result.current.busy).toBe(false);
    await act(async () => { if (outcome === 'resolve') resolve({ text: 'late' }); else reject(new Error('late')); });
    expect(props.onPaste).not.toHaveBeenCalled();
    expect(props.onFeedback).not.toHaveBeenCalled();
    expect(props.closePalette).not.toHaveBeenCalled();
  });

  it('invalidates only the unconfirmed cut before a newer cut starts', async () => {
    const { command, hook, props, clipboard } = setup();
    let reject!: (error: Error) => void;
    clipboard.write.mockReturnValueOnce(new Promise<void>((_, fail) => { reject = fail; }));
    vi.mocked(props.onCut).mockReturnValueOnce({ text: 'old', marker: 'old' }).mockReturnValueOnce({ text: 'new', marker: 'new' });
    act(() => command('cut').run());
    act(() => hook.result.current.invalidateClipboardOperation());
    await act(async () => { command('cut').run(); });
    await act(async () => reject(new Error('late')));
    expect(props.onCancelCut).toHaveBeenCalledTimes(1);
    expect(props.onCancelCut).toHaveBeenCalledWith('old');
    expect(props.onFeedback).not.toHaveBeenCalled();
  });
  it('preserves clipboard markers and cancels a failed cut', async () => {
    const { command, props, clipboard } = setup();
    const content = { text: '=A1', marker: 'cut-token' };
    vi.mocked(props.onCopy).mockReturnValue(content);
    await act(async () => { command('copy').run(); });
    expect(clipboard.write).toHaveBeenCalledWith(content);
    clipboard.read.mockResolvedValue(content);
    await act(async () => { command('paste').run(); });
    expect(props.onPaste).toHaveBeenCalledWith(content);
    vi.mocked(props.onCut).mockReturnValue(content);
    clipboard.write.mockRejectedValueOnce(new Error('denied'));
    await act(async () => { command('cut').run(); });
    expect(props.onCancelCut).toHaveBeenCalledOnce();
    expect(props.onFeedback).toHaveBeenCalledWith(expect.stringContaining('Clipboard access failed'));
  });

  it('ignores a pending clipboard result after the palette resets', async () => {
    const { command, hook, props, clipboard } = setup();
    let resolve!: (content: { text: string }) => void;
    clipboard.read.mockReturnValue(new Promise((done) => { resolve = done; }));
    act(() => command('paste').run());
    expect(hook.result.current.busy).toBe(true);
    act(() => hook.result.current.resetPanel());
    await act(async () => resolve({ text: 'late' }));
    await waitFor(() => expect(hook.result.current.busy).toBe(false));
    expect(props.onPaste).not.toHaveBeenCalled();
  });

  it('cancels an unconfirmed cut when its selection changes before the write completes', async () => {
    const { command, hook, props, clipboard, sheet, cell } = setup(2);
    let resolve!: () => void;
    clipboard.write.mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    vi.mocked(props.onCut).mockReturnValue({ text: 'value', marker: 'old' });
    act(() => command('cut').run());
    props.activeCell = { ...cell, cell: { ...cell.cell, columnId: sheet.content.columns[1]! } };
    hook.rerender();
    await act(async () => resolve());
    expect(props.onCancelCut).toHaveBeenCalledWith('old');
    expect(props.closePalette).not.toHaveBeenCalled();
  });

  it('does not cancel a newer cut when an older write rejects', async () => {
    const { command, props, clipboard } = setup();
    let reject!: (error: Error) => void;
    clipboard.write.mockReturnValueOnce(new Promise<void>((_, fail) => { reject = fail; }));
    vi.mocked(props.onCut).mockReturnValueOnce({ text: 'old', marker: 'old' }).mockReturnValueOnce({ text: 'new', marker: 'new' });
    act(() => command('cut').run());
    await act(async () => { command('cut').run(); });
    await act(async () => reject(new Error('late')));
    expect(props.onCancelCut).toHaveBeenCalledTimes(1);
    expect(props.onCancelCut).toHaveBeenCalledWith('old');
    expect(props.onFeedback).not.toHaveBeenCalled();
  });

  it('cancels an unconfirmed cut on disposal', () => {
    const { command, hook, props, clipboard } = setup();
    clipboard.write.mockReturnValue(new Promise<void>(() => {}));
    vi.mocked(props.onCut).mockReturnValue({ text: 'value', marker: 'cut' });
    act(() => command('cut').run());
    hook.unmount();
    expect(props.onCancelCut).toHaveBeenCalledWith('cut');
  });


});
