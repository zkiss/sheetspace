import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DataModel } from '@workbook/core/model';
import { deferred } from '@test-support/apiClients';
import { DataModelDialog } from './DataModelDialog';
import { App } from './App';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

const savedModel: DataModel = {
  id: 'invoice', name: 'Invoice', columns: [
    { id: 'amount', name: 'Amount', kind: 'manual', type: 'float' },
    { id: 'tax', name: 'Tax', kind: 'calculated', type: 'float', formula: '=@Amount[1]*0.2' },
  ],
};

function setup(models: readonly DataModel[] = [], onSave = vi.fn().mockReturnValue({ ok: true, value: {} })) {
  const onCancel = vi.fn();
  render(<DataModelDialog models={models} onCancel={onCancel} onSave={onSave} />);
  return { onCancel, onSave };
}

describe('DataModelDialog', () => {
  it('shows its empty state and creates ordered manual and calculated properties with explicit types', async () => {
    const { onSave } = setup();
    expect(screen.getByText('No data models yet. Create one to define reusable sheet properties.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create model' }));
    const form = screen.getByRole('form', { name: 'Create data model' });
    fireEvent.change(within(form).getByLabelText('Model name'), { target: { value: 'Order' } });
    fireEvent.change(within(form).getByLabelText('Property 1 name'), { target: { value: 'Total' } });
    fireEvent.change(within(form).getByLabelText('Property 1 kind'), { target: { value: 'calculated' } });
    fireEvent.change(within(form).getByLabelText('Property 1 type'), { target: { value: 'float' } });
    fireEvent.change(within(form).getByLabelText('Property 1 formula'), { target: { value: '=1+2' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add property' }));
    fireEvent.change(within(form).getByLabelText('Property 2 name'), { target: { value: 'Paid' } });
    fireEvent.change(within(form).getByLabelText('Property 2 type'), { target: { value: 'boolean' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ name: 'Order', columns: [
      { name: 'Total', kind: 'calculated', type: 'float', formula: '=1+2' },
      { name: 'Paid', kind: 'manual', type: 'boolean' },
    ] });
  });

  it('keeps IDs on rename and reorder but allocates a fresh ID after removal and addition', async () => {
    const { onSave } = setup([savedModel]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit data model' });
    fireEvent.change(within(form).getByLabelText('Property 2 name'), { target: { value: 'VAT' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Move property 2 up' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].columns.map((column: DataModel['columns'][number]) => column.id)).toEqual(['tax', 'amount']);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const edit = screen.getByRole('form', { name: 'Edit data model' });
    fireEvent.click(within(edit).getByRole('button', { name: 'Remove property 1' }));
    fireEvent.click(within(edit).getByRole('button', { name: 'Add property' }));
    fireEvent.change(within(edit).getByLabelText('Property 2 name'), { target: { value: 'Tax' } });
    expect(screen.getByText(/New replacement properties start empty/)).toBeInTheDocument();
    fireEvent.click(within(edit).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][0].columns[1].id).not.toBe('tax');
  });

  it('retains an asynchronous failed-save draft and reports the failure for retry', async () => {
    const pending = deferred<{ ok: false; reason: 'persistence-failed' }>();
    const { onSave } = setup([], vi.fn().mockReturnValue(pending.promise));
    fireEvent.click(screen.getByRole('button', { name: 'Create model' }));
    const form = screen.getByRole('form', { name: 'Create data model' });
    fireEvent.change(within(form).getByLabelText('Model name'), { target: { value: 'Retry me' } });
    fireEvent.change(within(form).getByLabelText('Property 1 name'), { target: { value: 'Input' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(within(form).getByRole('status')).toHaveTextContent('Saving model…');
    await pending.resolve({ ok: false, reason: 'persistence-failed' });
    await waitFor(() => expect(within(form).getByRole('alert')).toHaveTextContent('Review the draft and try again'));
    expect(within(form).getByLabelText('Model name')).toHaveValue('Retry me');
    expect(within(form).getByLabelText('Property 1 name')).toHaveValue('Input');
    expect(within(form).getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('cancels drafts with Escape and exposes labeled controls', () => {
    const { onCancel } = setup([savedModel]);
    expect(screen.getByRole('button', { name: 'Create model' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit data model' });
    expect(within(form).getByLabelText('Model name')).toHaveFocus();
    expect(within(form).getByLabelText('Property 1 kind')).toBeInTheDocument();
    fireEvent.keyDown(within(form).getByLabelText('Model name'), { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Data models' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Data models' }), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('opens from the workspace and restores focus to its toolbar entry after close', () => {
    render(<App initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'sheet', name: 'Sheet' })])} />);
    const trigger = screen.getByRole('button', { name: 'Data models' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Data models' });
    expect(within(dialog).getByRole('button', { name: 'Create model' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Data models' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
