import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DataModel } from '@workbook/core/model';
import { App } from './App';
import { sheetDocument, workbookWithLegacyFormulaFixtures } from '@test-support/workbookFactories';
import { deferred, persistedWorkbookClient } from '@test-support/apiClients';
import type { Workbook } from '@workbook/core/model';

describe('navigation palette composition', () => {
  it('restores the originating cell after confirming and escaping while persistence is pending', async () => {
    const user = userEvent.setup();
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '1' } });
    const workbook = workbookWithLegacyFormulaFixtures([sheet]);
    workbook.dataModels = { invoice: { id: 'invoice', name: 'Invoice', columns: [{ id: 'amount', name: 'Amount', kind: 'manual', type: 'float' }] } };
    const completion = deferred<Workbook>();
    const apiClient = persistedWorkbookClient(workbook);
    apiClient.saveModelLifecycle.mockReturnValue(completion.promise);
    render(<App initialWorkbook={workbook} apiClient={apiClient} />);
    const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    await user.click(cell);
    fireEvent.keyDown(cell, { ctrlKey: true, shiftKey: true, key: 'p' });
    await user.click(screen.getByRole('button', { name: /Bind model…/ }));
    await user.selectOptions(screen.getByLabelText('Model for Inputs'), 'invoice');
    await user.click(screen.getByRole('button', { name: 'Bind model' }));
    await user.click(screen.getByRole('button', { name: 'Confirm bind' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Inputs A1 cell' })).toHaveFocus();
    await act(async () => { completion.resolve(workbook); await completion.promise; });
    expect(screen.getByRole('cell', { name: 'Inputs A1 cell' })).toHaveFocus();
  });
  it('returns to the originating cell after cancellation and Escape', async () => {
    const user = userEvent.setup();
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs' });
    const workbook = workbookWithLegacyFormulaFixtures([sheet]);
    workbook.dataModels = { invoice: { id: 'invoice', name: 'Invoice', columns: [] } };
    render(<App initialWorkbook={workbook} />);
    const cell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    await user.click(cell);
    fireEvent.keyDown(cell, { ctrlKey: true, shiftKey: true, key: 'p' });
    await user.click(screen.getByRole('button', { name: /Bind model…/ }));
    await user.selectOptions(screen.getByLabelText('Model for Inputs'), 'invoice');
    await user.click(screen.getByRole('button', { name: 'Bind model' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    expect(cell).toHaveFocus();
  });
  it('opens from the visible launcher, browses sheets, and returns focus on escape', async () => {
    const user = userEvent.setup();
    const sheet = sheetDocument({ id: 'alpha', name: 'Alpha' });
    render(<App initialWorkbook={workbookWithLegacyFormulaFixtures([sheet])} />);
    const launcher = screen.getByRole('button', { name: 'Command palette' });
    await user.click(launcher);
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Go to sheet…/ }));
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    expect(launcher).toHaveFocus();
  });

  it('closes the palette for a property definition and returns to its launcher', async () => {
    const user = userEvent.setup();
    const sheet = sheetDocument({ id: 'invoice-sheet', name: 'Invoice', rowCount: 1, columnCount: 1 });
    const model: DataModel = { id: 'invoice', name: 'Invoice', columns: [{ id: 'amount', name: 'Amount', kind: 'manual', type: 'float' }] };
    const workbook = workbookWithLegacyFormulaFixtures([{ ...sheet, modelId: model.id, modelColumnBindings: { amount: 'invoice-sheet:column:1' } }]);
    workbook.dataModels = { [model.id]: model };
    render(<App initialWorkbook={workbook} />);

    await user.click(document.querySelector<HTMLElement>('[data-cell-key="A1"]')!);
    const launcher = screen.getByRole('button', { name: 'Command palette' });
    await user.click(launcher);
    await user.click(screen.getByRole('button', { name: /Go to property definition/ }));

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Edit data model' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(launcher).toHaveFocus();
  });

  it('labels cell and property usage results by scope and dependency distance', async () => {
    const user = userEvent.setup();
    const sheet = sheetDocument({ id: 'invoice-sheet', name: 'Invoice', rowCount: 1, columnCount: 2, cells: { B1: '=@A[1]' } });
    const model: DataModel = { id: 'invoice', name: 'Invoice', columns: [
      { id: 'amount', name: 'Amount', kind: 'manual', type: 'float' },
      { id: 'total', name: 'Total', kind: 'manual', type: 'float' },
    ] };
    const workbook = workbookWithLegacyFormulaFixtures([{
      ...sheet,
      modelId: model.id,
      modelColumnBindings: { amount: 'invoice-sheet:column:1', total: 'invoice-sheet:column:2' },
    }]);
    workbook.dataModels = { [model.id]: model };
    render(<App initialWorkbook={workbook} />);

    await user.click(document.querySelector<HTMLElement>('[data-cell-key="A1"]')!);
    await user.click(screen.getByRole('button', { name: 'Command palette' }));
    const search = screen.getByRole('combobox', { name: 'Command search' });
    await user.type(search, 'Find usages');
    await user.keyboard('{Enter}');

    expect(screen.getByText('Cell usages — Direct usages')).toBeInTheDocument();
    expect(screen.getByText('Model property usages: Amount — Direct usages')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Invoice: Total, row 1' })).toHaveLength(2);
    expect(screen.getByRole('combobox', { name: 'Command search' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Command search' })).toHaveFocus();
  });

  it('closes the palette after directly following its single reference', async () => {
    const user = userEvent.setup();
    const inputs = sheetDocument({ id: 'inputs', name: 'Inputs' });
    const outputs = sheetDocument({ id: 'outputs', name: 'Outputs', cells: { A1: '=@inputs!A[1]' } });
    render(<App initialWorkbook={workbookWithLegacyFormulaFixtures([inputs, outputs])} />);

    await user.click(screen.getByRole('cell', { name: 'Outputs A1 cell' }));
    await user.click(screen.getByRole('button', { name: 'Command palette' }));
    await user.click(screen.getByRole('button', { name: /Follow reference/ }));

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });

  it('returns a shortcut-opened reference chooser to its invoking cell', async () => {
    const user = userEvent.setup();
    const inputs = sheetDocument({ id: 'inputs', name: 'Inputs', rowCount: 1, columnCount: 2 });
    const outputs = sheetDocument({ id: 'outputs', name: 'Outputs', cells: { A1: '=@inputs!A[1]+@inputs!B[1]' } });
    render(<App initialWorkbook={workbookWithLegacyFormulaFixtures([inputs, outputs])} />);

    const source = screen.getByRole('cell', { name: 'Outputs A1 cell' });
    await user.click(source);
    fireEvent.keyDown(source, { altKey: true, key: 'Enter' });

    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Command search' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(source).toHaveFocus();
  });

  it('opens usages from its shortcut and rejects non-existent row numbers', async () => {
    const user = userEvent.setup();
    const sheet = sheetDocument({ id: 'invoice', name: 'Invoice', rowCount: 1, columnCount: 2, cells: { B1: '=@A[1]' } });
    render(<App initialWorkbook={workbookWithLegacyFormulaFixtures([sheet])} />);

    const source = screen.getByRole('cell', { name: /Invoice A1/ });
    await user.click(source);
    fireEvent.keyDown(source, { altKey: true, shiftKey: true, key: 'u' });
    expect(screen.getByText('Cell usages — Direct usages')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(source).toHaveFocus();

    fireEvent.keyDown(source, { altKey: true, shiftKey: true, key: 'r' });
    const row = screen.getByLabelText('Row number');
    await user.type(row, '2{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a row number from 1 to 1.');
    await user.clear(row);
    await user.type(row, '1{Enter}');
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });

  it('reports unavailable shortcut commands and shows an empty usage result', async () => {
    const user = userEvent.setup();
    const sheet = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1 });
    render(<App initialWorkbook={workbookWithLegacyFormulaFixtures([sheet])} />);

    const source = screen.getByRole('cell', { name: /Source A1/ });
    await user.click(source);
    fireEvent.keyDown(source, { altKey: true, key: 'Enter' });
    expect(screen.getByText('No resolvable reference is available.')).toBeInTheDocument();
    fireEvent.keyDown(source, { altKey: true, shiftKey: true, key: 'd' });
    expect(screen.getByText('Select a named property or property reference first.')).toBeInTheDocument();
    fireEvent.keyDown(source, { altKey: true, shiftKey: true, key: 'u' });
    expect(screen.getByText('No results')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(source).toHaveFocus();
  });

  it('opens an empty sheet through the palette without fabricating a cell selection', async () => {
    const user = userEvent.setup();
    const populated = sheetDocument({ id: 'populated', name: 'Populated' });
    const empty = sheetDocument({ id: 'empty', name: 'Empty', rowCount: 0, columnCount: 0 });
    render(<App initialWorkbook={workbookWithLegacyFormulaFixtures([populated, empty])} />);

    await user.click(screen.getByRole('button', { name: 'Command palette' }));
    await user.click(screen.getByRole('button', { name: /Go to sheet…/ }));
    await user.click(screen.getByRole('button', { name: 'Empty' }));

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: 'Empty A1 cell' })).not.toBeInTheDocument();
  });

  it('uses the first cell only until a sheet has a remembered selection', async () => {
    const user = userEvent.setup();
    const first = sheetDocument({ id: 'first', name: 'First' });
    const second = sheetDocument({ id: 'second', name: 'Second' });
    render(<App initialWorkbook={workbookWithLegacyFormulaFixtures([first, second])} />);

    await user.click(screen.getByRole('cell', { name: 'First A1 empty cell' }));
    await user.click(screen.getByRole('button', { name: 'Command palette' }));
    await user.click(screen.getByRole('button', { name: /Go to sheet…/ }));
    await user.click(screen.getByRole('button', { name: 'Second' }));
    await user.click(screen.getByRole('button', { name: 'Command palette' }));
    await user.click(screen.getByRole('button', { name: /Go to sheet…/ }));
    await user.click(screen.getByRole('button', { name: 'First' }));

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });

  it('opens the palette from its keyboard shortcut and rejects usage without a selection', async () => {
    const user = userEvent.setup();
    const empty = sheetDocument({ id: 'empty', name: 'Empty', rowCount: 0, columnCount: 0 });
    render(<App initialWorkbook={workbookWithLegacyFormulaFixtures([empty])} />);

    fireEvent.keyDown(document.body, { ctrlKey: true, shiftKey: true, key: 'p' });
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    fireEvent.keyDown(document.body, { altKey: true, shiftKey: true, key: 'u' });
    expect(screen.getByText('Select a cell or named property first.')).toBeInTheDocument();
  });

  it('offers unnamed columns when a sheet retains a deleted model binding', async () => {
    const user = userEvent.setup();
    const sheet = { ...sheetDocument({ id: 'orphaned', name: 'Orphaned' }), modelId: 'deleted-model' };
    const workbook = workbookWithLegacyFormulaFixtures([sheet]);
    workbook.dataModels = {};
    render(<App initialWorkbook={workbook} />);

    await user.click(screen.getByRole('cell', { name: 'Orphaned A1 empty cell' }));
    await user.click(screen.getByRole('button', { name: 'Command palette' }));
    await user.click(screen.getByRole('button', { name: /Go to column…/ }));
    expect(screen.getByRole('button', { name: 'A' })).toBeInTheDocument();
  });
});
