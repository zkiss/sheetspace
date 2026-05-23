import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { openCellEditor, openSheetContextMenu } from './test/appScreen';
import { positionedSheet, workbookWithSheets } from './test/workbookFactories';

afterEach(() => {
  cleanup();
});

describe('App formula integration', () => {
  it('displays mixed-case spaced multiline formulas while preserving raw edit text', async () => {
    const user = userEvent.setup();
    const rawFormula = '= \n sUm \t ( \n B1 \n : \t B2 \n ) ';
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: rawFormula },
        B1: { raw: '3' },
        B2: { raw: '4' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const formulaCell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    expect(formulaCell).toHaveTextContent('7');

    const editor = await openCellEditor(user, formulaCell);
    expect(editor).toHaveValue(rawFormula);
  });

  it('displays cross-sheet formula results outside edit mode', async () => {
    const inputs = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: '2' },
        A2: { raw: '5' },
      },
    };
    const outputs = {
      ...positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 80 }),
      cells: {
        A1: { raw: '=SUM(Inputs!A1:A2)' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);

    const outputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });
    expect(within(outputFrame).getByRole('cell', { name: 'Outputs A1 cell' })).toHaveTextContent('7');
  });

  it('keeps formula error cells selectable and editable without crashing unrelated results', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: '=SUM(B1)' },
        A2: { raw: '=SUM(B1,)' },
        B1: { raw: '8' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const validFormulaCell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    const errorCell = screen.getByRole('cell', { name: 'Inputs A2 cell' });
    expect(validFormulaCell).toHaveTextContent('8');
    expect(errorCell).toHaveTextContent('#PARSE!');

    await user.click(errorCell);
    expect(errorCell).toHaveAttribute('data-active-cell', 'true');

    const editor = await openCellEditor(user, errorCell);
    expect(editor).toHaveValue('=SUM(B1,)');

    await user.clear(editor);
    await user.type(editor, '=SUM(B1)');
    await user.keyboard('{Enter}');

    expect(errorCell).toHaveTextContent('8');
  });

  it('displays formula results and recomputes after referenced cell edits', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: '=SUM(B1:B2)' },
        B1: { raw: '1' },
        B2: { raw: '2' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const formulaCell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    expect(formulaCell).toHaveTextContent('3');

    const b2 = screen.getByRole('cell', { name: 'Inputs B2 cell' });
    const editor = await openCellEditor(user, b2);
    await user.clear(editor);
    await user.type(editor, '5');
    await user.keyboard('{Enter}');

    expect(formulaCell).toHaveTextContent('6');
  });

  it('keeps uncommitted edit text out of formula recomputation until commit', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: '=SUM(B1)' },
        B1: { raw: '1' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const formulaCell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    const inputCell = screen.getByRole('cell', { name: 'Inputs B1 cell' });
    expect(formulaCell).toHaveTextContent('1');

    const editor = await openCellEditor(user, inputCell);
    await user.clear(editor);
    await user.type(editor, '9');

    expect(editor).toHaveValue('9');
    expect(formulaCell).toHaveTextContent('1');

    await user.keyboard('{Enter}');
    expect(formulaCell).toHaveTextContent('9');
  });

  it('recomputes formula edits and removes formula display after editing back to plain content', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: '=SUM(B1)' },
        B1: { raw: '2' },
        C1: { raw: '4' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const formulaCell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    expect(formulaCell).toHaveTextContent('2');

    const formulaEditor = await openCellEditor(user, formulaCell);
    await user.clear(formulaEditor);
    await user.type(formulaEditor, '=SUM(C1)');
    await user.keyboard('{Enter}');

    expect(formulaCell).toHaveTextContent('4');

    const plainEditor = await openCellEditor(user, formulaCell);
    await user.clear(plainEditor);
    await user.type(plainEditor, 'Plain text');
    await user.keyboard('{Enter}');

    expect(formulaCell).toHaveTextContent('Plain text');
    expect(await openCellEditor(user, formulaCell)).toHaveValue('Plain text');
  });

  it('recomputes formula references that become valid after appending a row', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      rowCount: 2,
      columnCount: 2,
      cells: {
        A1: { raw: '=SUM(A3)' },
        A2: { raw: '=SUM(K1)' },
        A3: { raw: '7' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const formulaCell = within(frame).getByRole('cell', { name: 'Inputs A1 cell' });
    const persistentErrorCell = within(frame).getByRole('cell', { name: 'Inputs A2 cell' });

    expect(formulaCell).toHaveTextContent('#REF!');
    expect(persistentErrorCell).toHaveTextContent('#REF!');

    await user.click(within(openSheetContextMenu(frame)).getByRole('menuitem', { name: 'Append row' }));

    expect(formulaCell).toHaveTextContent('7');
    expect(persistentErrorCell).toHaveTextContent('#REF!');

    const editor = await openCellEditor(user, persistentErrorCell);
    expect(editor).toHaveValue('=SUM(K1)');
  });

  it('recomputes formula references that become valid after appending a column', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      rowCount: 2,
      columnCount: 2,
      cells: {
        A1: { raw: '=SUM(C1)' },
        B1: { raw: '=SUM(A99)' },
        C1: { raw: '11' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const formulaCell = within(frame).getByRole('cell', { name: 'Inputs A1 cell' });
    const persistentErrorCell = within(frame).getByRole('cell', { name: 'Inputs B1 cell' });

    expect(formulaCell).toHaveTextContent('#REF!');
    expect(persistentErrorCell).toHaveTextContent('#REF!');

    await user.click(within(openSheetContextMenu(frame)).getByRole('menuitem', { name: 'Append column' }));

    expect(formulaCell).toHaveTextContent('11');
    expect(persistentErrorCell).toHaveTextContent('#REF!');

    const editor = await openCellEditor(user, persistentErrorCell);
    expect(editor).toHaveValue('=SUM(A99)');
  });

});
