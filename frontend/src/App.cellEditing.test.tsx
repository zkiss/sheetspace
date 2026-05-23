import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { openCellEditor } from './test/appScreen';
import { positionedSheet, workbookWithSheets } from './test/workbookFactories';

afterEach(() => {
  cleanup();
});

describe('App cell editing integration', () => {
  it('commits an active edit when keyboard focus moves to another cell', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    const editedCell = within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' });
    const nextCell = within(frame).getByRole('cell', { name: 'Inputs B1 empty cell' });
    const editor = await openCellEditor(user, editedCell);
    await user.type(editor, 'Keyboard commit');
    await user.tab();

    expect(editedCell).toHaveTextContent('Keyboard commit');
    expect(nextCell).toHaveFocus();
    expect(nextCell).toHaveAttribute('data-active-cell', 'true');
  });

  it('enters edit mode for a selected cell', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const cell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    await user.click(cell);
    await user.keyboard('{Enter}');

    expect(cell).toHaveAttribute('data-editing-cell', 'true');
    expect(within(cell).getByRole('textbox', { name: 'Inputs A1 editor' })).toHaveValue('');
  });

  it('starts editing a selected cell when typing a printable character', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const cell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    await user.click(cell);
    await user.keyboard('R');

    const editor = within(cell).getByRole('textbox', { name: 'Inputs A1 editor' });
    expect(editor).toHaveValue('R');
    expect((editor as HTMLTextAreaElement).selectionStart).toBe(1);
    expect((editor as HTMLTextAreaElement).selectionEnd).toBe(1);

    await user.keyboard('egion');
    await user.keyboard('{Enter}');

    expect(cell).toHaveTextContent('Region');
  });

  it('enters edit mode for a selected cell with F2', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const cell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    await user.click(cell);
    await user.keyboard('{F2}');

    expect(cell).toHaveAttribute('data-editing-cell', 'true');
    expect(within(cell).getByRole('textbox', { name: 'Inputs A1 editor' })).toHaveValue('');
  });

  it('keeps printable-key edit entry working after arrow-key navigation', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const a1 = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    const b1 = screen.getByRole('cell', { name: 'Inputs B1 empty cell' });

    await user.click(a1);
    await user.keyboard('{ArrowRight}');
    await user.keyboard('R');

    const editor = within(b1).getByRole('textbox', { name: 'Inputs B1 editor' });
    expect(editor).toHaveValue('R');
  });

  it.each([
    ['Backspace', '{Backspace}'],
    ['Delete', '{Delete}'],
  ])('clears a selected cell with %s without entering edit mode', async (_label, keyCommand) => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: 'Remove me' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    await user.click(cell);
    await user.keyboard(keyCommand);

    expect(screen.getByRole('cell', { name: 'Inputs A1 empty cell' })).toBe(cell);
    expect(cell).not.toHaveAttribute('data-editing-cell');
    expect(cell).toHaveFocus();
  });

  it('leaves an empty selected cell empty on Backspace without entering edit mode', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const cell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    await user.click(cell);
    await user.keyboard('{Backspace}');

    expect(cell).not.toHaveAttribute('data-editing-cell');
    expect(cell).toHaveTextContent('');
    expect(cell).toHaveFocus();
  });

  it('keeps Delete and Backspace as normal text editing keys inside the cell editor', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: 'Remove me' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    const editor = await openCellEditor(user, cell);

    await user.keyboard('{Backspace}');
    expect(editor).toHaveValue('Remove m');

    (editor as HTMLTextAreaElement).setSelectionRange(0, 0);
    await user.keyboard('{Delete}');

    expect(editor).toHaveValue('emove m');
    expect(cell).toHaveAttribute('data-editing-cell', 'true');
  });

  it('commits typed text as raw cell content with Enter', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const cell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    const editor = await openCellEditor(user, cell);
    await user.type(editor, 'Region');
    await user.keyboard('{Enter}');

    expect(cell).not.toHaveAttribute('data-editing-cell');
    expect(cell).toHaveTextContent('Region');
    expect(screen.getByRole('cell', { name: 'Inputs A1 cell' })).toBe(cell);
  });

  it('commits numeric-looking values as raw cell content', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const cell = screen.getByRole('cell', { name: 'Inputs B1 empty cell' });
    const editor = await openCellEditor(user, cell);
    await user.type(editor, '42.50');
    await user.keyboard('{Enter}');

    expect(cell).toHaveTextContent('42.50');
  });

  it('commits formula-looking values as raw cell content without normalization', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const cell = screen.getByRole('cell', { name: 'Inputs C1 empty cell' });
    const editor = await openCellEditor(user, cell);
    await user.type(editor, '=SUM(B1:B2)');
    await user.keyboard('{Enter}');

    expect(cell).toHaveTextContent('0');

    const reopenedEditor = await openCellEditor(user, cell);
    expect(reopenedEditor).toHaveValue('=SUM(B1:B2)');
  });

  it('commits an active edit when selection moves within a sheet', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const editedCell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    const nextCell = screen.getByRole('cell', { name: 'Inputs B1 empty cell' });
    const editor = await openCellEditor(user, editedCell);
    await user.type(editor, 'Committed on move');
    await user.click(nextCell);

    expect(editedCell).toHaveTextContent('Committed on move');
    expect(editedCell).not.toHaveAttribute('data-editing-cell');
    expect(nextCell).toHaveAttribute('data-active-cell', 'true');
  });

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
    expect(outputFrame).toHaveAttribute('data-active-sheet', 'true');
    expect(outputCell).toHaveAttribute('data-active-cell', 'true');
  });

  it('cancels active edits with Escape and restores prior content', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: 'Original' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    const editor = await openCellEditor(user, cell);
    await user.clear(editor);
    await user.type(editor, 'Changed');
    await user.keyboard('{Escape}');

    expect(cell).not.toHaveAttribute('data-editing-cell');
    expect(cell).toHaveTextContent('Original');
  });

  it('restores cell keyboard focus after canceling an edit with Escape', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      rowCount: 1,
      columnCount: 2,
      cells: {
        A1: { raw: 'Original' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const a1 = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    const b1 = screen.getByRole('cell', { name: 'Inputs B1 empty cell' });
    const editor = await openCellEditor(user, a1);
    await user.clear(editor);
    await user.type(editor, 'Changed');
    await user.keyboard('{Escape}');

    expect(a1).not.toHaveAttribute('data-editing-cell');
    expect(a1).toHaveTextContent('Original');
    expect(a1).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(b1).toHaveAttribute('data-active-cell', 'true');
    expect(b1).toHaveFocus();

    await user.keyboard('N');
    const nextEditor = within(b1).getByRole('textbox', { name: 'Inputs B1 editor' });
    expect(nextEditor).toHaveValue('N');

    await user.keyboard('ext{Enter}');
    expect(b1).toHaveTextContent('Next');
  });

  it('commits an active edit with Tab and moves one cell to the right', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const a1 = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    const b1 = screen.getByRole('cell', { name: 'Inputs B1 empty cell' });
    const editor = await openCellEditor(user, a1);

    await user.type(editor, 'Region');
    await user.keyboard('{Tab}');

    expect(a1).toHaveTextContent('Region');
    expect(a1).not.toHaveAttribute('data-editing-cell');
    expect(b1).toHaveAttribute('data-active-cell', 'true');
    expect(b1).toHaveFocus();
  });

  it('commits an active edit with Enter and moves down in the same column without a tab run', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const b1 = screen.getByRole('cell', { name: 'Inputs B1 empty cell' });
    const b2 = screen.getByRole('cell', { name: 'Inputs B2 empty cell' });
    const editor = await openCellEditor(user, b1);

    await user.type(editor, 'Value');
    await user.keyboard('{Enter}');

    expect(b1).toHaveTextContent('Value');
    expect(b2).toHaveAttribute('data-active-cell', 'true');
    expect(b2).toHaveFocus();
  });

  it('returns to the tab-run origin column on Enter after tabbing through edits', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const a1 = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    const b1 = screen.getByRole('cell', { name: 'Inputs B1 empty cell' });
    const a2 = screen.getByRole('cell', { name: 'Inputs A2 empty cell' });
    const a1Editor = await openCellEditor(user, a1);

    await user.type(a1Editor, 'First');
    await user.keyboard('{Tab}');
    expect(b1).toHaveAttribute('data-active-cell', 'true');

    await user.keyboard('S');
    const b1Editor = within(b1).getByRole('textbox', { name: 'Inputs B1 editor' });
    await user.type(b1Editor, 'econd');
    await user.keyboard('{Enter}');

    expect(a1).toHaveTextContent('First');
    expect(b1).toHaveTextContent('Second');
    expect(a2).toHaveAttribute('data-active-cell', 'true');
    expect(a2).toHaveFocus();
  });

  it.each([
    ['text', 'Remove me'],
    ['numeric-looking', '123'],
    ['formula', '=SUM(A2:A3)'],
  ])('clears existing %s content when an empty edit is committed', async (_label, raw) => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    const editor = await openCellEditor(user, cell);
    await user.clear(editor);
    await user.keyboard('{Enter}');

    expect(cell).toHaveTextContent('');
    expect(screen.getByRole('cell', { name: 'Inputs A1 empty cell' })).toBe(cell);
  });

  it('commits an empty edit on an already-empty cell without adding visible content', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const cell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    await openCellEditor(user, cell);
    await user.keyboard('{Enter}');

    expect(cell).toHaveTextContent('');
    expect(screen.getByRole('cell', { name: 'Inputs A1 empty cell' })).toBe(cell);
  });

  it('clears a stored empty cell so it renders as an empty cell again', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: '' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    await openCellEditor(user, cell);
    await user.keyboard('{Enter}');

    expect(screen.getByRole('cell', { name: 'Inputs A1 empty cell' })).toBe(cell);
  });
});
