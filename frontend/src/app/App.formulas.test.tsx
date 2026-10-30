import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { openCellEditor } from '@test-support/appScreen';
import { positionedSheet, workbookWithSheets } from '@test-support/workbookFactories';
import { prepareCellInput } from '@application/core/cellInputPreparation';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import type { Workbook } from '@workbook/core/model';

function setFormula(workbook: Workbook, sheetId: string, formula: string): void {
  const sheet = workbook.documents[sheetId]!;
  sheet.content.cells[cellIdentityKey(cellIdentityAt(sheet.content, 'A1')!)] = prepareCellInput(formula, workbook, sheetId);
}

describe('App formula composition', () => {
  it('shows calculated values and resolved references in the shared editor', async () => {
    const user = userEvent.setup();
    const inputs = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }), cells: { A1: '3', A2: '4' } };
    const outputs = positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 80 });
    const workbook = workbookWithSheets([inputs, outputs]);
    setFormula(workbook, 'sheet-outputs', '=SUM(@Inputs!A[1]:A[2], @Missing!B[2])');
    render(<App initialWorkbook={workbook} />);
    const formulaCell = screen.getByRole('cell', { name: 'Outputs A1 cell' });
    expect(formulaCell).toHaveTextContent('#REF!');
    const editor = await openCellEditor(user, formulaCell);
    expect(editor).toHaveValue('=SUM(@Inputs!A[1]:A[2], @Missing!B[2])');
    const references = document.querySelectorAll('[data-reference-index]');
    expect([...references].map((reference) => reference.textContent)).toEqual(['@Inputs!A[1]:A[2]', '@Missing!B[2]']);
  });

  it('recomputes a visible formula after a committed cell edit', async () => {
    const user = userEvent.setup();
    const sheet = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }), cells: { B1: '1', B2: '2' } };
    const workbook = workbookWithSheets([sheet]);
    setFormula(workbook, sheet.id, '=SUM(@B[1]:B[2])');
    render(<App initialWorkbook={workbook} />);
    const formulaCell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    expect(formulaCell).toHaveTextContent('3');
    const editor = await openCellEditor(user, screen.getByRole('cell', { name: 'Inputs B2 cell' }));
    await user.clear(editor);
    await user.type(editor, '5');
    await user.keyboard('{Enter}');
    expect(formulaCell).toHaveTextContent('6');
  });
});
