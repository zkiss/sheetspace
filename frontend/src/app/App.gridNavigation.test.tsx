import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { autosaveClient } from '@test-support/apiClients';
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

  it('enters, revises, navigates, cancels, and commits across sheets from the keyboard', async () => {
    const user = userEvent.setup();
    const inputs = sheetDocument({
      id: 'sheet-inputs',
      name: 'Inputs',
      position: { x: 48, y: 96 },
      columnCount: 3,
      rowCount: 3,
      cells: { B1: 'seed' },
    });
    const outputs = sheetDocument({
      id: 'sheet-outputs', name: 'Outputs', position: { x: 420, y: 260 }, columnCount: 2, rowCount: 2,
    });
    const apiClient = autosaveClient();
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} apiClient={apiClient} />);
    const inputFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const outputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });
    const inputCell = (key: string) => inputFrame.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;
    const outputCell = (key: string) => outputFrame.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;
    const undo = screen.getByRole('button', { name: 'Undo' });
    const redo = screen.getByRole('button', { name: 'Redo' });

    await user.click(inputCell('A1'));
    await user.keyboard('{ArrowRight}');
    expect(inputCell('B1')).toHaveAttribute('data-active-cell', 'true');

    await user.keyboard('{F2}{End} revised{Enter}');
    await waitFor(() => expect(inputCell('B1')).toHaveTextContent('seed revised'));
    expect(inputCell('B2')).toHaveAttribute('data-active-cell', 'true');

    await user.keyboard('entered');
    const editor = await screen.findByRole('textbox', { name: 'Inputs B2 editor' });
    await user.keyboard('{Control>}{ArrowLeft}{/Control}');
    expect(editor).toHaveFocus();
    expect(inputCell('B2')).toHaveAttribute('data-editing-cell', 'true');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(inputCell('B2')).toHaveTextContent('entered'));
    expect(inputCell('B3')).toHaveAttribute('data-active-cell', 'true');
    expect(undo).toBeEnabled();
    expect(redo).toBeDisabled();

    await user.keyboard('{ArrowLeft}');
    expect(inputCell('A3')).toHaveAttribute('data-active-cell', 'true');
    expect(undo).toBeEnabled();
    expect(redo).toBeDisabled();

    await user.keyboard('{F2}discard{Escape}');
    expect(inputCell('A3')).toHaveTextContent(/^$/);
    expect(screen.queryByRole('textbox', { name: 'Inputs A3 editor' })).not.toBeInTheDocument();
    expect(apiClient.writeCells).toHaveBeenCalledTimes(2);

    await user.keyboard('{F2}Cross-sheet draft');
    await user.click(outputCell('A1'));
    await waitFor(() => expect(inputCell('A3')).toHaveTextContent('Cross-sheet draft'));
    await waitFor(() => expect(apiClient.writeCells).toHaveBeenCalledTimes(3));
    expect(apiClient.writeCells.mock.calls[2]?.[1]).toHaveLength(1);
    expect(apiClient.writeCells.mock.calls[2]?.[1]?.[0]).toMatchObject({ raw: 'Cross-sheet draft' });
    expect(outputCell('A1')).toHaveAttribute('data-active-cell', 'true');
    expect(outputFrame).toHaveAttribute('data-active-sheet', 'true');
  });
});
