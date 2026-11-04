import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { smallSheetDocument } from '@test-support/workbookFactories';
import { formattingSelection } from '@test-support/formattingProjection';
import { Workspace } from './Workspace';
import { formattingWorkspaceProps } from '@test-support/formattingWorkspace';
import { systemClipboard } from './systemClipboard';

vi.mock('@shared/keyboard/keymap', async (importOriginal) => {
  const original = await importOriginal<typeof import('@shared/keyboard/keymap')>();
  const keymap = { ...original.keymap, copy: [{ key: 'c', mod: true, shift: true }], 'data-models': [{ key: 'm', mod: true, shift: true }, { key: 'q' }], 'text-colour': [{ key: 'k', mod: true, shift: true }] };
  return {
    ...original,
    keymap,
    matchesShortcut: (event: never, id: string, platform = original.detectPlatform(), map = keymap) => original.matchesShortcut(event, id, platform, map),
    dispatchShortcut: (event: never, commands: never, context: never, platform = original.detectPlatform(), map = keymap) => original.dispatchShortcut(event, commands, context, platform, map),
    shortcutLabel: (id: string, platform = original.detectPlatform(), map = keymap) => original.shortcutLabel(id, platform, map),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubMacNavigator() {
  vi.stubGlobal('navigator', { platform: 'MacIntel' });
}

function renderWorkspace(overrides: Partial<ComponentProps<typeof Workspace>> = {}) {
  const sheet = smallSheetDocument({ id: 'keys', name: 'Keys', rowCount: 1, columnCount: 1 });
  const props = { ...formattingWorkspaceProps(sheet, formattingSelection(sheet, 'cells')), canUndo: true, canRedo: true, ...overrides };
  const view = render(<Workspace {...props} />);
  return { sheet, props, view };
}

describe('registered-command keyboard dispatch', () => {
  it('dispatches a newly bound printable command before grid typing, while preserving ordinary typing and unavailable actions', () => {
    const onOpenDataModels = vi.fn();
    const { props, view } = renderWorkspace({ onOpenDataModels });
    const cell = view.container.querySelector<HTMLElement>('[data-cell-key][data-active-cell="true"]');
    expect(cell).not.toBeNull();
    fireEvent.keyDown(cell!, { key: 'q' });
    expect(onOpenDataModels).toHaveBeenCalledOnce();
    expect(props.onStartEdit).not.toHaveBeenCalled();
    fireEvent.keyDown(cell!, { key: 'a' });
    expect(props.onStartEdit).toHaveBeenCalledOnce();
    vi.mocked(props.onStartEdit).mockClear();
    view.rerender(<Workspace {...props} onOpenDataModels={undefined} />);
    fireEvent.keyDown(cell!, { key: 'q' });
    expect(onOpenDataModels).toHaveBeenCalledOnce();
    expect(props.onStartEdit).toHaveBeenCalledOnce();
  });

  it('runs the existing Shift+N command from a focused grid cell', () => {
    const onCreateSheet = vi.fn();
    const { props, view } = renderWorkspace({ onCreateSheet });
    const cell = view.container.querySelector<HTMLElement>('[data-cell-key][data-active-cell="true"]')!;
    cell.focus();
    fireEvent.keyDown(cell, { key: 'N', shiftKey: true });
    expect(onCreateSheet).toHaveBeenCalledOnce();
    expect(props.onStartEdit).not.toHaveBeenCalled();
  });

  it('opens a newly bound formatting panel without stealing its focus for the grid', async () => {
    const sheet = smallSheetDocument({ id: 'panel', name: 'Panel', rowCount: 4, columnCount: 4 });
    const props = formattingWorkspaceProps(sheet, formattingSelection(sheet, 'cells'));
    render(<Workspace {...props} />);
    const toolbar = screen.getByRole('button', { name: 'Command palette' });
    toolbar.focus();
    fireEvent.keyDown(toolbar, { key: 'k', ctrlKey: true, shiftKey: true });
    await Promise.resolve();
    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(props.onRestoreGridFocus).not.toHaveBeenCalled();
  });

  it('executes a registered action bound only in the keymap, without any listener for that action', () => {
    const onOpenDataModels = vi.fn();
    renderWorkspace({ onOpenDataModels });
    expect(fireEvent.keyDown(document.body, { key: 'm', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(onOpenDataModels).toHaveBeenCalledOnce();
  });

  it('respects live availability of a keymap-bound action', () => {
    const onOpenDataModels = vi.fn();
    const { props, view } = renderWorkspace({ onOpenDataModels });
    fireEvent.keyDown(document.body, { key: 'm', ctrlKey: true, shiftKey: true });
    expect(onOpenDataModels).toHaveBeenCalledOnce();

    onOpenDataModels.mockClear();
    view.rerender(<Workspace {...props} onOpenDataModels={undefined} />);
    expect(fireEvent.keyDown(document.body, { key: 'm', ctrlKey: true, shiftKey: true })).toBe(true);
    expect(onOpenDataModels).not.toHaveBeenCalled();

    view.rerender(<Workspace {...props} onOpenDataModels={onOpenDataModels} />);
    fireEvent.keyDown(document.body, { key: 'm', ctrlKey: true, shiftKey: true });
    expect(onOpenDataModels).toHaveBeenCalledOnce();
  });

  it('rejects the foreign primary modifier for registered commands', () => {
    const onOpenDataModels = vi.fn();
    const { props } = renderWorkspace({ onOpenDataModels });
    expect(fireEvent.keyDown(document.body, { key: 'm', metaKey: true, shiftKey: true })).toBe(true);
    expect(onOpenDataModels).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(document.body, { key: 'z', metaKey: true })).toBe(true);
    expect(props.commands.undo).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, metaKey: true })).toBe(true);
    expect(props.commands.undo).not.toHaveBeenCalled();
  });
});

describe('platform-native primary modifier matching', () => {
  it('uses Control on Windows/Linux and rejects Meta for the same chord', () => {
    const { props } = renderWorkspace();
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(props.commands.undo).toHaveBeenCalledOnce();
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(props.commands.redo).toHaveBeenCalledOnce();
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
    expect(props.commands.redo).toHaveBeenCalledTimes(2);
  });

  it('uses Command on macOS and rejects Control for the same chord', () => {
    stubMacNavigator();
    const { props } = renderWorkspace();
    expect(fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })).toBe(true);
    expect(props.commands.undo).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
    expect(props.commands.undo).toHaveBeenCalledOnce();
    expect(fireEvent.keyDown(document.body, { key: 'z', metaKey: true, shiftKey: true })).toBe(false);
    expect(props.commands.redo).toHaveBeenCalledOnce();
    fireEvent.keyDown(document.body, { key: 'y', metaKey: true });
    expect(props.commands.redo).toHaveBeenCalledOnce();
  });

  it('opens the palette from Control+Shift+P on Windows/Linux but not from Command+Shift+P', () => {
    renderWorkspace();
    fireEvent.keyDown(document.body, { key: 'p', ctrlKey: true, shiftKey: true });
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText('Command search'), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'p', metaKey: true, shiftKey: true });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });

  it('opens the palette from Command+Shift+P on macOS but not from Control+Shift+P', () => {
    stubMacNavigator();
    renderWorkspace();
    fireEvent.keyDown(document.body, { key: 'p', ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'p', metaKey: true, shiftKey: true });
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText('Command search'), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });
});

describe('keyboard labels and hints', () => {
  it('derives toolbar titles from the keymap for the current platform', () => {
    renderWorkspace();
    expect(screen.getByRole('button', { name: 'Back' })).toHaveAttribute('title', 'Back (Alt+Left)');
    expect(screen.getByRole('button', { name: 'Forward' })).toHaveAttribute('title', 'Forward (Alt+Right)');
    expect(screen.getByRole('button', { name: 'Command palette' })).toHaveAttribute('title', 'Command palette (Ctrl+Shift+P)');
  });

  it('derives macOS toolbar titles from the keymap', () => {
    stubMacNavigator();
    renderWorkspace();
    expect(screen.getByRole('button', { name: 'Command palette' })).toHaveAttribute('title', 'Command palette (⌘+Shift+P)');
  });

  it('shows only the current platform shortcuts in palette entries', () => {
    renderWorkspace();
    fireEvent.keyDown(document.body, { key: 'p', ctrlKey: true, shiftKey: true });
    expect(screen.getByText('Ctrl+Z')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+Y / Ctrl+Shift+Z')).toBeInTheDocument();
    expect(screen.queryByText('⌘+Z')).not.toBeInTheDocument();
  });

  it('shows Command-based hints on macOS', () => {
    stubMacNavigator();
    renderWorkspace();
    fireEvent.keyDown(document.body, { key: 'p', metaKey: true, shiftKey: true });
    expect(screen.getByText('⌘+Z')).toBeInTheDocument();
    expect(screen.getByText('⌘+Shift+Z')).toBeInTheDocument();
    expect(screen.queryByText('Ctrl+Z')).not.toBeInTheDocument();
  });

  it('derives clipboard palette hints and disabled guidance from the keymap', () => {
    renderWorkspace();
    fireEvent.keyDown(document.body, { key: 'p', ctrlKey: true, shiftKey: true });
    expect(screen.getByText('Ctrl+C / Ctrl+Shift+C')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+X')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+V')).toBeInTheDocument();
    expect(screen.getByText('Use Ctrl+C in this browser')).toBeInTheDocument();
  });
});

describe('keyboard event ownership', () => {
  it('respects shortcuts already handled by another owner and native editing controls', () => {
    const { props } = renderWorkspace();
    const input = document.createElement('input');
    document.body.append(input);
    const prevent = (event: KeyboardEvent) => event.preventDefault();
    document.body.addEventListener('keydown', prevent);
    try {
      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
      document.body.removeEventListener('keydown', prevent);
      expect(fireEvent.keyDown(input, { key: 'z', ctrlKey: true })).toBe(true);
      expect(props.commands.undo).not.toHaveBeenCalled();
    } finally {
      document.body.removeEventListener('keydown', prevent);
      input.remove();
    }
  });

  it('leaves workspace-owned editor portal shortcuts to the editor', () => {
    const { props } = renderWorkspace();
    const portal = document.createElement('div');
    portal.dataset.workspaceSheetEditor = 'keys';
    document.body.append(portal);
    try {
      expect(fireEvent.keyDown(portal, { key: 'z', ctrlKey: true })).toBe(true);
      expect(props.commands.undo).not.toHaveBeenCalled();
    } finally {
      portal.remove();
    }
  });

  it('invokes undo and redo exactly once per shortcut', () => {
    const { props } = renderWorkspace();
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(props.commands.undo).toHaveBeenCalledOnce();
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(props.commands.redo).toHaveBeenCalledOnce();
  });

  it('runs grid editing commands only from an active grid-cell target, not from the body', () => {
    const { props } = renderWorkspace();
    expect(fireEvent.keyDown(document.body, { key: 'F2' })).toBe(true);
    expect(props.onStartEdit).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(document.body, { key: 'Delete' })).toBe(true);
    expect(props.onClearCell).not.toHaveBeenCalled();
  });

  it('runs grid editing commands when the target is an active grid cell', () => {
    const { props } = renderWorkspace();
    const target = document.createElement('div');
    target.setAttribute('role', 'cell');
    target.setAttribute('data-cell-key', 'A1');
    target.setAttribute('data-active-cell', 'true');
    target.tabIndex = 0;
    document.body.append(target);
    fireEvent.keyDown(target, { key: 'F2' });
    expect(props.onStartEdit).toHaveBeenCalledOnce();
    fireEvent.keyDown(target, { key: 'Delete' });
    expect(props.onClearCell).toHaveBeenCalledOnce();
    target.remove();
  });

  it('suppresses a disabled formatting chord without running the command', () => {
    const { props } = renderWorkspace({ selectionRange: null });
    expect(fireEvent.keyDown(document.body, { key: 'b', ctrlKey: true })).toBe(false);
    expect(props.commands.writeNumberFormats).not.toHaveBeenCalled();
    expect(props.onRestoreGridFocus).not.toHaveBeenCalled();
  });

  it('leaves primary clipboard keydowns unprevented and never calls the async clipboard API', () => {
    const write = vi.fn();
    vi.stubGlobal('navigator', { platform: '', clipboard: { write } });
    renderWorkspace();
    for (const key of ['c', 'x', 'v']) {
      expect(fireEvent.keyDown(document.body, { key, ctrlKey: true })).toBe(true);
    }
    expect(write).not.toHaveBeenCalled();
  });

  it('dispatches a configured clipboard alternative through the registered action, respecting focus and availability', async () => {
    vi.spyOn(systemClipboard, 'canWrite').mockReturnValue(true);
    const write = vi.spyOn(systemClipboard, 'write').mockResolvedValue();
    const sheet = smallSheetDocument({ id: 'clipboard-keys', name: 'Clipboard', rowCount: 4, columnCount: 4 });
    const props = formattingWorkspaceProps(sheet, formattingSelection(sheet, 'cells'));
    const view = render(<Workspace {...props} />);
    const input = document.createElement('input');
    document.body.append(input);
    expect(fireEvent.keyDown(input, { key: 'c', ctrlKey: true, shiftKey: true })).toBe(true);
    expect(write).not.toHaveBeenCalled();
    input.remove();
    expect(fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(write).toHaveBeenCalledOnce();
    await Promise.resolve();
    write.mockClear();
    view.rerender(<Workspace {...props} selectionRange={null} activeCell={null} />);
    expect(fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true, shiftKey: true })).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });
});
