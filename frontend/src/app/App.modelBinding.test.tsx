import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataModel } from '@workbook/core/model';
import { autosaveClient, persistedWorkbookClient } from '@test-support/apiClients';
import { positionedSheet, workbookWithSheets } from '@test-support/workbookFactories';
import { App } from './App';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const declaredModel: DataModel = {
  id: 'invoice', name: 'Invoice', columns: [
    { id: 'amount', name: 'Amount', kind: 'manual', type: 'float' },
    { id: 'tax', name: 'Tax', kind: 'manual', type: 'float' },
  ],
};

function inputsWorkbook() {
  const sheet = positionedSheet('inputs', 'Inputs', { x: 48, y: 96 });
  return { sheet, workbook: workbookWithSheets([sheet]) };
}

function frame() {
  return screen.getByRole('article', { name: 'Sheet Inputs' });
}

function cellAt(key: string) {
  const cell = frame().querySelector<HTMLElement>(`[data-cell-key="${key}"]`);
  if (!cell) throw new Error(`Missing cell ${key}`);
  return cell;
}

function columnLabels() {
  return [...frame().querySelectorAll<HTMLElement>('[role="columnheader"]')]
    .filter((header) => header.getAttribute('aria-label') !== 'Grid corner')
    .map((header) => header.textContent);
}

function modelSelect() {
  return screen.getByLabelText('Model for Inputs') as HTMLSelectElement;
}

describe('App model binding workflow', () => {
  it('creates a model through the dialog, binds a sheet to it, and follows live property renames and reorders', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { workbook } = inputsWorkbook();
    const apiClient = persistedWorkbookClient(workbook);
    render(<App initialWorkbook={workbook} apiClient={apiClient} />);

    fireEvent.click(cellAt('A1'));
    fireEvent.click(screen.getByRole('button', { name: 'Data models' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create model' }));
    const create = screen.getByRole('form', { name: 'Create data model' });
    fireEvent.change(within(create).getByLabelText('Model name'), { target: { value: 'Invoice' } });
    fireEvent.change(within(create).getByLabelText('Property 1 name'), { target: { value: 'Amount' } });
    fireEvent.click(within(create).getByRole('button', { name: 'Add property' }));
    fireEvent.change(within(create).getByLabelText('Property 2 name'), { target: { value: 'Tax' } });
    fireEvent.click(within(create).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiClient.saveModelLifecycle).toHaveBeenCalledTimes(1));

    const created = within(modelSelect()).getByRole('option', { name: 'Invoice' }) as HTMLOptionElement;
    fireEvent.change(modelSelect(), { target: { value: created.value } });
    fireEvent.click(screen.getByRole('button', { name: 'Bind model' }));

    await waitFor(() => expect(screen.getByLabelText('Bound to Invoice')).toBeInTheDocument());
    await waitFor(() => expect(columnLabels()).toEqual(['Amount', 'Tax']));

    fireEvent.click(screen.getByRole('button', { name: 'Edit model' }));
    const edit = screen.getByRole('form', { name: 'Edit data model' });
    expect(within(edit).getByLabelText('Model name')).toHaveValue('Invoice');
    fireEvent.change(within(edit).getByLabelText('Model name'), { target: { value: 'Receipt' } });
    fireEvent.change(within(edit).getByLabelText('Property 1 name'), { target: { value: 'Total' } });
    fireEvent.click(within(edit).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByLabelText('Bound to Receipt')).toBeInTheDocument());
    await waitFor(() => expect(columnLabels()).toEqual(['Total', 'Tax']));

    fireEvent.click(screen.getByRole('button', { name: 'Edit model' }));
    const reorder = screen.getByRole('form', { name: 'Edit data model' });
    fireEvent.click(within(reorder).getByRole('button', { name: 'Move property 2 up' }));
    fireEvent.click(within(reorder).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(columnLabels()).toEqual(['Tax', 'Total']));
  });

  it('reports a rejected binding persistence and restores the unbound sheet with its selection', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { workbook } = inputsWorkbook();
    const apiClient = autosaveClient({ saveModelLifecycle: vi.fn().mockRejectedValue(new Error('offline')) });
    render(<App initialWorkbook={{ ...workbook, dataModels: { invoice: declaredModel } }} apiClient={apiClient} />);

    fireEvent.click(cellAt('A1'));
    fireEvent.change(modelSelect(), { target: { value: 'invoice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bind model' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The data model change was not saved.'));
    expect(screen.queryByLabelText('Bound to Invoice')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bind model' })).toBeEnabled();
    expect(cellAt('A1')).toHaveAttribute('aria-selected', 'true');
  });

  it('renders calculated cells read-only from the live declaration and follows a property reorder', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { workbook } = inputsWorkbook();
    const apiClient = persistedWorkbookClient(workbook);
    render(<App initialWorkbook={workbook} apiClient={apiClient} />);

    fireEvent.click(cellAt('A1'));
    fireEvent.click(screen.getByRole('button', { name: 'Data models' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create model' }));
    const create = screen.getByRole('form', { name: 'Create data model' });
    fireEvent.change(within(create).getByLabelText('Model name'), { target: { value: 'Invoice' } });
    fireEvent.change(within(create).getByLabelText('Property 1 name'), { target: { value: 'Amount' } });
    fireEvent.click(within(create).getByRole('button', { name: 'Add property' }));
    fireEvent.change(within(create).getByLabelText('Property 2 name'), { target: { value: 'Tax' } });
    fireEvent.change(within(create).getByLabelText('Property 2 kind'), { target: { value: 'calculated' } });
    fireEvent.change(within(create).getByLabelText('Property 2 formula'), { target: { value: '=SUM(@A[1])' } });
    fireEvent.click(within(create).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiClient.saveModelLifecycle).toHaveBeenCalledTimes(1));

    const created = within(modelSelect()).getByRole('option', { name: 'Invoice' }) as HTMLOptionElement;
    fireEvent.change(modelSelect(), { target: { value: created.value } });
    fireEvent.click(screen.getByRole('button', { name: 'Bind model' }));

    await waitFor(() => expect(screen.getByLabelText('Bound to Invoice')).toBeInTheDocument());
    expect(cellAt('B1')).toHaveAttribute('aria-readonly', 'true');
    expect(cellAt('B1')).toHaveAccessibleName('Inputs B1 calculated, read-only; edit it in Data models cell');
    expect(cellAt('A1')).not.toHaveAttribute('aria-readonly');
    fireEvent.doubleClick(cellAt('B1'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit model' }));
    const reorder = screen.getByRole('form', { name: 'Edit data model' });
    fireEvent.click(within(reorder).getByRole('button', { name: 'Move property 2 up' }));
    fireEvent.click(within(reorder).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(columnLabels()).toEqual(['Tax', 'Amount']));
    expect(cellAt('A1')).toHaveAttribute('aria-readonly', 'true');
    expect(cellAt('B1')).not.toHaveAttribute('aria-readonly');
  });
});
