import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DataModel } from '@workbook/core/model';
import { App } from './App';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

describe('navigation palette composition', () => {
  it('opens from the visible launcher, browses sheets, and returns focus on escape', async () => {
    const user = userEvent.setup();
    const sheet = sheetDocument({ id: 'alpha', name: 'Alpha' });
    render(<App initialWorkbook={workbookWithSheets([sheet])} />);
    const launcher = screen.getByRole('button', { name: 'Command palette' });
    await user.click(launcher);
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to sheet: Alpha' })).toBeInTheDocument();
    expect(screen.getByText('Go to property…').closest('button')).toBeDisabled();
    expect(screen.getByText('The current sheet has no named columns')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    expect(launcher).toHaveFocus();
  });

  it('closes the palette for a property definition and returns to its launcher', async () => {
    const user = userEvent.setup();
    const sheet = sheetDocument({ id: 'invoice-sheet', name: 'Invoice', rowCount: 1, columnCount: 1 });
    const model: DataModel = { id: 'invoice', name: 'Invoice', columns: [{ id: 'amount', name: 'Amount', kind: 'manual', type: 'float' }] };
    const workbook = workbookWithSheets([{ ...sheet, modelId: model.id, modelColumnBindings: { amount: 'invoice-sheet:column:1' } }]);
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
    const workbook = workbookWithSheets([{
      ...sheet,
      modelId: model.id,
      modelColumnBindings: { amount: 'invoice-sheet:column:1', total: 'invoice-sheet:column:2' },
    }]);
    workbook.dataModels = { [model.id]: model };
    render(<App initialWorkbook={workbook} />);

    await user.click(document.querySelector<HTMLElement>('[data-cell-key="A1"]')!);
    await user.click(screen.getByRole('button', { name: 'Command palette' }));
    await user.click(screen.getByRole('button', { name: /Find usages/ }));

    expect(screen.getByText('Cell usages — Direct usages')).toBeInTheDocument();
    expect(screen.getByText('Model property usages: Amount — Direct usages')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Invoice: Total, row 1' })).toHaveLength(2);
  });

  it('closes the palette after directly following its single reference', async () => {
    const user = userEvent.setup();
    const inputs = sheetDocument({ id: 'inputs', name: 'Inputs' });
    const outputs = sheetDocument({ id: 'outputs', name: 'Outputs', cells: { A1: '=@inputs!A[1]' } });
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);

    await user.click(screen.getByRole('cell', { name: 'Outputs A1 cell' }));
    await user.click(screen.getByRole('button', { name: 'Command palette' }));
    await user.click(screen.getByRole('button', { name: /Follow reference/ }));

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });
});
