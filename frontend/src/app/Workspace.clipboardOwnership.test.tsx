import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { smallSheetDocument } from '@test-support/workbookFactories';
import { formattingSelection } from '@test-support/formattingProjection';
import { formattingWorkspaceProps } from '@test-support/formattingWorkspace';
import { Workspace } from './Workspace';
import { systemClipboard } from './systemClipboard';

vi.mock('@shared/keyboard/keymap', async (importOriginal) => {
  const original = await importOriginal<typeof import('@shared/keyboard/keymap')>();
  const keymap = { ...original.keymap, cut: [{ key: 'x', mod: true, shift: true }], paste: [{ key: 'v', mod: true, shift: true }] };
  return {
    ...original, keymap,
    matchesShortcut: (event: never, id: string, platform = original.detectPlatform(), map = keymap) => original.matchesShortcut(event, id, platform, map),
    dispatchShortcut: (event: never, commands: never, context: never, platform = original.detectPlatform(), map = keymap) => original.dispatchShortcut(event, commands, context, platform, map),
    shortcutLabel: (id: string, platform = original.detectPlatform(), map = keymap) => original.shortcutLabel(id, platform, map),
  };
});

afterEach(() => vi.restoreAllMocks());

function clipboardData(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { getData: (type: string) => values.get(type) ?? '', setData: (type: string, value: string) => { values.set(type, value); }, get types() { return [...values.keys()]; } };
}

function setup() {
  const sheet = smallSheetDocument({ id: 'clipboard', name: 'Clipboard', rowCount: 4, columnCount: 4 });
  const props = formattingWorkspaceProps(sheet, formattingSelection(sheet, 'cells'));
  vi.mocked(props.commands.pasteStoredCells).mockReturnValue({ ok: true, changed: true });
  const view = render(<Workspace {...props} />);
  const cell = view.container.querySelector<HTMLElement>('[data-cell-key][data-active-cell="true"]')!;
  return { props, cell };
}

describe('registered clipboard alternatives and native grid ownership', () => {
  it.each(['copy', 'cut', 'paste', 'cancel'] as const)('abandons a deferred alternative paste after native %s', async (route) => {
    vi.spyOn(systemClipboard, 'canRead').mockReturnValue(true);
    let resolve!: (value: { text: string }) => void;
    const read = vi.spyOn(systemClipboard, 'read').mockReturnValueOnce(new Promise((done) => { resolve = done; })).mockResolvedValue({ text: 'subsequent' });
    const { props, cell } = setup();
    fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true, shiftKey: true });
    expect(read).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    const data = clipboardData({ 'text/plain': 'native' });
    if (route === 'copy') fireEvent.copy(cell, { clipboardData: data });
    if (route === 'cut') fireEvent.cut(cell, { clipboardData: data });
    if (route === 'paste') fireEvent.paste(cell, { clipboardData: data });
    if (route === 'cancel') fireEvent.keyDown(cell, { key: 'Escape' });
    const writes = vi.mocked(props.commands.pasteCells).mock.calls.length + vi.mocked(props.commands.pasteStoredCells).mock.calls.length;
    await act(async () => resolve({ text: 'obsolete' }));
    expect(vi.mocked(props.commands.pasteCells).mock.calls.length + vi.mocked(props.commands.pasteStoredCells).mock.calls.length).toBe(writes);
    expect(props.onRestoreGridFocus).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true, shiftKey: true });
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => {});
  });

  it.each(['rows', 'columns'] as const)('rejects scattered %s in native and palette routes', (mode) => {
    vi.spyOn(systemClipboard, 'canWrite').mockReturnValue(true);
    vi.spyOn(systemClipboard, 'canRead').mockReturnValue(true);
    const write = vi.spyOn(systemClipboard, 'write').mockResolvedValue();
    const read = vi.spyOn(systemClipboard, 'read').mockResolvedValue({ text: 'clipboard' });
    const sheet = smallSheetDocument({ id: 'scatter', name: 'Scatter', rowCount: 4, columnCount: 4 });
    const base = formattingSelection(sheet, mode);
    const members = mode === 'rows' ? sheet.content.rows : sheet.content.columns;
    const props = formattingWorkspaceProps(sheet, { ...base, members: [members[0]!, members[2]!] });
    const view = render(<Workspace {...props} />);
    const cell = view.container.querySelector<HTMLElement>('[data-cell-key][data-active-cell="true"]')!;
    const data = clipboardData();
    fireEvent.copy(cell, { clipboardData: data });
    fireEvent.cut(cell, { clipboardData: data });
    fireEvent.paste(cell, { clipboardData: clipboardData({ 'text/plain': 'native' }) });
    expect(data.types).toHaveLength(0);
    expect(props.commands.pasteStoredCells).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
    const search = screen.getByLabelText('Command search');
    fireEvent.change(search, { target: { value: 'Copy selection' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    fireEvent.change(search, { target: { value: 'Cut selection' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    fireEvent.change(search, { target: { value: 'Paste' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(write).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects a selection owned by another sheet on native and palette routes', () => {
    vi.spyOn(systemClipboard, 'canWrite').mockReturnValue(true);
    const write = vi.spyOn(systemClipboard, 'write').mockResolvedValue();
    const sheet = smallSheetDocument({ id: 'owned', name: 'Owned', rowCount: 4, columnCount: 4 });
    const selection = formattingSelection(sheet, 'cells');
    const props = formattingWorkspaceProps(sheet, { ...selection, extent: { ...selection.extent, sheetId: 'other' } });
    const view = render(<Workspace {...props} />);
    const cell = view.container.querySelector<HTMLElement>('[data-cell-key][data-active-cell="true"]')!;
    const data = clipboardData();
    fireEvent.copy(cell, { clipboardData: data });
    fireEvent.cut(cell, { clipboardData: data });
    fireEvent.paste(cell, { clipboardData: clipboardData({ 'text/plain': 'native' }) });
    expect(data.types).toHaveLength(0);
    expect(props.commands.pasteStoredCells).not.toHaveBeenCalled();
    expect(props.commands.pasteCells).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
    const search = screen.getByLabelText('Command search');
    fireEvent.change(search, { target: { value: 'Copy selection' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(write).not.toHaveBeenCalled();
  });

  it.each(['rows', 'columns'] as const)('copies contiguous %s through native and palette routes', async (mode) => {
    vi.spyOn(systemClipboard, 'canWrite').mockReturnValue(true);
    const write = vi.spyOn(systemClipboard, 'write').mockResolvedValue();
    const sheet = smallSheetDocument({ id: 'contiguous', name: 'Contiguous', rowCount: 4, columnCount: 4 });
    const members = mode === 'rows' ? sheet.content.rows : sheet.content.columns;
    const props = formattingWorkspaceProps(sheet, { ...formattingSelection(sheet, mode), members: members.slice(0, 3) });
    const view = render(<Workspace {...props} />);
    const cell = view.container.querySelector<HTMLElement>('[data-cell-key][data-active-cell="true"]')!;
    const data = clipboardData();
    fireEvent.copy(cell, { clipboardData: data });
    expect(data.types).toContain('text/plain');
    fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
    const search = screen.getByLabelText('Command search');
    fireEvent.change(search, { target: { value: 'Copy selection' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(write).toHaveBeenCalledOnce();
    await act(async () => {});
  });

  it('blocks native events while an actual palette cut is pending and completes it normally', async () => {
    vi.spyOn(systemClipboard, 'canWrite').mockReturnValue(true);
    let resolve!: () => void;
    const write = vi.spyOn(systemClipboard, 'write').mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    const { props, cell } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
    const search = screen.getByLabelText('Command search');
    fireEvent.change(search, { target: { value: 'Cut selection' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(write).toHaveBeenCalledOnce();
    const data = clipboardData({ 'text/plain': 'native' });
    fireEvent.copy(cell, { clipboardData: data });
    fireEvent.cut(cell, { clipboardData: data });
    fireEvent.paste(cell, { clipboardData: data });
    expect(data.getData('application/x-sheetspace-clipboard')).toBe('');
    expect(props.commands.pasteStoredCells).not.toHaveBeenCalled();
    expect(cell).toHaveAttribute('data-pending-cut', 'true');
    await act(async () => resolve());
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    expect(cell).toHaveAttribute('data-pending-cut', 'true');
  });

  it('abandons a pending palette cut on close before a newer native cut', async () => {
    vi.spyOn(systemClipboard, 'canWrite').mockReturnValue(true);
    let reject!: (error: Error) => void;
    vi.spyOn(systemClipboard, 'write').mockReturnValue(new Promise<void>((_, fail) => { reject = fail; }));
    const { props, cell } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
    const search = screen.getByLabelText('Command search');
    fireEvent.change(search, { target: { value: 'Cut selection' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(cell).toHaveAttribute('data-pending-cut', 'true');
    fireEvent.keyDown(search, { key: 'Escape' });
    const data = clipboardData();
    fireEvent.cut(cell, { clipboardData: data });
    expect(data.getData('application/x-sheetspace-clipboard')).toMatch(/^sheetspace:/);
    await act(async () => reject(new Error('obsolete')));
    expect(cell).toHaveAttribute('data-pending-cut', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(props.commands.pasteStoredCells).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)('keeps a newer native cut when an older alternative cut %ss', async (outcome) => {
    vi.spyOn(systemClipboard, 'canWrite').mockReturnValue(true);
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    vi.spyOn(systemClipboard, 'write').mockReturnValueOnce(new Promise<void>((done, fail) => { resolve = done; reject = fail; }));
    const { props, cell } = setup();
    fireEvent.keyDown(document.body, { key: 'x', ctrlKey: true, shiftKey: true });
    expect(cell).toHaveAttribute('data-pending-cut', 'true');
    const data = clipboardData();
    fireEvent.cut(cell, { clipboardData: data });
    expect(data.getData('application/x-sheetspace-clipboard')).toMatch(/^sheetspace:/);
    await act(async () => { if (outcome === 'resolve') resolve(); else reject(new Error('obsolete')); });
    expect(cell).toHaveAttribute('data-pending-cut', 'true');
    expect(props.onRestoreGridFocus).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
