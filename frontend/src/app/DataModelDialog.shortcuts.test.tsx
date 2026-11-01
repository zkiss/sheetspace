import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { DataModel } from '@workbook/core/model';
import { DataModelDialog } from './DataModelDialog';

const model: DataModel = { id: 'model', name: 'Invoice', columns: [
  { id: 'first', name: 'First', kind: 'manual', type: 'string' },
  { id: 'second', name: 'Second', kind: 'calculated', type: 'int', formula: '=1' },
] };

function editModel(onSave = vi.fn().mockReturnValue({ ok: true, value: {} })) {
  render(<DataModelDialog models={[model]} onCancel={vi.fn()} onSave={onSave} />);
  expect(screen.getByText('Invoice').tagName).toBe('CODE');
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  return { form: screen.getByRole('form', { name: 'Edit data model' }), onSave };
}

it('navigates names, inserts below, reorders with stable identities and focuses the adjacent name after deletion', async () => {
  const { form, onSave } = editModel();
  const name = (index: number) => within(form).getByLabelText(`Property ${index} name`);
  name(1).focus();
  fireEvent.keyDown(name(1), { key: 'ArrowUp' });
  expect(name(1)).toHaveFocus();
  fireEvent.keyDown(name(1), { key: 'ArrowDown' });
  expect(name(2)).toHaveFocus();
  fireEvent.keyDown(name(2), { key: 'ArrowDown' });
  expect(name(2)).toHaveFocus();
  fireEvent.keyDown(name(1), { key: 'Enter', altKey: true, shiftKey: true });
  expect(name(2)).toHaveFocus();
  fireEvent.change(name(2), { target: { value: 'Inserted' } });
  fireEvent.keyDown(name(2), { key: 'ArrowDown', altKey: true, shiftKey: true });
  expect(name(3)).toHaveFocus();
  fireEvent.keyDown(name(3), { key: 'ArrowDown', altKey: true, shiftKey: true });
  expect(name(3)).toHaveFocus();
  fireEvent.keyDown(name(3), { key: 'ArrowUp', altKey: true, shiftKey: true });
  expect(name(2)).toHaveFocus();
  fireEvent.keyDown(name(2), { key: 'Delete', altKey: true, shiftKey: true });
  expect(name(2)).toHaveFocus();
  expect(name(2)).toHaveValue('Second');
  fireEvent.keyDown(name(2), { key: 'ArrowUp', altKey: true, shiftKey: true });
  expect(name(1)).toHaveFocus();
  fireEvent.keyDown(name(1), { key: 'ArrowUp', altKey: true, shiftKey: true });
  expect(name(1)).toHaveFocus();
  fireEvent.keyDown(name(1), { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0]![0].columns.map((column: DataModel['columns'][number]) => column.id)).toEqual(['second', 'first']);
});

it('focuses newly appended properties and keeps focus in the form when the last property is removed', () => {
  const { form } = editModel();
  fireEvent.click(within(form).getByRole('button', { name: 'Add property' }));
  expect(within(form).getByLabelText('Property 3 name')).toHaveFocus();
  for (let count = 3; count > 0; count--) {
    fireEvent.keyDown(within(form).getByLabelText(`Property ${count} name`), { key: 'Delete', altKey: true, shiftKey: true });
  }
  expect(form).toContainElement(document.activeElement as HTMLElement);
});

it('saves the current formula draft with Ctrl+Enter and retains it on failure', async () => {
  const { form, onSave } = editModel(vi.fn().mockReturnValue({ ok: false, reason: 'invalid-model' }));
  fireEvent.click(within(form).getByRole('button', { name: /=1/ }));
  const formula = within(form).getByLabelText('Property 2 formula');
  fireEvent.change(formula, { target: { value: '=42' } });
  fireEvent.keyDown(formula, { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(within(form).getByRole('alert')).toHaveTextContent('Enter a model name'));
  expect(onSave).toHaveBeenCalledOnce();
  expect(onSave.mock.calls[0]![0].columns[1]).toMatchObject({ id: 'second', formula: '=42' });
  fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
});
