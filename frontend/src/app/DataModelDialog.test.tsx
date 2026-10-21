import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DataModel } from '@workbook/core/model';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { DataModelDialog } from './DataModelDialog';
import { App } from './App';
import { SheetGridCellEditor } from '@grid/SheetGridCellEditor';
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

  it('freezes a submitting draft until failure permits an intentional retry or cancellation', async () => {
    const pending = deferred<{ ok: false; reason: 'persistence-failed' }>();
    const { onCancel, onSave } = setup([], vi.fn().mockReturnValue(pending.promise));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Create model' }));
    const form = screen.getByRole('form', { name: 'Create data model' });
    await user.type(within(form).getByLabelText('Model name'), 'Frozen');
    await user.type(within(form).getByLabelText('Property 1 name'), 'Input');
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    expect(within(form).getByLabelText('Model name')).toBeDisabled();
    expect(within(form).getByRole('button', { name: 'Add property' })).toBeDisabled();
    expect(within(form).getByRole('button', { name: 'Remove property 1' })).toBeDisabled();
    fireEvent.keyDown(within(form).getByLabelText('Model name'), { key: 'Escape' });
    fireEvent.submit(form);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledOnce();

    await pending.resolve({ ok: false, reason: 'persistence-failed' });
    await waitFor(() => expect(within(form).getByRole('button', { name: 'Save' })).toBeEnabled());
    expect(within(form).getByLabelText('Model name')).toHaveValue('Frozen');
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Create model' })).toBeInTheDocument();
  });

  it('shows immediate validation and command failures without discarding the draft', async () => {
    setup([], vi.fn()
      .mockReturnValueOnce({ ok: false, reason: 'invalid-model' })
      .mockReturnValueOnce({ ok: false, reason: 'duplicate-model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create model' }));
    const form = screen.getByRole('form', { name: 'Create data model' });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(form).getByRole('alert')).toHaveTextContent('Enter a model name'));
    expect(within(form).getByLabelText('Model name')).toHaveValue('');
    fireEvent.change(within(form).getByLabelText('Model name'), { target: { value: 'Duplicate' } });
    fireEvent.change(within(form).getByLabelText('Property 1 name'), { target: { value: 'Value' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(form).getByRole('alert')).toHaveTextContent('This model already exists.'));
    expect(within(form).getByLabelText('Model name')).toHaveValue('Duplicate');
    expect(within(form).getByLabelText('Property 1 name')).toHaveValue('Value');
  });

  it('offers an in-dialog retry for a failed ordinary-save prerequisite without discarding the draft', async () => {
    const retry = vi.fn();
    const onSave = vi.fn().mockReturnValue({ ok: false, reason: 'blocked-persistence-prerequisite' });
    render(<DataModelDialog models={[]} onCancel={vi.fn()} onRetryFailedSaves={retry} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create model' }));
    const form = screen.getByRole('form', { name: 'Create data model' });
    fireEvent.change(within(form).getByLabelText('Model name'), { target: { value: 'Retry me' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(within(form).getByRole('alert')).toHaveTextContent('Earlier workbook changes need to be retried'));
    fireEvent.click(within(form).getByRole('button', { name: 'Retry earlier changes' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(within(form).getByLabelText('Model name')).toHaveValue('Retry me');
  });

  it('offers in-dialog prerequisite recovery after a queued model save is blocked', async () => {
    const retry = vi.fn();
    const pending = deferred<{ ok: false; reason: 'blocked-persistence-prerequisite' }>();
    const onSave = vi.fn().mockReturnValue(pending.promise);
    render(<DataModelDialog models={[]} onCancel={vi.fn()} onRetryFailedSaves={retry} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create model' }));
    const form = screen.getByRole('form', { name: 'Create data model' });
    fireEvent.change(within(form).getByLabelText('Model name'), { target: { value: 'Queued retry' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(within(form).getByRole('status')).toHaveTextContent('Saving model…');

    await pending.resolve({ ok: false, reason: 'blocked-persistence-prerequisite' });

    await waitFor(() => expect(within(form).getByRole('alert')).toHaveTextContent('Earlier workbook changes need to be retried'));
    fireEvent.click(within(form).getByRole('button', { name: 'Retry earlier changes' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(within(form).getByLabelText('Model name')).toHaveValue('Queued retry');
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

  it('keeps keyboard traversal and shortcuts inside the modal', async () => {
    render(<App initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'sheet', name: 'Sheet' })])} />);
    const newSheet = screen.getByRole('button', { name: 'New sheet' });
    fireEvent.click(screen.getByRole('button', { name: 'Data models' }));
    const dialog = screen.getByRole('dialog', { name: 'Data models' });
    const create = within(dialog).getByRole('button', { name: 'Create model' });
    expect(create).toHaveFocus();
    fireEvent.keyDown(create, { key: 'Tab', shiftKey: true });
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(create).toHaveFocus();
    fireEvent.keyDown(create, { key: 'N', shiftKey: true });
    expect(screen.queryByRole('form', { name: 'Create sheet' })).not.toBeInTheDocument();
    await userEvent.setup().keyboard('{Enter}');
    expect(screen.getByRole('form', { name: 'Create data model' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Create sheet' })).not.toBeInTheDocument();
    expect(newSheet).not.toHaveFocus();
  });

  it('keeps focus in the dialog after removing focused properties, including the last one', async () => {
    const workbook = { ...workbookWithSheets([smallSheetDocument({ id: 'sheet', name: 'Sheet' })]), dataModels: { invoice: savedModel } };
    render(<App initialWorkbook={workbook} />);
    const newSheet = screen.getByRole('button', { name: 'New sheet' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Data models' }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Data models' });

    await user.click(within(dialog).getByRole('button', { name: 'Remove property 1' }));
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
    await user.keyboard('{Shift>}{Tab}{/Shift}{Tab}');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.click(within(dialog).getByRole('button', { name: 'Remove property 1' }));
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
    await user.keyboard('{Tab}');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(newSheet).not.toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('form', { name: 'Create sheet' })).not.toBeInTheDocument();
  });

  it('uses the controlled raw formula input in both model and cell editors', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Create model' }));
    const form = screen.getByRole('form', { name: 'Create data model' });
    fireEvent.change(within(form).getByLabelText('Property 1 kind'), { target: { value: 'calculated' } });
    expect(within(form).getByLabelText('Property 1 formula')).toHaveAttribute('data-raw-formula-input', 'true');
    const anchor = { current: document.createElement('div') };
    render(<SheetGridCellEditor anchor={anchor} cellKey="A1" sheetName="Inputs"
      editingCell={{ target: { sheetId: 'inputs', cell: { rowId: 'row', columnId: 'column' } }, draft: '=1' }}
      interaction={{ cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() }} />);
    expect(screen.getByLabelText('Inputs A1 editor')).toHaveAttribute('data-raw-formula-input', 'true');
  });

  it('retains the ordered draft after the App controller reports persistence failure', async () => {
    const apiClient = autosaveClient({ saveModelLifecycle: vi.fn().mockRejectedValue(new Error('offline')) });
    render(<App apiClient={apiClient} initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'sheet', name: 'Sheet' })])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Data models' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create model' }));
    const form = screen.getByRole('form', { name: 'Create data model' });
    fireEvent.change(within(form).getByLabelText('Model name'), { target: { value: 'Retry' } });
    fireEvent.change(within(form).getByLabelText('Property 1 name'), { target: { value: 'First' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add property' }));
    fireEvent.change(within(form).getByLabelText('Property 2 name'), { target: { value: 'Second' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(form).getByRole('alert')).toHaveTextContent('Review the draft and try again'));
    expect(within(form).getByLabelText('Property 1 name')).toHaveValue('First');
    expect(within(form).getByLabelText('Property 2 name')).toHaveValue('Second');
  });

  it('removes a rejected create from the list when its retained draft is cancelled', async () => {
    const apiClient = autosaveClient({ saveModelLifecycle: vi.fn().mockRejectedValue(new Error('offline')) });
    render(<App apiClient={apiClient} initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'sheet', name: 'Sheet' })])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Data models' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create model' }));
    const form = screen.getByRole('form', { name: 'Create data model' });
    fireEvent.change(within(form).getByLabelText('Model name'), { target: { value: 'Rejected' } });
    fireEvent.change(within(form).getByLabelText('Property 1 name'), { target: { value: 'Input' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(form).getByRole('alert')).toBeInTheDocument());
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Data models' }));
    expect(screen.getByText('No data models yet. Create one to define reusable sheet properties.')).toBeInTheDocument();
    expect(screen.queryByText('Rejected')).not.toBeInTheDocument();
  });

  it('restores a rejected edit when its retained draft is cancelled', async () => {
    const apiClient = autosaveClient({ saveModelLifecycle: vi.fn().mockRejectedValue(new Error('offline')) });
    const workbook = { ...workbookWithSheets([smallSheetDocument({ id: 'sheet', name: 'Sheet' })]), dataModels: { invoice: savedModel } };
    render(<App apiClient={apiClient} initialWorkbook={workbook} />);
    fireEvent.click(screen.getByRole('button', { name: 'Data models' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit data model' });
    fireEvent.change(within(form).getByLabelText('Model name'), { target: { value: 'Rejected edit' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(form).getByRole('alert')).toBeInTheDocument());
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Data models' }));
    expect(screen.getByText('Invoice')).toBeInTheDocument();
    expect(screen.queryByText('Rejected edit')).not.toBeInTheDocument();
  });
});
