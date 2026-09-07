import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';
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
});
