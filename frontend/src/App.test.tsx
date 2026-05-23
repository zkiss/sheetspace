import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import {
  createSheetFromToolbar,
  openCellEditor,
  openSheetContextMenu,
} from './test/appScreen';
import { testRect } from './test/domGeometry';
import { positionedSheet, workbookWithSheets } from './test/workbookFactories';

afterEach(() => {
  cleanup();
});

describe('App workspace', () => {
  it('renders new sheets as default 10-column by 20-row grids without stored cells', () => {
    const sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 });

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const frame = screen.getByTestId('sheet-frame');
    expect(frame).toHaveAttribute('data-column-count', '10');
    expect(frame).toHaveAttribute('data-row-count', '20');
    expect(sheet.cells).toEqual({});
    expect(within(frame).getAllByRole('columnheader')).toHaveLength(11);
    expect(within(frame).getAllByRole('rowheader')).toHaveLength(20);
    expect(within(frame).getAllByTestId('sheet-grid-cell')).toHaveLength(200);
  });

  it('renders spreadsheet row numbers and Excel-style column labels beyond Z', () => {
    const sheet = {
      ...positionedSheet('sheet-wide', 'Wide Sheet', { x: 0, y: 0 }),
      columnCount: 28,
      rowCount: 3,
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const grid = screen.getByRole('table', { name: 'Wide Sheet grid' });
    expect(within(grid).getByRole('columnheader', { name: 'A' })).toBeInTheDocument();
    expect(within(grid).getByRole('columnheader', { name: 'Z' })).toBeInTheDocument();
    expect(within(grid).getByRole('columnheader', { name: 'AA' })).toBeInTheDocument();
    expect(within(grid).getByRole('columnheader', { name: 'AB' })).toBeInTheDocument();
    expect(within(grid).getByRole('rowheader', { name: '1' })).toBeInTheDocument();
    expect(within(grid).getByRole('rowheader', { name: '3' })).toBeInTheDocument();
  });

  it('renders empty cells as visible addressable cells', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    const a1 = within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' });
    const j20 = within(frame).getByRole('cell', { name: 'Inputs J20 empty cell' });

    expect(a1).toHaveAttribute('data-cell-key', 'A1');
    expect(a1).toHaveTextContent('');
    expect(j20).toHaveAttribute('data-cell-key', 'J20');
    expect(j20).toHaveTextContent('');
  });

  it('selects a single cell and visibly marks it as active', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    const a1 = within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' });

    await user.click(a1);

    expect(frame).toHaveAttribute('data-active-sheet', 'true');
    expect(a1).toHaveAttribute('data-active-cell', 'true');
    expect(a1).toHaveClass('sheet-grid-cell-active');
  });

  it('moves single-cell selection within a sheet', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    const a1 = within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' });
    const b2 = within(frame).getByRole('cell', { name: 'Inputs B2 empty cell' });

    await user.click(a1);
    await user.click(b2);

    expect(a1).not.toHaveAttribute('data-active-cell');
    expect(b2).toHaveAttribute('data-active-cell', 'true');
    expect(within(frame).getAllByTestId('sheet-grid-cell').filter((cell) => cell.dataset.activeCell)).toHaveLength(
      1,
    );
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
    expect(inputsA1).not.toHaveAttribute('data-active-cell');
    expect(outputFrame).toHaveAttribute('data-active-sheet', 'true');
    expect(outputsB2).toHaveAttribute('data-active-cell', 'true');
  });

  it('moves selected cells with arrow keys and clamps at sheet bounds', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      rowCount: 2,
      columnCount: 2,
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const frame = screen.getByTestId('sheet-frame');
    const a1 = within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' });
    const b1 = within(frame).getByRole('cell', { name: 'Inputs B1 empty cell' });
    const a2 = within(frame).getByRole('cell', { name: 'Inputs A2 empty cell' });
    const b2 = within(frame).getByRole('cell', { name: 'Inputs B2 empty cell' });

    await user.click(a1);
    await user.keyboard('{ArrowRight}');
    expect(b1).toHaveAttribute('data-active-cell', 'true');
    expect(b1).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(b2).toHaveAttribute('data-active-cell', 'true');

    await user.keyboard('{ArrowLeft}');
    expect(a2).toHaveAttribute('data-active-cell', 'true');

    await user.keyboard('{ArrowUp}');
    expect(a1).toHaveAttribute('data-active-cell', 'true');

    await user.keyboard('{ArrowLeft}{ArrowUp}');
    expect(a1).toHaveAttribute('data-active-cell', 'true');
  });

  it('scrolls the selected cell into view after keyboard navigation', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    try {
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
      scrollIntoView.mockClear();
      await user.keyboard('{ArrowRight}');

      expect(b1).toHaveAttribute('data-active-cell', 'true');
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it('keeps keyboard-navigated cells fully visible outside sticky headers', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    Element.prototype.getBoundingClientRect = function getMockRect() {
      if (this.classList.contains('sheet-frame-body')) {
        return testRect({ left: 0, top: 0, width: 220, height: 140 });
      }

      if (this.classList.contains('sheet-grid-column-header')) {
        return testRect({ left: 40, top: 0, width: 76, height: 24 });
      }

      if (this.classList.contains('sheet-grid-row-header')) {
        return testRect({ left: 0, top: 24, width: 40, height: 24 });
      }

      if ((this as HTMLElement).dataset.cellKey === 'B1') {
        return testRect({ left: 80, top: 10, width: 76, height: 24 });
      }

      if ((this as HTMLElement).dataset.cellKey === 'A1') {
        return testRect({ left: 20, top: 10, width: 76, height: 24 });
      }

      return testRect({ left: 80, top: 48, width: 76, height: 24 });
    };

    try {
      render(
        <App
          initialWorkbook={workbookWithSheets([
            {
              ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
              rowCount: 2,
              columnCount: 2,
            },
          ])}
        />,
      );

      const frame = screen.getByTestId('sheet-frame');
      const frameBody = within(frame).getByTestId('sheet-frame-body');
      const b2 = within(frame).getByRole('cell', { name: 'Inputs B2 empty cell' });
      const b1 = within(frame).getByRole('cell', { name: 'Inputs B1 empty cell' });
      const a1 = within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' });

      await user.click(b2);
      frameBody.scrollTop = 100;
      frameBody.scrollLeft = 100;

      await user.keyboard('{ArrowUp}');

      expect(b1).toHaveAttribute('data-active-cell', 'true');
      expect(frameBody.scrollTop).toBe(86);
      expect(frameBody.scrollLeft).toBe(100);

      await user.keyboard('{ArrowLeft}');

      expect(a1).toHaveAttribute('data-active-cell', 'true');
      expect(frameBody.scrollTop).toBe(72);
      expect(frameBody.scrollLeft).toBe(80);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });

  it('moves active selection when keyboard focus moves to another cell', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    const a1 = within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' });
    const b1 = within(frame).getByRole('cell', { name: 'Inputs B1 empty cell' });

    fireEvent.focus(a1);
    expect(a1).toHaveAttribute('data-active-cell', 'true');

    fireEvent.focus(b1);
    expect(a1).not.toHaveAttribute('data-active-cell');
    expect(b1).toHaveAttribute('data-active-cell', 'true');
  });

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

  it('selects empty, text, numeric-looking, and formula cells through the same cell path', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: 'Region' },
        B1: { raw: '42' },
        C1: { raw: '=SUM(B1:B2)' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const frame = screen.getByTestId('sheet-frame');
    const cells = [
      within(frame).getByRole('cell', { name: 'Inputs A1 cell' }),
      within(frame).getByRole('cell', { name: 'Inputs B1 cell' }),
      within(frame).getByRole('cell', { name: 'Inputs C1 cell' }),
      within(frame).getByRole('cell', { name: 'Inputs D1 empty cell' }),
    ];

    for (const cell of cells) {
      await user.click(cell);
      expect(cell).toHaveAttribute('data-active-cell', 'true');
    }

    expect(within(frame).getAllByTestId('sheet-grid-cell').filter((cell) => cell.dataset.activeCell)).toHaveLength(
      1,
    );
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

  it('renders multiple sheet grids independently inside their frames', () => {
    const first = positionedSheet('sheet-inputs', 'Inputs', { x: 48, y: 96 });
    const second = {
      ...positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 260 }),
      columnCount: 2,
      rowCount: 2,
    };

    render(<App initialWorkbook={workbookWithSheets([first, second])} />);

    const frames = screen.getAllByTestId('sheet-frame');
    expect(within(frames[0]).getByRole('table', { name: 'Inputs grid' })).toBeInTheDocument();
    expect(within(frames[0]).getAllByTestId('sheet-grid-cell')).toHaveLength(200);
    expect(within(frames[1]).getByRole('table', { name: 'Outputs grid' })).toBeInTheDocument();
    expect(within(frames[1]).getAllByTestId('sheet-grid-cell')).toHaveLength(4);
    expect(within(frames[1]).queryByRole('cell', { name: 'Outputs C1 empty cell' })).not.toBeInTheDocument();
  });

  it('appends a row at the end of one sheet and preserves existing cell content', async () => {
    const user = userEvent.setup();
    const inputs = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 48, y: 96 }),
      rowCount: 2,
      columnCount: 2,
    };
    const outputs = {
      ...positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 260 }),
      rowCount: 2,
      columnCount: 2,
    };

    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);

    const inputFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const outputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });

    const existingCell = within(inputFrame).getByRole('cell', { name: 'Inputs A1 empty cell' });
    const editor = await openCellEditor(user, existingCell);
    await user.type(editor, 'Existing');
    await user.keyboard('{Enter}');
    await user.click(within(openSheetContextMenu(inputFrame)).getByRole('menuitem', { name: 'Append row' }));

    expect(inputFrame).toHaveAttribute('data-row-count', '3');
    expect(within(inputFrame).getByRole('rowheader', { name: '3' })).toBeInTheDocument();
    expect(within(inputFrame).getByRole('cell', { name: 'Inputs A1 cell' })).toHaveTextContent('Existing');
    expect(within(inputFrame).getByRole('cell', { name: 'Inputs B3 empty cell' })).toBeInTheDocument();
    expect(outputFrame).toHaveAttribute('data-row-count', '2');
    expect(within(outputFrame).queryByRole('rowheader', { name: '3' })).not.toBeInTheDocument();
  });

  it('appends a column at the end of one sheet and updates labels beyond Z', async () => {
    const user = userEvent.setup();
    const wide = {
      ...positionedSheet('sheet-wide', 'Wide Sheet', { x: 48, y: 96 }),
      rowCount: 2,
      columnCount: 26,
    };
    const compact = {
      ...positionedSheet('sheet-compact', 'Compact', { x: 420, y: 260 }),
      rowCount: 2,
      columnCount: 2,
    };

    render(<App initialWorkbook={workbookWithSheets([wide, compact])} />);

    const wideFrame = screen.getByRole('article', { name: 'Sheet Wide Sheet' });
    const compactFrame = screen.getByRole('article', { name: 'Sheet Compact' });

    const edgeCell = within(wideFrame).getByRole('cell', { name: 'Wide Sheet Z1 empty cell' });
    const editor = await openCellEditor(user, edgeCell);
    await user.type(editor, 'Edge');
    await user.keyboard('{Enter}');
    await user.click(within(openSheetContextMenu(wideFrame)).getByRole('menuitem', { name: 'Append column' }));

    expect(wideFrame).toHaveAttribute('data-column-count', '27');
    expect(within(wideFrame).getByRole('columnheader', { name: 'AA' })).toBeInTheDocument();
    expect(within(wideFrame).getByRole('cell', { name: 'Wide Sheet Z1 cell' })).toHaveTextContent('Edge');
    expect(within(wideFrame).getByRole('cell', { name: 'Wide Sheet AA2 empty cell' })).toBeInTheDocument();
    expect(compactFrame).toHaveAttribute('data-column-count', '2');
    expect(within(compactFrame).queryByRole('columnheader', { name: 'C' })).not.toBeInTheDocument();
  });

  it('creates a named sheet from the toolbar', async () => {
    const user = userEvent.setup();
    render(<App initialWorkbook={workbookWithSheets([])} />);

    await user.click(screen.getByRole('button', { name: /new sheet/i }));
    expect(screen.getByRole('form', { name: /create sheet/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/sheet name/i), 'Inputs');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    const frame = screen.getByTestId('sheet-frame');
    expect(within(frame).getByRole('heading', { name: 'Inputs' })).toBeInTheDocument();
    expect(frame).toHaveAttribute('data-sheet-id', 'sheet-1');
    expect(frame).toHaveAttribute('data-column-count', '10');
    expect(frame).toHaveAttribute('data-row-count', '20');
    expect(screen.queryByText(/right-click the workspace/i)).not.toBeInTheDocument();
    expect(screen.getByText('1 sheets')).toBeInTheDocument();
  });

  it('rejects empty sheet names without adding a sheet', async () => {
    const user = userEvent.setup();
    render(<App initialWorkbook={workbookWithSheets([])} />);

    await user.click(screen.getByRole('button', { name: /new sheet/i }));
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    expect(screen.getByRole('alert')).toHaveTextContent('Sheet name is required.');
    expect(screen.queryByTestId('sheet-frame')).not.toBeInTheDocument();
    expect(screen.getByText('0 sheets')).toBeInTheDocument();
  });

  it('rejects duplicate sheet names without adding another sheet', async () => {
    render(<App initialWorkbook={workbookWithSheets([])} />);

    await createSheetFromToolbar('Inputs');
    await createSheetFromToolbar('Inputs');

    expect(screen.getByRole('alert')).toHaveTextContent('A sheet with that name already exists.');
    expect(screen.getAllByTestId('sheet-frame')).toHaveLength(1);
    expect(screen.getByText('1 sheets')).toBeInTheDocument();
  });

  it('creates multiple sheets with stable ids and distinguishable names', async () => {
    render(<App initialWorkbook={workbookWithSheets([])} />);

    await createSheetFromToolbar('Inputs');
    await createSheetFromToolbar('Outputs');

    const frames = screen.getAllByTestId('sheet-frame');
    expect(frames).toHaveLength(2);
    expect(frames[0]).toHaveAttribute('data-sheet-id', 'sheet-1');
    expect(frames[1]).toHaveAttribute('data-sheet-id', 'sheet-2');
    expect(within(frames[0]).getByRole('heading', { name: 'Inputs' })).toBeInTheDocument();
    expect(within(frames[1]).getByRole('heading', { name: 'Outputs' })).toBeInTheDocument();
    expect(screen.getByText('2 sheets')).toBeInTheDocument();
  });

  it('renames an existing sheet and preserves raw formula text', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: '=SUM(Old Name!A1)' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const frame = screen.getByTestId('sheet-frame');
    await user.click(within(openSheetContextMenu(frame)).getByRole('menuitem', { name: 'Rename' }));
    expect(screen.getByRole('form', { name: /rename sheet/i })).toBeInTheDocument();

    const input = screen.getByLabelText(/sheet name/i);
    await user.clear(input);
    await user.type(input, '  Renamed Inputs  ');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const renamedFrame = screen.getByRole('article', { name: 'Sheet Renamed Inputs' });
    expect(within(renamedFrame).getByRole('heading', { name: 'Renamed Inputs' })).toBeInTheDocument();
    expect(within(renamedFrame).getByRole('table', { name: 'Renamed Inputs grid' })).toBeInTheDocument();
    const formulaCell = within(renamedFrame).getByRole('cell', { name: 'Renamed Inputs A1 cell' });
    expect(formulaCell).toHaveTextContent('#REF!');

    const editor = await openCellEditor(user, formulaCell);
    expect(editor).toHaveValue('=SUM(Old Name!A1)');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('heading', { name: 'Inputs' })).not.toBeInTheDocument();
  });

  it('rejects empty sheet renames and keeps the old name active', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    await user.click(within(openSheetContextMenu(frame)).getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByLabelText(/sheet name/i);
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(screen.getByRole('alert')).toHaveTextContent('Sheet name is required.');
    expect(screen.getByRole('article', { name: 'Sheet Inputs' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Sheet Renamed Inputs' })).not.toBeInTheDocument();
  });

  it('rejects duplicate sheet renames and keeps the old name active', async () => {
    const user = userEvent.setup();
    const inputs = positionedSheet('sheet-inputs', 'Inputs', { x: 48, y: 96 });
    const outputs = positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 260 });

    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);

    const outputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });
    await user.click(within(openSheetContextMenu(outputFrame)).getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByLabelText(/sheet name/i);
    await user.clear(input);
    await user.type(input, 'Inputs');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(screen.getByRole('alert')).toHaveTextContent('A sheet with that name already exists.');
    expect(screen.getByRole('article', { name: 'Sheet Inputs' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Sheet Outputs' })).toBeInTheDocument();
    expect(screen.queryAllByRole('article', { name: 'Sheet Inputs' })).toHaveLength(1);
  });
});
