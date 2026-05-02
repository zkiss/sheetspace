import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { createSheet, type Workbook, type WorkspacePosition } from './workbook';

afterEach(() => {
  cleanup();
});

function workspaceSurface() {
  return screen.getByTestId('workspace-surface');
}

async function createSheetFromToolbar(name: string) {
  const user = userEvent.setup();

  await user.click(screen.getByRole('button', { name: /new sheet/i }));
  await user.type(screen.getByLabelText(/sheet name/i), name);
  await user.click(screen.getByRole('button', { name: /^create$/i }));
}

function positionedSheet(id: string, name: string, position: WorkspacePosition) {
  const result = createSheet({ id, name, position });
  if (!result.ok) {
    throw new Error(`Failed to create test sheet ${name}`);
  }

  return result.value;
}

function workbookWithSheets(sheets: Workbook['sheets']): Workbook {
  return {
    version: 1,
    sheets,
  };
}

async function openCellEditor(user: ReturnType<typeof userEvent.setup>, cell: HTMLElement) {
  await user.dblClick(cell);
  return within(cell).getByRole('textbox');
}

describe('App workspace', () => {
  it('opens to an empty spatial workspace without a default sheet', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Sheetspace' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /spatial workspace/i })).toBeInTheDocument();
    expect(screen.getByText(/right-click the workspace/i)).toBeInTheDocument();
    expect(screen.queryByTestId('sheet-frame')).not.toBeInTheDocument();
    expect(screen.getByText('0 sheets')).toBeInTheDocument();
  });

  it('renders an empty workbook without sheet frames', () => {
    render(<App initialWorkbook={workbookWithSheets([])} />);

    expect(screen.queryByTestId('sheet-frame')).not.toBeInTheDocument();
    expect(screen.getByText('0 sheets')).toBeInTheDocument();
  });

  it('renders one positioned sheet frame with the visible sheet name and grid body area', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    expect(frame).toHaveAttribute('data-sheet-id', 'sheet-inputs');
    expect(frame).toHaveStyle({ left: '120px', top: '80px' });
    expect(within(frame).getByRole('heading', { name: 'Inputs' })).toBeInTheDocument();
    expect(within(frame).getByRole('table', { name: 'Inputs grid' })).toBeInTheDocument();
    expect(screen.queryByText(/right-click the workspace/i)).not.toBeInTheDocument();
  });

  it('renders multiple frames at their independent sheet positions without requiring cell values', () => {
    const first = positionedSheet('sheet-inputs', 'Inputs', { x: 48, y: 96 });
    const second = {
      ...positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 260 }),
      cells: {},
    };

    render(<App initialWorkbook={workbookWithSheets([first, second])} />);

    const frames = screen.getAllByTestId('sheet-frame');
    expect(frames).toHaveLength(2);
    expect(frames[0]).toHaveAttribute('data-sheet-id', 'sheet-inputs');
    expect(frames[0]).toHaveStyle({ left: '48px', top: '96px' });
    expect(within(frames[0]).getByRole('heading', { name: 'Inputs' })).toBeInTheDocument();
    expect(frames[1]).toHaveAttribute('data-sheet-id', 'sheet-outputs');
    expect(frames[1]).toHaveStyle({ left: '420px', top: '260px' });
    expect(within(frames[1]).getByRole('heading', { name: 'Outputs' })).toBeInTheDocument();
    expect(screen.getAllByTestId('sheet-frame-body')).toHaveLength(2);
  });

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

    expect(cell).toHaveTextContent('=SUM(B1:B2)');
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

  it('creates a named sheet from the toolbar at the viewport center', async () => {
    const user = userEvent.setup();
    render(<App />);

    Object.defineProperties(workspaceSurface(), {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 600 },
      scrollLeft: { configurable: true, value: 100 },
      scrollTop: { configurable: true, value: 40 },
    });

    await user.click(screen.getByRole('button', { name: /new sheet/i }));
    expect(screen.getByRole('form', { name: /create sheet/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/sheet name/i), 'Inputs');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    const frame = screen.getByTestId('sheet-frame');
    expect(within(frame).getByRole('heading', { name: 'Inputs' })).toBeInTheDocument();
    expect(frame).toHaveAttribute('data-sheet-id', 'sheet-1');
    expect(frame).toHaveAttribute('data-column-count', '10');
    expect(frame).toHaveAttribute('data-row-count', '20');
    expect(frame).toHaveStyle({ left: '500px', top: '340px' });
    expect(screen.queryByText(/right-click the workspace/i)).not.toBeInTheDocument();
    expect(screen.getByText('1 sheets')).toBeInTheDocument();
  });

  it('creates a named sheet from the workspace context menu at the clicked coordinate', async () => {
    const user = userEvent.setup();
    render(<App />);

    workspaceSurface().getBoundingClientRect = () =>
      ({
        left: 20,
        top: 30,
        right: 1020,
        bottom: 830,
        width: 1000,
        height: 800,
        x: 20,
        y: 30,
        toJSON: () => undefined,
      }) as DOMRect;
    Object.defineProperties(workspaceSurface(), {
      scrollLeft: { configurable: true, value: 50 },
      scrollTop: { configurable: true, value: 70 },
    });

    fireEvent.contextMenu(workspaceSurface(), { clientX: 240, clientY: 330 });
    expect(screen.getByRole('form', { name: /create sheet/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /create sheet here/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/sheet name/i), 'Assumptions');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    const frame = screen.getByTestId('sheet-frame');
    expect(within(frame).getByRole('heading', { name: 'Assumptions' })).toBeInTheDocument();
    expect(frame).toHaveStyle({ left: '270px', top: '370px' });
  });

  it('rejects empty sheet names without adding a sheet', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /new sheet/i }));
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    expect(screen.getByRole('alert')).toHaveTextContent('Sheet name is required.');
    expect(screen.queryByTestId('sheet-frame')).not.toBeInTheDocument();
    expect(screen.getByText('0 sheets')).toBeInTheDocument();
  });

  it('rejects duplicate sheet names without adding another sheet', async () => {
    render(<App />);

    await createSheetFromToolbar('Inputs');
    await createSheetFromToolbar('Inputs');

    expect(screen.getByRole('alert')).toHaveTextContent('A sheet with that name already exists.');
    expect(screen.getAllByTestId('sheet-frame')).toHaveLength(1);
    expect(screen.getByText('1 sheets')).toBeInTheDocument();
  });

  it('creates multiple sheets with stable ids and distinguishable names', async () => {
    render(<App />);

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
    await user.click(within(frame).getByRole('button', { name: /rename/i }));
    expect(screen.getByRole('form', { name: /rename sheet/i })).toBeInTheDocument();

    const input = screen.getByLabelText(/sheet name/i);
    await user.clear(input);
    await user.type(input, '  Renamed Inputs  ');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const renamedFrame = screen.getByRole('article', { name: 'Sheet Renamed Inputs' });
    expect(within(renamedFrame).getByRole('heading', { name: 'Renamed Inputs' })).toBeInTheDocument();
    expect(within(renamedFrame).getByRole('table', { name: 'Renamed Inputs grid' })).toBeInTheDocument();
    expect(within(renamedFrame).getByRole('cell', { name: 'Renamed Inputs A1 cell' })).toHaveTextContent(
      '=SUM(Old Name!A1)',
    );
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

    await user.click(screen.getByRole('button', { name: /rename/i }));
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
    await user.click(within(outputFrame).getByRole('button', { name: /rename/i }));
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
