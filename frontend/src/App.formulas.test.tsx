import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { openCellEditor } from './test/appScreen';
import { positionedSheet, workbookWithSheets } from '@test/workbookFactories';

describe('App formula composition', () => {
  it('shows calculated values and selected-formula inspection through the application', async () => {
    const user = userEvent.setup();
    const inputs = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }), cells: { A1: '3', A2: '4' } };
    const outputs = { ...positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 80 }), cells: { A1: '=SUM(sheet-inputs!A1:A2, sheet-missing!B2)' } };
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    const formulaCell = screen.getByRole('cell', { name: 'Outputs A1 cell' });
    expect(formulaCell).toHaveTextContent('#REF!');
    await user.click(formulaCell);
    const inspection = screen.getByRole('region', { name: 'Selected formula' });
    expect(inspection).toHaveTextContent('=SUM(Inputs!A1:A2, #REF!B2)');
    expect(within(inspection).getByLabelText('Inputs!A1:A2, reference')).toHaveAttribute('data-navigable', 'true');
    expect(within(inspection).getByLabelText('#REF!B2, broken reference')).toHaveAttribute('data-navigable', 'false');
  });

  it('recomputes a visible formula after a committed cell edit', async () => {
    const user = userEvent.setup();
    const sheet = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }), cells: { A1: '=SUM(B1:B2)', B1: '1', B2: '2' } };
    render(<App initialWorkbook={workbookWithSheets([sheet])} />);
    const formulaCell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    expect(formulaCell).toHaveTextContent('3');
    const editor = await openCellEditor(user, screen.getByRole('cell', { name: 'Inputs B2 cell' }));
    await user.clear(editor);
    await user.type(editor, '5');
    await user.keyboard('{Enter}');
    expect(formulaCell).toHaveTextContent('6');
  });
});
