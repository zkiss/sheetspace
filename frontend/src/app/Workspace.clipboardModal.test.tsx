import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { smallSheetDocument } from '@test-support/workbookFactories';
import { formattingSelection } from '@test-support/formattingProjection';
import { formattingWorkspaceProps } from '@test-support/formattingWorkspace';
import { Workspace } from './Workspace';
import { systemClipboard } from './systemClipboard';

afterEach(() => vi.restoreAllMocks());

function setup() {
  const sheet = smallSheetDocument({ id: 'modal', name: 'Modal', rowCount: 4, columnCount: 4 });
  const props = formattingWorkspaceProps(sheet, formattingSelection(sheet, 'cells'));
  vi.mocked(props.commands.pasteCells).mockReturnValue({ ok: true, changed: true });
  vi.mocked(props.commands.pasteStoredCells).mockReturnValue({ ok: true, changed: true });
  const view = render(<Workspace {...props} />);
  const cell = view.container.querySelector<HTMLElement>('[data-cell-key][data-active-cell="true"]')!;
  fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
  return { props, cell, search: screen.getByLabelText('Command search') };
}

function attemptNativeClipboardEvents(cell: HTMLElement) {
  const data = { types: ['text/plain'], getData: () => 'native', setData: vi.fn() };
  fireEvent.copy(cell, { clipboardData: data });
  fireEvent.cut(cell, { clipboardData: data });
  fireEvent.paste(cell, { clipboardData: data });
  expect(data.setData).not.toHaveBeenCalled();
}

describe('palette clipboard modal isolation', () => {
  it('captures native events during a pending copy and completes the copy', async () => {
    vi.spyOn(systemClipboard, 'canWrite').mockReturnValue(true);
    let resolve!: () => void;
    const write = vi.spyOn(systemClipboard, 'write').mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    const { props, cell, search } = setup();
    fireEvent.change(search, { target: { value: 'Copy selection' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(write).toHaveBeenCalledOnce();
    attemptNativeClipboardEvents(cell);
    expect(cell).not.toHaveAttribute('data-pending-cut', 'true');
    expect(props.commands.pasteCells).not.toHaveBeenCalled();
    expect(props.commands.pasteStoredCells).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    await act(async () => resolve());
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });

  it('captures native events during a pending paste and applies the resolved payload', async () => {
    vi.spyOn(systemClipboard, 'canRead').mockReturnValue(true);
    let resolve!: (value: { text: string }) => void;
    const read = vi.spyOn(systemClipboard, 'read').mockReturnValue(new Promise((done) => { resolve = done; }));
    const { props, cell, search } = setup();
    fireEvent.change(search, { target: { value: 'Paste' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(read).toHaveBeenCalledOnce();
    attemptNativeClipboardEvents(cell);
    expect(cell).not.toHaveAttribute('data-pending-cut', 'true');
    expect(props.commands.pasteCells).not.toHaveBeenCalled();
    expect(props.commands.pasteStoredCells).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    await act(async () => resolve({ text: 'palette payload' }));
    expect(props.commands.pasteStoredCells).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(props.commands.pasteStoredCells).mock.calls)).toContain('palette payload');
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });
});
