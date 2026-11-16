import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { FunctionDialog } from './FunctionDialog';

function openDraft(save = vi.fn()) {
  const close = vi.fn();
  render(<FunctionDialog functions={[]} onClose={close} onRetry={vi.fn()} onSave={save} onDelete={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create function' }));
  fireEvent.change(screen.getByLabelText('Function name'), { target: { value: 'total' } });
  fireEvent.click(screen.getByText('+ Add parameter'));
  fireEvent.change(screen.getByLabelText('Parameter 1 name'), { target: { value: 'amount' } });
  fireEvent.change(screen.getByLabelText('Parameter 1 type'), { target: { value: 'float' } });
  fireEvent.change(screen.getByLabelText('Formula body'), { target: { value: '=SUM(@amount)' } });
  return { close, save };
}

function expectDraft() {
  expect(screen.getByLabelText('Function name')).toHaveValue('total');
  expect(screen.getByLabelText('Parameter 1 name')).toHaveValue('amount');
  expect(screen.getByLabelText('Parameter 1 type')).toHaveValue('float');
  expect(screen.getByLabelText('Formula body')).toHaveValue('=SUM(@amount)');
}

function escape(element: HTMLElement) {
  fireEvent.keyDown(element, { key: 'Escape' });
}

it.each(['Function name', 'Parameter 1 name', 'Parameter 1 type', 'Collapse editor', 'Cancel formula', 'Save', 'Cancel'])(
  'collapses without losing the draft when focus is on %s', (label) => {
    const { close, save } = openDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }));
    const target = ['Collapse editor', 'Save', 'Cancel'].includes(label) ? screen.getByRole('button', { name: label }) : screen.getByLabelText(label);
    act(() => target.focus());
    expect(target).toHaveFocus();
    escape(target);
    expect(screen.getByRole('region', { name: 'Formula body editor' })).toHaveAttribute('data-editor-mode', 'light');
    expectDraft();
    expect(document.activeElement).toBe(label === 'Cancel formula' ? screen.getByLabelText('Formula body') : target);
    expect(close).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  },
);

it.each(['light', 'heavy'])('dismisses completion then the %s editor in order', (mode) => {
  const { close, save } = openDraft();
  if (mode === 'heavy') fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }));
  const input = screen.getByLabelText('Formula body');
  act(() => input.focus());
  (input as HTMLTextAreaElement).setSelectionRange(3, 3);
  fireEvent.keyDown(input, { key: ' ', code: 'Space', ctrlKey: true });
  expect(screen.getByRole('listbox', { name: 'Formula completions' })).toBeInTheDocument();
  escape(input);
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expectDraft();
  expect(screen.getByRole('region', { name: 'Formula body editor' })).toHaveAttribute('data-editor-mode', mode);
  escape(input);
  if (mode === 'heavy') {
    expectDraft();
    escape(input);
  }
  expect(screen.getByRole('button', { name: 'Create function' })).toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  escape(screen.getByRole('button', { name: 'Create function' }));
  expect(close).toHaveBeenCalledOnce();
});

it('dismisses an open completion from a panel action before collapsing and restores focus', () => {
  openDraft();
  fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }));
  const input = screen.getByLabelText('Formula body');
  act(() => input.focus());
  (input as HTMLTextAreaElement).setSelectionRange(3, 3);
  fireEvent.keyDown(input, { key: ' ', code: 'Space', ctrlKey: true });
  const action = screen.getByLabelText('Cancel formula');
  act(() => action.focus());
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  escape(action);
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Formula body editor' })).toHaveAttribute('data-editor-mode', 'heavy');
  escape(action);
  expect(input).toHaveFocus();
  expectDraft();
});

it('preserves the draft after Shift+Tab traverses the dialog from Save to Apply', async () => {
  const user = userEvent.setup();
  openDraft();
  await user.click(screen.getByRole('button', { name: 'Expand editor' }));
  act(() => screen.getByRole('button', { name: 'Save' }).focus());
  await user.tab({ shift: true });
  await user.tab({ shift: true });
  expect(screen.getByRole('button', { name: 'Apply' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expectDraft();
  expect(screen.getByLabelText('Formula body')).toHaveFocus();
});

it.each(['light', 'heavy'])('closes completion on focus leaving the panel in %s mode', (mode) => {
  openDraft();
  if (mode === 'heavy') fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }));
  const input = screen.getByLabelText('Formula body');
  act(() => input.focus());
  (input as HTMLTextAreaElement).setSelectionRange(3, 3);
  fireEvent.keyDown(input, { key: ' ', code: 'Space', ctrlKey: true });
  const name = screen.getByLabelText('Function name');
  act(() => name.focus());
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  escape(name);
  if (mode === 'heavy') expectDraft();
  else expect(screen.getByRole('button', { name: 'Create function' })).toBeInTheDocument();
});

it('keeps a pending draft on Escape', () => {
  const { close } = openDraft(vi.fn(() => new Promise(() => {})));
  const input = screen.getByLabelText('Formula body');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  escape(input);
  escape(screen.getByLabelText('Function name'));
  expectDraft();
  expect(close).not.toHaveBeenCalled();
});

it('keeps modified Escape as formula rollback', () => {
  openDraft();
  const input = screen.getByLabelText('Formula body');
  act(() => screen.getByLabelText('Function name').focus());
  act(() => input.focus());
  fireEvent.change(input, { target: { value: '=2' } });
  fireEvent.keyDown(input, { key: 'Escape', ctrlKey: true });
  expect(input).toHaveValue('=SUM(@amount)');
});
