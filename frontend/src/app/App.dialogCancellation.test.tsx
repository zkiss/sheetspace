import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { autosaveClient } from '@test-support/apiClients';
import { openSheetContextMenu } from '@test-support/appScreen';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { App } from './App';

function setup() {
  const apiClient = autosaveClient();
  render(<App apiClient={apiClient} initialWorkbook={workbookWithSheets([
    smallSheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: 'Original' } }),
  ])} />);
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  const cell = within(frame).getByRole('cell', { name: 'Inputs A1 cell' });
  fireEvent.click(cell);
  return { apiClient, cell, frame };
}

function openDialog(kind: 'Create' | 'Rename', frame: HTMLElement) {
  if (kind === 'Create') fireEvent.click(screen.getByRole('button', { name: 'New sheet' }));
  else fireEvent.click(within(openSheetContextMenu(frame)).getByRole('menuitem', { name: 'Rename' }));
  return screen.getByRole('form', { name: `${kind} sheet` });
}

describe('App sheet dialog cancellation', () => {
  it.each([
    ['Fill colour', 'name'],
    ['Fill colour', 'submit'],
    ['Text colour', 'name'],
    ['Text colour', 'cancel'],
  ])('retires the open %s palette when Shift+N opens creation, then cancels from %s without leaking focus', (paletteName, escapeTarget) => {
    const { apiClient, cell } = setup();
    fireEvent.cut(cell, { clipboardData: { setData: () => undefined } });
    const trigger = screen.getByRole('button', { name: new RegExp(`^${paletteName}:`) });
    trigger.focus();
    fireEvent.click(trigger);
    const palette = screen.getByRole('dialog', { name: paletteName });
    fireEvent.input(within(palette).getByLabelText('Custom colour'), { target: { value: '#abcdef' } });
    fireEvent.keyDown(trigger, { key: 'N', shiftKey: true });

    const dialog = screen.getByRole('form', { name: 'Create sheet' });
    const input = within(dialog).getByRole('textbox');
    expect(input).toHaveFocus();
    expect(screen.queryByRole('dialog', { name: paletteName })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toBeDisabled();
    const control = escapeTarget === 'name' ? input
      : within(dialog).getByRole('button', { name: escapeTarget === 'submit' ? 'Create' : 'Cancel' });
    control.focus();
    fireEvent.change(input, { target: { value: 'Abandoned sheet' } });
    fireEvent.keyDown(control, { key: 'Escape' });

    expect(screen.queryByRole('form', { name: 'Create sheet' })).not.toBeInTheDocument();
    expect(trigger).not.toHaveFocus();
    expect(trigger).toBeEnabled();
    expect(cell).toHaveAttribute('data-active-cell', 'true');
    expect(cell).toHaveAttribute('data-pending-cut', 'true');
    expect(apiClient.createSheet).not.toHaveBeenCalled();
    expect(apiClient.writeCells).not.toHaveBeenCalled();
    expect(apiClient.writeNumberFormats).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    expect(within(screen.getByRole('dialog', { name: paletteName })).getByLabelText('Custom colour'))
      .toHaveValue(paletteName === 'Fill colour' ? '#ffffff' : '#1f2933');
  });

  it.each(['Create', 'Rename'] as const)('discards a %s draft and validation on Escape, preserving grid selection and pending cut', (kind) => {
    const { apiClient, cell, frame } = setup();
    fireEvent.cut(cell, { clipboardData: { setData: () => undefined } });
    expect(cell).toHaveAttribute('data-pending-cut', 'true');
    let dialog = openDialog(kind, frame);
    expect(screen.getByRole('button', { name: /^Fill colour:/ })).toBeDisabled();
    let input = within(dialog).getByRole('textbox');
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: kind === 'Create' ? 'Create' : 'Save' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Sheet name is required.');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Fill colour:/ })).toBeEnabled();
    expect(cell).toHaveAttribute('data-active-cell', 'true');
    expect(cell).toHaveAttribute('data-pending-cut', 'true');
    expect(cell).toHaveTextContent('Original');

    dialog = openDialog(kind, frame);
    input = within(dialog).getByRole('textbox');
    expect(input).toHaveValue(kind === 'Create' ? '' : 'Inputs');
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Abandoned draft' } });
    const submit = within(dialog).getByRole('button', { name: kind === 'Create' ? 'Create' : 'Save' });
    submit.focus();
    fireEvent.keyDown(submit, { key: 'Escape' });
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    dialog = openDialog(kind, frame);
    expect(within(dialog).getByRole('textbox')).toHaveValue(kind === 'Create' ? '' : 'Inputs');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Cancelled draft' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    dialog = openDialog(kind, frame);
    expect(within(dialog).getByRole('textbox')).toHaveValue(kind === 'Create' ? '' : 'Inputs');
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(apiClient.createSheet).not.toHaveBeenCalled();
    expect(apiClient.renameSheet).not.toHaveBeenCalled();
    expect(apiClient.writeCells).not.toHaveBeenCalled();
  });
});
