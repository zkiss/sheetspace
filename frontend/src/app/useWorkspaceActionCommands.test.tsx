import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkspaceActionCommands } from './useWorkspaceActionCommands';

type Props = Parameters<typeof useWorkspaceActionCommands>[0];
function setup() {
  const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 1 });
  const cell = { sheetId: sheet.id, cell: { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! } };
  const commands = { appendRow: vi.fn(), setSheetVisualScale: vi.fn(), changeSheetZOrder: vi.fn(), undo: vi.fn(), redo: vi.fn(), retryFailedSaves: vi.fn(), renameColumn: vi.fn() };
  const controller = { createSheetAtViewportCenter: vi.fn(), zoomWorkspaceBy: vi.fn(), resetViewport: vi.fn() };
  const clipboard = { canWrite: () => true, canRead: () => true, write: vi.fn().mockResolvedValue(undefined), read: vi.fn() };
  const props = {
    commands, controller, sheet, workbook: workbookWithSheets([sheet]), activeCell: cell, selection: null,
    formatting: { descriptor: { valid: false } }, referencesVisible: true,
    canUndo: false, canRedo: false, canRetryFailedSaves: false,
    navigation: { canGoBack: false, canGoForward: false, traverse: vi.fn() }, closePalette: vi.fn(), openPanel: vi.fn(),
    onOpenDataModels: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onEdit: vi.fn(), onClear: vi.fn(),
    onSelectAxis: vi.fn(), onSelectAll: vi.fn(), onToggleReferences: vi.fn(), onFeedback: vi.fn(),
    onCopy: vi.fn(), onCut: vi.fn(), onPaste: vi.fn(), onCancelCut: vi.fn(), hasPendingCut: false, clipboardAccess: clipboard,
  } as unknown as Props;
  const hook = renderHook(() => useWorkspaceActionCommands(props));
  const command = (id: string) => hook.result.current.commands.find((item) => item.id === id)!;
  return { hook, command, props, commands, controller, clipboard, sheet, cell };
}

describe('workspace palette actions', () => {
  it('routes representative workspace, sheet, stacking, view, selection and model commands and exposes guards', () => {
    const { command, commands, controller, props, sheet, cell } = setup();
    expect(command('undo').unavailable).toBe('Nothing to undo');
    expect(command('unbind-model').unavailable).toBe('The selected sheet has no bound model');
    expect(command('bold').unavailable).toBe('Select cells, rows, or columns first');
    act(() => {
      command('new-sheet').run(); command('append-row').run(); command('sheet-order-up').run();
      command('zoom-in').run(); command('select-row').run(); command('data-models').run();
    });
    expect(controller.createSheetAtViewportCenter).toHaveBeenCalledOnce();
    expect(commands.appendRow).toHaveBeenCalledWith(sheet.id);
    expect(commands.changeSheetZOrder).toHaveBeenCalledWith(sheet.id, 'up');
    expect(controller.zoomWorkspaceBy).toHaveBeenCalledWith(1.2);
    expect(props.onSelectAxis).toHaveBeenCalledWith('rows', cell);
    expect(props.onOpenDataModels).toHaveBeenCalledOnce();
  });

  it('applies numeric sheet controls through the existing command and closes the palette', () => {
    const { command, hook, commands, props, sheet } = setup();
    act(() => command('sheet-scale').run());
    expect(props.openPanel).toHaveBeenCalledOnce();
    render(<>{hook.result.current.panel?.content}</>);
    fireEvent.change(screen.getByLabelText('Display scale (%)'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(commands.setSheetVisualScale).toHaveBeenCalledWith(sheet.id, 1.2);
    expect(props.closePalette).toHaveBeenCalledOnce();
  });

  it('renames a selected column only after persistence succeeds', async () => {
    const { command, hook, commands, props, sheet, cell } = setup();
    expect(command('rename-column').unavailable).toBe('Select one existing column first');
    props.selection = { mode: 'columns', anchor: cell, extent: cell };
    hook.rerender();
    expect(command('rename-column').unavailable).toBeUndefined();
    let finish!: (result: { ok: false; reason: 'persistence-failed' }) => void;
    commands.renameColumn.mockReturnValue({ result: { ok: true }, completion: new Promise((resolve) => { finish = resolve; }) });
    act(() => command('rename-column').run());
    render(<>{hook.result.current.panel?.content}</>);
    fireEvent.change(screen.getByLabelText('Column name'), { target: { value: 'Revenue' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(commands.renameColumn).toHaveBeenCalledWith(sheet.id, cell.cell.columnId, 'Revenue');
    expect(hook.result.current.preventClose).toBe(true);
    expect(props.closePalette).not.toHaveBeenCalled();
    await act(async () => finish({ ok: false, reason: 'persistence-failed' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('persistence-failed');
    expect(props.closePalette).not.toHaveBeenCalled();
  });

  it('closes and restores focus only after a successful rename', async () => {
    const { command, hook, commands, props, cell } = setup();
    props.selection = { mode: 'columns', anchor: cell, extent: cell };
    hook.rerender();
    commands.renameColumn.mockReturnValue({ result: { ok: true }, completion: Promise.resolve({ ok: true }) });
    act(() => command('rename-column').run());
    render(<>{hook.result.current.panel?.content}</>);
    fireEvent.change(screen.getByLabelText('Column name'), { target: { value: 'Revenue' } });
    fireEvent.submit(screen.getByLabelText('Column name').closest('form')!);
    await waitFor(() => expect(props.closePalette).toHaveBeenCalledOnce());
    expect(hook.result.current.panel).toBeUndefined();
  });

  it('disables rename for missing or cross-sheet columns and rejects a stale target', async () => {
    const { command, hook, commands, props, cell } = setup();
    const missing = { ...cell, cell: { ...cell.cell, columnId: 'missing' } };
    props.selection = { mode: 'columns', anchor: missing, extent: missing };
    hook.rerender();
    expect(command('rename-column').unavailable).toBeDefined();
    props.selection = { mode: 'columns', anchor: cell, extent: { ...cell, sheetId: 'other' } };
    hook.rerender();
    expect(command('rename-column').unavailable).toBeDefined();
    props.selection = { mode: 'columns', anchor: cell, extent: cell };
    hook.rerender();
    act(() => command('rename-column').run());
    props.sheet = undefined;
    hook.rerender();
    render(<>{hook.result.current.panel?.content}</>);
    fireEvent.submit(screen.getByLabelText('Column name').closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('selected column has changed');
    expect(commands.renameColumn).not.toHaveBeenCalled();
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
});
