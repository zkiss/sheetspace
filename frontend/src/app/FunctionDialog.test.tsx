import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { FunctionDialog } from './FunctionDialog';

const fn = { identity: 'one', name: 'value', parameters: [{ name: 'x', type: 'int' as const }], body: '=SUM(' };

it('lists signatures, reopens malformed drafts, cancels edits and deletes definitions', async () => {
  const save = vi.fn();
  const remove = vi.fn().mockResolvedValue({ ok: true, value: {} });
  render(<FunctionDialog functions={[fn]} onClose={vi.fn()} onDelete={remove} onRetry={vi.fn()} onSave={save} />);
  expect(screen.getByText('value(x: int)')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Edit value'));
  expect(screen.getByLabelText('Formula body')).toHaveValue('=SUM(');
  fireEvent.change(screen.getByLabelText('Function name'), { target: { value: 'changed' } });
  fireEvent.keyDown(screen.getByLabelText('Function name'), { key: 'Escape' });
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByText('Create function')).toHaveFocus();
  fireEvent.click(screen.getByText('Edit value'));
  expect(screen.getByLabelText('Function name')).toHaveValue('value');
  fireEvent.click(screen.getByText('Cancel'));
  expect(screen.getByText('Create function')).toHaveFocus();
  fireEvent.click(screen.getByText('Delete value'));
  await waitFor(() => expect(remove).toHaveBeenCalledWith('value'));
});

it('restores focus inside the dialog after deleting a focused row', async () => {
  const close = vi.fn();
  function Harness() {
    const [functions, setFunctions] = useState([fn]);
    return <FunctionDialog functions={functions} onClose={close} onRetry={vi.fn()} onSave={vi.fn()} onDelete={async () => { setFunctions([]); return { ok: true, value: {} } as never; }} />;
  }
  render(<Harness />);
  screen.getByText('Delete value').focus();
  fireEvent.click(screen.getByText('Delete value'));
  await waitFor(() => expect(screen.getByText('Create function')).toHaveFocus());
  fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
  expect(screen.getByText('Close')).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
});

it('keeps keyboard focus in the draft when removing parameters', () => {
  render(<FunctionDialog functions={[]} onClose={vi.fn()} onDelete={vi.fn()} onRetry={vi.fn()} onSave={vi.fn()} />);
  fireEvent.click(screen.getByText('Create function'));
  fireEvent.click(screen.getByText('+ Add parameter'));
  fireEvent.click(screen.getByText('+ Add parameter'));
  screen.getByLabelText('Remove parameter 1').focus();
  fireEvent.click(document.activeElement!);
  expect(screen.getByLabelText('Parameter 1 name')).toHaveFocus();
  screen.getByLabelText('Remove parameter 1').focus();
  fireEvent.click(document.activeElement!);
  expect(screen.getByText('+ Add parameter')).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
  expect(screen.getByText('Expand editor')).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
  expect(screen.getByLabelText('Formula body')).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.getByText('Create function')).toHaveFocus();
});

it.each([
  { button: 'Move parameter 2 up', target: 'Parameter 1 name' },
  { button: 'Move parameter 1 down', target: 'Parameter 2 name' },
])('keeps keyboard focus after $button reaches a boundary', ({ button, target }) => {
  render(<FunctionDialog functions={[]} onClose={vi.fn()} onDelete={vi.fn()} onRetry={vi.fn()} onSave={vi.fn()} />);
  fireEvent.click(screen.getByText('Create function'));
  fireEvent.click(screen.getByText('+ Add parameter'));
  fireEvent.click(screen.getByText('+ Add parameter'));
  screen.getByLabelText(button).focus();
  fireEvent.click(document.activeElement!);
  expect(screen.getByLabelText(target)).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
  expect(document.activeElement).toHaveAttribute('aria-label', target.replace('name', 'type'));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.getByText('Create function')).toHaveFocus();
});

it('retains a failed save and allows retry while trapping dialog focus', async () => {
  const retry = vi.fn();
  const save = vi.fn().mockResolvedValueOnce({ ok: false, reason: 'persistence-failed' }).mockResolvedValueOnce({ ok: true, value: {} });
  render(<><button>Outside</button><FunctionDialog functions={[]} onClose={vi.fn()} onDelete={vi.fn()} onRetry={retry} onSave={save} /></>);
  fireEvent.click(screen.getByText('Create function'));
  fireEvent.change(screen.getByLabelText('Function name'), { target: { value: 'test' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not be saved'));
  expect(screen.getByLabelText('Function name')).toHaveValue('test');
  fireEvent.change(screen.getByLabelText('Function name'), { target: { value: 'updated' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'updated' }), undefined));
  expect(retry).not.toHaveBeenCalled();
  screen.getByText('Outside').focus();
  expect(within(screen.getByRole('dialog')).getByText('Create function')).toHaveFocus();
});
