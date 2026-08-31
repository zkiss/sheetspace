import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { testRect, virtualGridGeometry } from './test/domGeometry';
import { positionedSheet, sheetDocument, sparseLargeSheetDocument, workbookWithSheets } from './test/workbookFactories';

function columnLabel(index: number) {
  let label = '';
  let value = index;
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

describe('App grid rendering and navigation', () => {
  it('renders new sheets as default 10-column by 20-row grids without stored cells', () => {
    const sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 });

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const frame = screen.getByTestId('sheet-frame');
    const grid = within(frame).getByRole('table', { name: 'Inputs grid' });
    expect(frame).toHaveAttribute('data-column-count', '10');
    expect(frame).toHaveAttribute('data-row-count', '20');
    expect(sheet.content.cells).toEqual({});
    expect(within(frame).getAllByRole('columnheader')).toHaveLength(11);
    expect(within(frame).getAllByRole('rowheader')).toHaveLength(20);
    expect(within(frame).getAllByTestId('sheet-grid-cell')).toHaveLength(200);
    expect(grid.style.getPropertyValue('--grid-cell-height')).toBe('1.65rem');
    expect(grid.style.getPropertyValue('--grid-cell-width')).toBe('4.75rem');
    expect(grid.style.getPropertyValue('--grid-row-header-width')).toBe('2.5rem');
  });

  it('renders spreadsheet row numbers and Excel-style column labels beyond Z', () => {
    const sheet = sheetDocument({
      id: 'sheet-wide',
      name: 'Wide Sheet',
      position: { x: 0, y: 0 },
      columnCount: 28,
      rowCount: 3,
    });

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

  it('renders multiple sheet grids independently inside their frames', () => {
    const first = positionedSheet('sheet-inputs', 'Inputs', { x: 48, y: 96 });
    const second = sheetDocument({
      id: 'sheet-outputs',
      name: 'Outputs',
      position: { x: 420, y: 260 },
      columnCount: 2,
      rowCount: 2,
    });

    render(<App initialWorkbook={workbookWithSheets([first, second])} />);

    const frames = screen.getAllByTestId('sheet-frame');
    expect(within(frames[0]).getByRole('table', { name: 'Inputs grid' })).toBeInTheDocument();
    expect(within(frames[0]).getAllByTestId('sheet-grid-cell')).toHaveLength(200);
    expect(within(frames[1]).getByRole('table', { name: 'Outputs grid' })).toBeInTheDocument();
    expect(within(frames[1]).getAllByTestId('sheet-grid-cell')).toHaveLength(4);
    expect(within(frames[1]).queryByRole('cell', { name: 'Outputs C1 empty cell' })).not.toBeInTheDocument();
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

  it('enters an unselected grid with the keyboard and establishes a roving cell focus', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const grid = screen.getByRole('table', { name: 'Inputs grid' });
    const a1 = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    expect(grid).toHaveAttribute('tabindex', '0');

    fireEvent.focus(grid);

    expect(a1).toHaveAttribute('data-active-cell', 'true');
    expect(a1).toHaveAttribute('tabindex', '0');
    expect(document.activeElement).toBe(a1);
    expect(grid).toHaveAttribute('tabindex', '-1');
  });

  it('keeps focus in the grid across a measured virtual row boundary until the destination is native', async () => {
    render(<App initialWorkbook={workbookWithSheets([sparseLargeSheetDocument()])} />);

    const frame = screen.getByTestId('sheet-frame');
    const body = within(frame).getByTestId('sheet-frame-body');
    virtualGridGeometry(body, { height: 160, width: 240 });
    const grid = within(frame).getByRole('table', { name: 'Sparse large sheet grid' });
    body.scrollTop = 1_000;
    fireEvent.scroll(body);
    await screen.findByRole('cell', { name: 'Sparse large sheet A40 empty cell' });
    const lastMountedRow = Math.max(...within(grid).getAllByRole('rowheader').map((header) => Number(header.textContent)));
    const source = within(grid).getByRole('cell', { name: `Sparse large sheet A${lastMountedRow} empty cell` });

    fireEvent.click(source);
    const selectedSource = await screen.findByRole('cell', { name: `Sparse large sheet A${lastMountedRow} empty cell` });
    fireEvent.keyDown(selectedSource, { key: 'ArrowDown' });

    const destination = await screen.findByRole('cell', { name: `Sparse large sheet A${lastMountedRow + 1} empty cell` });
    expect(destination).toBeInTheDocument();
    expect(grid).toHaveFocus();
    body.scrollTop = lastMountedRow * 26.4;
    fireEvent.scroll(body);
    await screen.findByRole('rowheader', { name: String(lastMountedRow + 1) });
    const nativeDestination = await screen.findByRole('cell', { name: `Sparse large sheet A${lastMountedRow + 1} empty cell` });
    expect(nativeDestination).toHaveFocus();
    expect(nativeDestination).toHaveAttribute('data-active-cell', 'true');
    expect(within(grid).getAllByTestId('sheet-grid-cell').filter((cell) => cell.tabIndex === 0)).toHaveLength(1);
  });

  it('keeps focus in the grid across a measured virtual column boundary until the destination is native', async () => {
    render(<App initialWorkbook={workbookWithSheets([sparseLargeSheetDocument()])} />);

    const frame = screen.getByTestId('sheet-frame');
    const body = within(frame).getByTestId('sheet-frame-body');
    virtualGridGeometry(body, { height: 160, width: 240 });
    const grid = within(frame).getByRole('table', { name: 'Sparse large sheet grid' });
    body.scrollLeft = 1_000;
    fireEvent.scroll(body);
    await screen.findByRole('cell', { name: 'Sparse large sheet N1 empty cell' });
    const lastMountedColumn = Math.max(...within(grid).getAllByRole('columnheader')
      .map((header) => Number(header.getAttribute('aria-colindex')))
      .filter(Number.isFinite));
    const sourceColumn = within(grid).getAllByRole('columnheader')
      .find((header) => Number(header.getAttribute('aria-colindex')) === lastMountedColumn)!;
    const source = within(grid).getByRole('cell', {
      name: `Sparse large sheet ${sourceColumn.textContent}1 empty cell`,
    });

    fireEvent.click(source);
    const selectedSource = await screen.findByRole('cell', {
      name: `Sparse large sheet ${sourceColumn.textContent}1 empty cell`,
    });
    fireEvent.keyDown(selectedSource, { key: 'ArrowRight' });

    const destinationColumn = within(grid).getAllByRole('columnheader')
      .find((header) => Number(header.getAttribute('aria-colindex')) === lastMountedColumn + 1);
    const destination = await screen.findByRole('cell', {
      name: `Sparse large sheet ${columnLabel(lastMountedColumn)}1 empty cell`,
    });
    expect(destination).toBeInTheDocument();
    expect(destinationColumn).toBeInTheDocument();
    expect(grid).toHaveFocus();
    body.scrollLeft = (lastMountedColumn - 1) * 76;
    fireEvent.scroll(body);
    await screen.findByRole('columnheader', { name: columnLabel(lastMountedColumn) });
    const nativeDestination = await screen.findByRole('cell', {
      name: `Sparse large sheet ${columnLabel(lastMountedColumn)}1 empty cell`,
    });
    expect(nativeDestination).toHaveFocus();
    expect(nativeDestination).toHaveAttribute('data-active-cell', 'true');
    expect(within(grid).getAllByTestId('sheet-grid-cell').filter((cell) => cell.tabIndex === 0)).toHaveLength(1);
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

  it('selects empty, text, numeric-looking, and formula cells through the same cell path', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: 'Region',
        B1: '42',
        C1: '=SUM(B1:B2)',
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

  it('moves selected cells with arrow keys and clamps at sheet bounds', async () => {
    const user = userEvent.setup();
    const sheet = sheetDocument({
      id: 'sheet-inputs',
      name: 'Inputs',
      position: { x: 120, y: 80 },
      rowCount: 2,
      columnCount: 2,
    });

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
            sheetDocument({
              id: 'sheet-inputs',
              name: 'Inputs',
              position: { x: 120, y: 80 },
              rowCount: 2,
              columnCount: 2,
            }),
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
});
