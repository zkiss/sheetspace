import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import {
  createSheetFromToolbar,
  openCellEditor,
  openSheetContextMenu,
  workspaceSurface,
} from './test/appScreen';
import { workspaceRect } from './test/domGeometry';
import { positionedSheet, workbookWithSheets } from './test/workbookFactories';

describe('App sheet management integration', () => {
  it('creates a named sheet from the workspace context menu at the clicked coordinate', async () => {
    const user = userEvent.setup();
    render(<App initialWorkbook={workbookWithSheets([])} />);

    workspaceSurface().getBoundingClientRect = workspaceRect;
    await user.click(screen.getByRole('button', { name: 'Zoom workspace in' }));

    fireEvent.contextMenu(workspaceSurface(), { clientX: 240, clientY: 330 });
    expect(screen.getByRole('form', { name: /create sheet/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /create sheet here/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/sheet name/i), 'Assumptions');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    const frame = screen.getByTestId('sheet-frame');
    expect(within(frame).getByRole('heading', { name: 'Assumptions' })).toBeInTheDocument();
    expect(frame).toHaveStyle({ left: '183px', top: '250px' });
  });

  it('creates a named sheet from the toolbar at the viewport center', async () => {
    const user = userEvent.setup();
    render(<App initialWorkbook={workbookWithSheets([])} />);

    Object.defineProperties(workspaceSurface(), {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 600 },
    });
    await user.click(screen.getByRole('button', { name: 'Pan workspace right' }));
    await user.click(screen.getByRole('button', { name: 'Pan workspace down' }));

    await user.click(screen.getByRole('button', { name: /new sheet/i }));
    expect(screen.getByRole('form', { name: /create sheet/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/sheet name/i), 'Inputs');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    const frame = screen.getByTestId('sheet-frame');
    expect(within(frame).getByRole('heading', { name: 'Inputs' })).toBeInTheDocument();
    expect(frame).toHaveAttribute('data-sheet-id', 'sheet-1');
    expect(frame).toHaveAttribute('data-column-count', '10');
    expect(frame).toHaveAttribute('data-row-count', '20');
    expect(frame).toHaveStyle({ left: '320px', top: '220px' });
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

  it('assigns ascending z-order to newly created sheet frames', async () => {
    const user = userEvent.setup();
    render(<App initialWorkbook={workbookWithSheets([])} />);

    await user.click(screen.getByRole('button', { name: /new sheet/i }));
    await user.type(screen.getByLabelText(/sheet name/i), 'Inputs');
    await user.click(screen.getByRole('button', { name: /^create$/i }));
    await user.click(screen.getByRole('button', { name: /new sheet/i }));
    await user.type(screen.getByLabelText(/sheet name/i), 'Outputs');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    const frames = screen.getAllByTestId('sheet-frame');
    expect(frames[0]).toHaveAttribute('data-z-index', '1');
    expect(frames[1]).toHaveAttribute('data-z-index', '2');
  });

  it('changes only the requested sheet z-order through explicit frame controls', async () => {
    const user = userEvent.setup();
    render(<App initialWorkbook={workbookWithSheets([])} />);

    await user.click(screen.getByRole('button', { name: /new sheet/i }));
    await user.type(screen.getByLabelText(/sheet name/i), 'Inputs');
    await user.click(screen.getByRole('button', { name: /^create$/i }));
    await user.click(screen.getByRole('button', { name: /new sheet/i }));
    await user.type(screen.getByLabelText(/sheet name/i), 'Assumptions');
    await user.click(screen.getByRole('button', { name: /^create$/i }));
    await user.click(screen.getByRole('button', { name: /new sheet/i }));
    await user.type(screen.getByLabelText(/sheet name/i), 'Outputs');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    const inputsFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const assumptionsFrame = screen.getByRole('article', { name: 'Sheet Assumptions' });
    const outputsFrame = screen.getByRole('article', { name: 'Sheet Outputs' });

    await user.click(within(openSheetContextMenu(inputsFrame)).getByRole('menuitem', { name: 'Bring forward' }));

    expect(inputsFrame).toHaveAttribute('data-z-index', '2');
    expect(assumptionsFrame).toHaveAttribute('data-z-index', '1');
    expect(outputsFrame).toHaveAttribute('data-z-index', '3');
    expect(screen.getAllByTestId('sheet-frame').map((frame) => frame.dataset.sheetId)).toEqual([
      'sheet-1',
      'sheet-2',
      'sheet-3',
    ]);

    await user.click(within(openSheetContextMenu(inputsFrame)).getByRole('menuitem', { name: 'Bring to front' }));
    expect(inputsFrame).toHaveAttribute('data-z-index', '3');
    expect(assumptionsFrame).toHaveAttribute('data-z-index', '1');
    expect(outputsFrame).toHaveAttribute('data-z-index', '2');

    await user.click(within(openSheetContextMenu(inputsFrame)).getByRole('menuitem', { name: 'Send backward' }));
    expect(inputsFrame).toHaveAttribute('data-z-index', '2');
    expect(assumptionsFrame).toHaveAttribute('data-z-index', '1');
    expect(outputsFrame).toHaveAttribute('data-z-index', '3');

    await user.click(within(openSheetContextMenu(inputsFrame)).getByRole('menuitem', { name: 'Send to back' }));
    expect(inputsFrame).toHaveAttribute('data-z-index', '1');
    expect(assumptionsFrame).toHaveAttribute('data-z-index', '2');
    expect(outputsFrame).toHaveAttribute('data-z-index', '3');
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

  it('closes the sheet context menu when returning to frame editing', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const cell = within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' });

    expect(openSheetContextMenu(frame)).toBeInTheDocument();

    fireEvent(cell, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 130, clientY: 120 }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes the sheet context menu when opening rename or create dialogs', async () => {
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

    expect(screen.getByRole('form', { name: 'Rename sheet' })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    openSheetContextMenu(frame);
    await user.click(screen.getByRole('button', { name: /new sheet/i }));

    expect(screen.getByRole('form', { name: 'Create sheet' })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
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
