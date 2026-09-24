import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { positionedSheet, sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

describe('App grid composition', () => {
  it('wires independent sheet grids into their frames', () => {
    const inputs = positionedSheet('sheet-inputs', 'Inputs', { x: 48, y: 96 });
    const outputs = sheetDocument({ id: 'sheet-outputs', name: 'Outputs', position: { x: 420, y: 260 }, columnCount: 2, rowCount: 2 });
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    const frames = screen.getAllByTestId('sheet-frame');
    expect(within(frames[0]).getByRole('table', { name: 'Inputs grid' })).toBeInTheDocument();
    expect(within(frames[1]).getByRole('table', { name: 'Outputs grid' })).toBeInTheDocument();
    expect(within(frames[1]).getAllByTestId('sheet-grid-cell')).toHaveLength(4);
  });

  it('moves active sheet and cell focus when selecting a cell in another sheet', async () => {
    const user = userEvent.setup();
    const inputs = positionedSheet('sheet-inputs', 'Inputs', { x: 48, y: 96 });
    const outputs = positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 260 });
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    const inputFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const outputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });
    const inputsA1 = within(inputFrame).getByRole('cell', { name: 'Inputs A1 empty cell' });
    const outputsB2 = within(outputFrame).getByRole('cell', { name: 'Outputs B2 empty cell' });
    await user.click(inputsA1);
    await user.click(outputsB2);
    expect(inputFrame).not.toHaveAttribute('data-active-sheet');
    expect(outputsB2).toHaveAttribute('data-active-cell', 'true');
    expect(outputFrame).toHaveAttribute('data-active-sheet', 'true');
  });

  it('enters, revises, navigates, and cancels cells from the keyboard', async () => {
    const user = userEvent.setup();
    const inputs = sheetDocument({
      id: 'sheet-inputs', name: 'Inputs', position: { x: 48, y: 96 }, columnCount: 3, rowCount: 3,
    });
    render(<App initialWorkbook={workbookWithSheets([inputs])} />);
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const cell = (key: string) => frame.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;

    await user.click(cell('A1'));
    await user.keyboard('{ArrowRight}');
    expect(cell('B1')).toHaveAttribute('data-active-cell', 'true');

    await user.keyboard('9');
    await screen.findByRole('textbox', { name: 'Inputs B1 editor' });
    await user.keyboard('{Enter}');
    await waitFor(() => expect(cell('B1')).toHaveTextContent('9'));
    expect(cell('B2')).toHaveAttribute('data-active-cell', 'true');

    await user.keyboard('{F2}discard{Escape}');
    expect(cell('B2')).toHaveTextContent(/^$/);
    expect(screen.queryByRole('textbox', { name: 'Inputs B2 editor' })).not.toBeInTheDocument();
  });
});
