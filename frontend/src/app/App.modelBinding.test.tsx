import { activateCellEditor } from '@test-support/appScreen';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataModel } from '@workbook/core/model';
import { autosaveClient, persistedWorkbookClient } from '@test-support/apiClients';
import { openSheetContextMenu } from '@test-support/appScreen';
import { positionedSheet, sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
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
  return cellInFrame(frame(), key);
}

function cellInFrame(sheetFrame: HTMLElement, key: string) {
  const cell = sheetFrame.querySelector<HTMLElement>(`[data-cell-key="${key}"]`);
  if (!cell) throw new Error(`Missing cell ${key}`);
  return cell;
}

function columnLabels() {
  return columnLabelsFor(frame());
}

function columnLabelsFor(sheetFrame: HTMLElement) {
  return [...sheetFrame.querySelectorAll<HTMLElement>('[role="columnheader"]')]
    .filter((header) => header.getAttribute('aria-label') !== 'Grid corner')
    .map((header) => header.textContent);
}

function modelSelect() {
  openSheetContextMenu(frame());
  return screen.getByLabelText('Model for Inputs') as HTMLSelectElement;
}

describe('App model binding workflow', () => {
  it('wires an empty bound sheet entry draft to validation and retains it after a failed save', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { workbook } = inputsWorkbook();
    const initial = { ...workbook, dataModels: { invoice: declaredModel } };
    const apiClient = persistedWorkbookClient(initial);
    apiClient.admitRecord.mockRejectedValue(new Error('offline'));
    render(<App initialWorkbook={initial} apiClient={apiClient} />);

    fireEvent.click(cellAt('A1'));
    fireEvent.change(modelSelect(), { target: { value: 'invoice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bind model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm bind' }));
    await waitFor(() => expect(screen.getByLabelText('Bound to Invoice')).toBeInTheDocument());
    expect(frame()).toHaveAttribute('data-row-count', '0');
    const amount = screen.getByRole('textbox', { name: 'Amount new record' });
    const tax = screen.getByRole('textbox', { name: 'Tax new record' });
    fireEvent.change(amount, { target: { value: 'bad' } });
    expect(amount).toHaveAttribute('aria-invalid', 'false');
    fireEvent.blur(amount);
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Amount validation' }));
    expect(amount).toHaveValue('bad');
    expect(amount).toHaveClass('model-entry-invalid');
    fireEvent.keyDown(tax, { key: 'Enter' });
    await waitFor(() => expect(amount).toHaveFocus());
    expect(apiClient.admitRecord).not.toHaveBeenCalled();
    fireEvent.change(amount, { target: { value: '3' } });
    expect(amount).not.toHaveClass('model-entry-invalid');
    fireEvent.keyDown(amount, { key: 'Enter' });
    await waitFor(() => expect(apiClient.admitRecord).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry saving record' })).toBeInTheDocument());
    expect(amount).toHaveValue('3');
    expect(frame()).toHaveAttribute('data-row-count', '0');
  });

  it('persists the bounded two-sheet product workflow and leaves a cancelled destructive draft unchanged', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const first = sheetDocument({
      id: 'first', name: 'First', rowCount: 1, columnCount: 2, cells: { A1: '3' },
      presentation: { rowHeights: { 'first:row:1': 31 }, columnWidths: {} },
    });
    const second = sheetDocument({
      id: 'second', name: 'Second', rowCount: 1, columnCount: 2, cells: { A1: '7' },
      presentation: { rowHeights: {}, columnWidths: { 'second:column:1': 123 } },
    });
    const initial = workbookWithSheets([first, second]);
    const apiClient = persistedWorkbookClient(initial);
    render(<App initialWorkbook={initial} apiClient={apiClient} />);

    fireEvent.click(screen.getByRole('button', { name: 'Data models' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create model' }));
    const create = screen.getByRole('form', { name: 'Create data model' });
    fireEvent.change(within(create).getByLabelText('Model name'), { target: { value: 'Invoice' } });
    fireEvent.change(within(create).getByLabelText('Property 1 name'), { target: { value: 'Input' } });
    fireEvent.change(within(create).getByLabelText('Property 1 type'), { target: { value: 'float' } });
    fireEvent.click(within(create).getByRole('button', { name: 'Add property' }));
    fireEvent.change(within(create).getByLabelText('Property 2 name'), { target: { value: 'Output' } });
    fireEvent.change(within(create).getByLabelText('Property 2 type'), { target: { value: 'function' } });
    fireEvent.change(within(create).getByLabelText('Property 2 formula'), { target: { value: "=SUM(@'Input'[1])" } });
    fireEvent.keyDown(within(create).getByLabelText('Property 2 formula'), { key: 'Enter', ctrlKey: true });
    fireEvent.click(within(create).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiClient.saveModelLifecycle).toHaveBeenCalledTimes(1));

    const bind = async (sheetName: string) => {
      const sheet = screen.getByRole('article', { name: `Sheet ${sheetName}` });
      fireEvent.click(cellInFrame(sheet, 'A1'));
      openSheetContextMenu(sheet);
      const select = screen.getByLabelText(`Model for ${sheetName}`) as HTMLSelectElement;
      const model = within(select).getByRole('option', { name: 'Invoice' }) as HTMLOptionElement;
      fireEvent.change(select, { target: { value: model.value } });
      fireEvent.click(screen.getByRole('button', { name: 'Bind model' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm bind' }));
      await waitFor(() => expect(screen.getByLabelText('Bound to Invoice')).toBeInTheDocument());
      return sheet;
    };
    const firstFrame = await bind('First');
    const secondFrame = await bind('Second');
    expect(cellInFrame(firstFrame, 'B1')).toHaveTextContent('3');
    expect(cellInFrame(secondFrame, 'B1')).toHaveTextContent('7');
    expect(cellInFrame(firstFrame, 'A1')).toHaveStyle({ height: '31px' });
    expect(cellInFrame(secondFrame, 'A1')).toHaveStyle({ width: '123px' });

    fireEvent.click(cellInFrame(firstFrame, 'A1'));
    openSheetContextMenu(firstFrame);
    fireEvent.click(screen.getByRole('button', { name: 'Edit model' }));
    const destructiveDraft = screen.getByRole('form', { name: 'Edit data model' });
    fireEvent.click(within(destructiveDraft).getByRole('button', { name: 'Remove property 2' }));
    fireEvent.click(within(destructiveDraft).getByRole('button', { name: 'Add property' }));
    fireEvent.change(within(destructiveDraft).getByLabelText('Property 2 name'), { target: { value: 'Output' } });
    expect(within(destructiveDraft).getByText(/New replacement properties start empty/)).toBeInTheDocument();
    fireEvent.click(within(destructiveDraft).getByRole('button', { name: 'Cancel' }));
    expect(apiClient.saveModelLifecycle).toHaveBeenCalledTimes(3);
    expect(columnLabelsFor(firstFrame)).toEqual(['Input', 'Output']);
    expect(cellInFrame(firstFrame, 'B1')).toHaveTextContent('3');

    fireEvent.click(within(screen.getByRole('dialog', { name: 'Data models' })).getByRole('button', { name: 'Edit' }));
    const edit = screen.getByRole('form', { name: 'Edit data model' });
    fireEvent.change(within(edit).getByLabelText('Model name'), { target: { value: 'Receipt' } });
    fireEvent.click(within(edit).getByRole('button', { name: /SUM/ }));
    fireEvent.change(within(edit).getByLabelText('Property 2 formula'), { target: { value: "=SUM(@'Input'[1])*2" } });
    fireEvent.keyDown(within(edit).getByLabelText('Property 2 formula'), { key: 'Enter', ctrlKey: true });
    fireEvent.click(within(edit).getByRole('button', { name: 'Move property 2 up' }));
    fireEvent.click(within(edit).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(columnLabelsFor(firstFrame)).toEqual(['Output', 'Input']));
    expect(columnLabelsFor(firstFrame)).toEqual(['Output', 'Input']);
    expect(cellInFrame(firstFrame, 'A1')).toHaveTextContent('6');
    expect(cellInFrame(secondFrame, 'A1')).toHaveTextContent('14');

    const boundMenu = within(openSheetContextMenu(firstFrame));
    expect(boundMenu.queryByRole('menuitem', { name: 'Append row' })).not.toBeInTheDocument();
    expect(boundMenu.queryByRole('menuitem', { name: 'Append column' })).not.toBeInTheDocument();
    expect(apiClient.appendRow).not.toHaveBeenCalled();

    cleanup();
    render(<App apiClient={apiClient} />);
    const reloadedFirst = await screen.findByRole('article', { name: 'Sheet First' });
    const reloadedSecond = screen.getByRole('article', { name: 'Sheet Second' });
    expect(columnLabelsFor(reloadedFirst)).toEqual(['Output', 'Input']);
    expect(cellInFrame(reloadedFirst, 'A1')).toHaveTextContent('6');
    expect(cellInFrame(reloadedSecond, 'A1')).toHaveTextContent('14');
    expect(reloadedFirst).toHaveAttribute('data-row-count', '1');
    expect(cellInFrame(reloadedFirst, 'B1')).toHaveStyle({ height: '31px' });
    expect(cellInFrame(reloadedSecond, 'B1')).toHaveStyle({ width: '123px' });

    fireEvent.click(cellInFrame(reloadedFirst, 'A1'));
    openSheetContextMenu(reloadedFirst);
    fireEvent.click(screen.getByRole('button', { name: 'Unbind model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm unbind' }));
    await waitFor(() => expect(screen.queryByLabelText('Bound to Receipt')).not.toBeInTheDocument());
    activateCellEditor(cellInFrame(reloadedFirst, 'A1'));
    const editor = screen.getByRole('textbox', { name: 'First A1 editor' });
    fireEvent.change(editor, { target: { value: '9' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    await waitFor(() => expect(cellInFrame(reloadedFirst, 'A1')).toHaveTextContent('9'));
  });

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
    fireEvent.click(screen.getByRole('button', { name: 'Confirm bind' }));

    await waitFor(() => expect(screen.getByLabelText('Bound to Invoice')).toBeInTheDocument());
    await waitFor(() => expect(columnLabels()).toEqual(['Amount', 'Tax']));

    openSheetContextMenu(frame());
    fireEvent.click(screen.getByRole('button', { name: 'Edit model' }));
    const edit = screen.getByRole('form', { name: 'Edit data model' });
    expect(within(edit).getByLabelText('Model name')).toHaveValue('Invoice');
    fireEvent.change(within(edit).getByLabelText('Model name'), { target: { value: 'Receipt' } });
    fireEvent.change(within(edit).getByLabelText('Property 1 name'), { target: { value: 'Total' } });
    fireEvent.click(within(edit).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(columnLabels()).toEqual(['Total', 'Tax']));

    openSheetContextMenu(frame());
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
    fireEvent.click(screen.getByRole('button', { name: 'Confirm bind' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The data model change was not saved.'));
    expect(screen.queryByLabelText('Bound to Invoice')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bind model' })).toBeEnabled();
    expect(cellAt('A1')).toHaveAttribute('aria-selected', 'true');
  });

  it('renders calculated cells read-only from the live declaration and follows a property reorder', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const workbook = workbookWithSheets([sheetDocument({ id: 'inputs', name: 'Inputs', position: { x: 48, y: 96 }, cells: { A1: '1' } })]);
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
    fireEvent.change(within(create).getByLabelText('Property 2 type'), { target: { value: 'function' } });
    fireEvent.change(within(create).getByLabelText('Property 2 formula'), { target: { value: '=SUM(@A[1])' } });
    fireEvent.keyDown(within(create).getByLabelText('Property 2 formula'), { key: 'Enter', ctrlKey: true });
    fireEvent.click(within(create).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiClient.saveModelLifecycle).toHaveBeenCalledTimes(1));

    const created = within(modelSelect()).getByRole('option', { name: 'Invoice' }) as HTMLOptionElement;
    fireEvent.change(modelSelect(), { target: { value: created.value } });
    fireEvent.click(screen.getByRole('button', { name: 'Bind model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm bind' }));

    await waitFor(() => expect(screen.getByLabelText('Bound to Invoice')).toBeInTheDocument());
    expect(cellAt('B1')).toHaveAttribute('aria-readonly', 'true');
    expect(cellAt('B1')).toHaveAccessibleName('Inputs B1 calculated, read-only; edit it in Data models cell');
    expect(cellAt('A1')).not.toHaveAttribute('aria-readonly');
    activateCellEditor(cellAt('B1'));
    expect(cellAt('B1')).toHaveAttribute('aria-readonly', 'true');

    openSheetContextMenu(frame());
    fireEvent.click(screen.getByRole('button', { name: 'Edit model' }));
    const reorder = screen.getByRole('form', { name: 'Edit data model' });
    fireEvent.click(within(reorder).getByRole('button', { name: 'Move property 2 up' }));
    fireEvent.click(within(reorder).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(columnLabels()).toEqual(['Tax', 'Amount']));
    expect(cellAt('A1')).toHaveAttribute('aria-readonly', 'true');
    expect(cellAt('B1')).not.toHaveAttribute('aria-readonly');
  });
});
