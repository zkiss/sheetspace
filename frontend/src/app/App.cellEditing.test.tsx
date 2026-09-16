import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { autosaveClient, persistedWorkbookClient } from '@test-support/apiClients';
import { openCellEditor } from '@test-support/appScreen';
import { positionedSheet, workbookWithSheets } from '@test-support/workbookFactories';

describe('App cell editing composition', () => {
  it('commits an active edit when selection moves to another sheet', async () => {
    const user = userEvent.setup();
    const inputs = positionedSheet('sheet-inputs', 'Inputs', { x: 48, y: 96 });
    const outputs = positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 260 });
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    const inputFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const outputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });
    const editedCell = within(inputFrame).getByRole('cell', { name: 'Inputs A1 empty cell' });
    const outputCell = within(outputFrame).getByRole('cell', { name: 'Outputs A1 empty cell' });
    const editor = await openCellEditor(user, editedCell);
    await user.type(editor, 'Cross-sheet commit');
    await user.click(outputCell);
    expect(editedCell).toHaveTextContent('Cross-sheet commit');
    expect(outputCell).toHaveAttribute('data-active-cell', 'true');
    expect(outputFrame).toHaveAttribute('data-active-sheet', 'true');
  });

  it('clears a reversed mixed range with Delete in one saved transaction, recalculates, and reloads', async () => {
    const user = userEvent.setup();
    const inputs = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 48, y: 96 }),
      cells: { A1: '2', B1: '=A1 * 3', B2: '7', C1: '=SUM(A1:B2)' },
    };
    const apiClient = persistedWorkbookClient(workbookWithSheets([inputs]));
    const view = render(<App initialWorkbook={workbookWithSheets([inputs])} apiClient={apiClient} />);
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const cell = (key: string) => frame.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;

    await user.click(cell('B2'));
    await user.keyboard('{Shift>}');
    await user.click(cell('A1'));
    await user.keyboard('{/Shift}');
    await user.keyboard('{Delete}');

    await waitFor(() => expect(apiClient.writeCells).toHaveBeenCalledTimes(1));
    expect(apiClient.writeCells.mock.calls[0]?.[1]).toHaveLength(3);
    expect(cell('A1')).toHaveTextContent(/^$/);
    expect(cell('B1')).toHaveTextContent(/^$/);
    expect(cell('B2')).toHaveTextContent(/^$/);
    expect(cell('C1')).toHaveTextContent('0');

    view.unmount();
    render(<App apiClient={apiClient} />);
    const reloaded = await screen.findByRole('article', { name: 'Sheet Inputs' });
    expect(reloaded.querySelector('[data-cell-key="C1"]')).toHaveTextContent('0');
    expect(apiClient.loadWorkbook).toHaveBeenCalledTimes(1);
  });

  it.each([
    { key: '{Backspace}', mode: 'rowheader', header: '1', cleared: ['A1', 'B1'] },
    { key: '{Backspace}', mode: 'columnheader', header: 'A', cleared: ['A1', 'A2'] },
  ])('clears a selected $mode with Backspace while omitting blank cells', async ({ key, mode, header, cleared }) => {
    const user = userEvent.setup();
    const inputs = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 48, y: 96 }),
      cells: { A1: '1', B1: '=A1 * 2', A2: '3', B2: '4' },
    };
    const apiClient = persistedWorkbookClient(workbookWithSheets([inputs]));
    render(<App initialWorkbook={workbookWithSheets([inputs])} apiClient={apiClient} />);
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });

    const axis = within(frame).getAllByRole(mode).find((element) => element.textContent?.trim().startsWith(header));
    if (!axis) throw new Error(`Missing ${mode} ${header}`);
    await user.click(axis);
    await user.keyboard(key);

    await waitFor(() => expect(apiClient.writeCells).toHaveBeenCalledTimes(1));
    expect(apiClient.writeCells.mock.calls[0]?.[1]).toHaveLength(2);
    for (const address of cleared) expect(frame.querySelector(`[data-cell-key="${address}"]`)).toHaveTextContent(/^$/);
  });

  it('leaves a blank selection unsaved and preserves native editor deletion', async () => {
    const user = userEvent.setup();
    const inputs = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 48, y: 96 }),
      cells: { A1: 'Retained', B1: 'Other' },
    };
    const apiClient = autosaveClient();
    render(<App initialWorkbook={workbookWithSheets([inputs])} apiClient={apiClient} />);
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const a1 = within(frame).getByRole('cell', { name: 'Inputs A1 cell' });
    const b2 = within(frame).getByRole('cell', { name: 'Inputs B2 empty cell' });

    const editor = await openCellEditor(user, a1);
    await user.keyboard('{Backspace}');
    expect(editor).toHaveValue('Retaine');
    await user.keyboard('{Escape}');

    await user.click(b2);
    await user.keyboard('{Delete}');
    expect(apiClient.writeCells).not.toHaveBeenCalled();
  });
});
