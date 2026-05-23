import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { autosaveClient } from './test/apiClients';
import { openCellEditor, openSheetContextMenu, resizeHandle, workspaceSurface } from './test/appScreen';
import { workspaceRect } from './test/domGeometry';
import { positionedSheet, workbookWithSheets } from './test/workbookFactories';

afterEach(() => {
  cleanup();
});

describe('App workspace and sheet frame integration', () => {
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
    expect(frame).toHaveStyle({ width: '240px', height: '160px' });
    expect(frame).toHaveAttribute('data-frame-width', '240');
    expect(frame).toHaveAttribute('data-frame-height', '160');
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

  it('pans the workspace with viewport controls while preserving frame workspace coordinates', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const surface = workspaceSurface();
    const plane = screen.getByTestId('workspace-plane');
    const frame = screen.getByTestId('sheet-frame');

    await user.click(screen.getByRole('button', { name: 'Pan workspace right' }));
    await user.click(screen.getByRole('button', { name: 'Pan workspace down' }));

    expect(surface).toHaveAttribute('data-viewport-x', '80');
    expect(surface).toHaveAttribute('data-viewport-y', '80');
    expect(surface).toHaveAttribute('data-viewport-scale', '1');
    expect(plane).toHaveStyle({ transform: 'translate(80px, 80px) scale(1)' });
    expect(frame).toHaveStyle({ left: '120px', top: '80px' });
  });

  it('pans the workspace by dragging empty workspace without starting cell interaction', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const surface = workspaceSurface();
    fireEvent(surface, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 120 }));
    fireEvent(surface, new MouseEvent('pointermove', { bubbles: true, clientX: 160, clientY: 170 }));
    fireEvent(surface, new MouseEvent('pointerup', { bubbles: true, clientX: 160, clientY: 170 }));

    expect(surface).toHaveAttribute('data-viewport-x', '60');
    expect(surface).toHaveAttribute('data-viewport-y', '50');
    expect(screen.getByTestId('sheet-frame')).not.toHaveAttribute('data-active-sheet');
  });

  it('moves a sheet frame by dragging its header', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    const header = within(frame).getByTestId('sheet-frame-header');

    fireEvent(header, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 120 }));
    fireEvent(header, new MouseEvent('pointermove', { bubbles: true, clientX: 148, clientY: 154 }));
    fireEvent(header, new MouseEvent('pointerup', { bubbles: true, clientX: 148, clientY: 154 }));

    expect(frame).toHaveStyle({ left: '168px', top: '114px' });
    expect(frame).toHaveAttribute('data-position-x', '168');
    expect(frame).toHaveAttribute('data-position-y', '114');
  });

  it('keeps other sheet positions unchanged when one frame header is dragged', () => {
    const inputs = positionedSheet('sheet-inputs', 'Inputs', { x: 48, y: 96 });
    const outputs = positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 260 });

    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);

    const inputFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const outputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });
    const inputHeader = within(inputFrame).getByTestId('sheet-frame-header');

    fireEvent(inputHeader, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 120 }));
    fireEvent(inputHeader, new MouseEvent('pointermove', { bubbles: true, clientX: 130, clientY: 105 }));
    fireEvent(inputHeader, new MouseEvent('pointerup', { bubbles: true, clientX: 130, clientY: 105 }));

    expect(inputFrame).toHaveStyle({ left: '78px', top: '81px' });
    expect(outputFrame).toHaveStyle({ left: '420px', top: '260px' });
  });

  it('does not move a sheet frame when dragging the grid body', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    const body = within(frame).getByTestId('sheet-frame-body');

    fireEvent(body, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 120 }));
    fireEvent(body, new MouseEvent('pointermove', { bubbles: true, clientX: 160, clientY: 170 }));
    fireEvent(body, new MouseEvent('pointerup', { bubbles: true, clientX: 160, clientY: 170 }));

    expect(frame).toHaveStyle({ left: '120px', top: '80px' });
  });

  it('resizes a sheet frame horizontally from the right border', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    const rightHandle = resizeHandle(frame, 'right');

    fireEvent(rightHandle, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 360, clientY: 120 }));
    fireEvent(rightHandle, new MouseEvent('pointermove', { bubbles: true, clientX: 440, clientY: 120 }));
    fireEvent(rightHandle, new MouseEvent('pointerup', { bubbles: true, clientX: 440, clientY: 120 }));

    expect(frame).toHaveStyle({ left: '120px', top: '80px', width: '320px', height: '160px' });
    expect(frame).toHaveAttribute('data-frame-width', '320');
    expect(frame).toHaveAttribute('data-frame-height', '160');
  });

  it('autosaves committed frame resize from a resize handle', async () => {
    const apiClient = autosaveClient();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          { ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }), revision: 6 },
        ])}
        apiClient={apiClient}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    const rightHandle = resizeHandle(frame, 'right');

    fireEvent(rightHandle, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 360, clientY: 120 }));
    fireEvent(rightHandle, new MouseEvent('pointermove', { bubbles: true, clientX: 440, clientY: 120 }));
    fireEvent(rightHandle, new MouseEvent('pointerup', { bubbles: true, clientX: 440, clientY: 120 }));

    expect(apiClient.updateSheetFrameSize).toHaveBeenCalledWith(
      'sheet-inputs',
      { width: 320, height: 160 },
      { revision: 6 },
    );
    expect(apiClient.updateSheetPosition).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saved'));
  });

  it('zooms empty workspace around the wheel pointer without changing stored frame positions', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    workspaceSurface().getBoundingClientRect = workspaceRect;

    fireEvent.wheel(workspaceSurface(), { clientX: 220, clientY: 180, deltaY: -100 });

    expect(workspaceSurface()).toHaveAttribute('data-viewport-scale', '1.2');
    expect(workspaceSurface()).toHaveAttribute('data-viewport-x', '-40');
    expect(workspaceSurface()).toHaveAttribute('data-viewport-y', '-30');
    expect(screen.getByTestId('sheet-frame')).toHaveStyle({ left: '120px', top: '80px' });
  });

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

  it('does not pan the workspace when interacting with the sheet context menu', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const menu = openSheetContextMenu(frame);

    fireEvent(menu, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 120, clientY: 80 }));
    fireEvent.pointerMove(workspaceSurface(), { clientX: 180, clientY: 120, pointerId: 1 });

    expect(workspaceSurface()).toHaveAttribute('data-viewport-x', '0');
    expect(workspaceSurface()).toHaveAttribute('data-viewport-y', '0');
    expect(workspaceSurface()).not.toHaveClass('workspace-surface-panning');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('does not implicitly raise a sheet when dragging selecting or editing it', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
          positionedSheet('sheet-outputs', 'Outputs', { x: 140, y: 100 }),
        ])}
      />,
    );

    const inputFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const outputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });
    const inputHeader = within(inputFrame).getByTestId('sheet-frame-header');
    const inputCell = within(inputFrame).getByRole('cell', { name: 'Inputs A1 empty cell' });

    expect(inputFrame).toHaveAttribute('data-z-index', '1');
    expect(outputFrame).toHaveAttribute('data-z-index', '1');

    fireEvent(inputHeader, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 120, clientY: 80 }));
    fireEvent(inputHeader, new MouseEvent('pointermove', { bubbles: true, clientX: 150, clientY: 110 }));
    fireEvent(inputHeader, new MouseEvent('pointerup', { bubbles: true, clientX: 150, clientY: 110 }));
    await user.click(inputCell);
    await openCellEditor(user, inputCell);

    expect(inputFrame).toHaveAttribute('data-z-index', '1');
    expect(outputFrame).toHaveAttribute('data-z-index', '1');
  });
});
