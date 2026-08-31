import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { autosaveClient } from './test/apiClients';
import { openCellEditor, openSheetContextMenu, resizeHandle, workspaceSurface } from './test/appScreen';
import { measuredElementGeometry, workspaceRect } from './test/domGeometry';
import { positionedSheet, sparseLargeSheetDocument, workbookWithSheets } from './test/workbookFactories';

const { sheetFrameRenderSpy } = vi.hoisted(() => ({ sheetFrameRenderSpy: vi.fn() }));

vi.mock('./SheetFrame', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./SheetFrame')>();
  return {
    ...actual,
    SheetFrame(props: Parameters<typeof actual.SheetFrame>[0]) {
      sheetFrameRenderSpy(props.frame.id);
      return actual.SheetFrame(props);
    },
  };
});

function measureWorkspace(width = 800, height = 600) {
  return measuredElementGeometry(workspaceSurface(), { height, width });
}

function mountedDomCounts() {
  return {
    cells: screen.queryAllByTestId('sheet-grid-cell').length,
    columnHeaders: document.querySelectorAll('.sheet-grid-column-header').length,
    frames: screen.queryAllByTestId('sheet-frame').length,
    grids: screen.queryAllByTestId('sheet-grid').length,
    headerCorners: document.querySelectorAll('.sheet-grid-corner').length,
    rowHeaders: document.querySelectorAll('.sheet-grid-row-header').length,
  };
}

describe('App workspace and sheet frame integration', () => {
  it('keeps frame, grid, cell, and header DOM bounded when wholly offscreen sheets are added', async () => {
    const visibleLarge = {
      ...sparseLargeSheetDocument({ id: 'sheet-visible', name: 'Visible' }),
      frame: {
        ...sparseLargeSheetDocument().frame,
        position: { x: 40, y: 40 },
        zIndex: 3,
      },
    };
    const overlap = {
      ...positionedSheet('sheet-overlap', 'Overlap', { x: 120, y: 100 }),
      frame: {
        ...positionedSheet('sheet-overlap', 'Overlap', { x: 120, y: 100 }).frame,
        zIndex: 9,
      },
    };
    const distant = Array.from({ length: 40 }, (_, index) => ({
      ...positionedSheet(`sheet-distant-${index}`, `Distant ${index}`, {
        x: 2_200 + index * 1_500,
        y: 1_400 + index * 1_000,
      }),
      ...(index === 0 ? { cells: { B2: 'retained' } } : {}),
    }));
    const fixtureSheets = [visibleLarge, overlap, ...distant];
    const preVirtualizationCounts = fixtureSheets.reduce((counts, sheet) => ({
      ...counts,
      cells: counts.cells + sheet.content.rows.length * sheet.content.columns.length,
      columnHeaders: counts.columnHeaders + sheet.content.columns.length,
      rowHeaders: counts.rowHeaders + sheet.content.rows.length,
    }), {
      cells: 0,
      columnHeaders: 0,
      frames: fixtureSheets.length,
      grids: fixtureSheets.length,
      headerCorners: fixtureSheets.length,
      rowHeaders: 0,
    });
    expect(preVirtualizationCounts).toEqual({
      cells: 1_008_200,
      columnHeaders: 510,
      frames: 42,
      grids: 42,
      headerCorners: 42,
      rowHeaders: 10_820,
    });

    const baseline = render(<App initialWorkbook={workbookWithSheets([visibleLarge, overlap])} />);
    measureWorkspace();
    await waitFor(() => expect(screen.getAllByTestId('sheet-frame')).toHaveLength(2));
    const baselineCounts = mountedDomCounts();
    expect(screen.getAllByTestId('sheet-frame').map((frame) => frame.dataset.sheetId))
      .toEqual(['sheet-visible', 'sheet-overlap']);
    expect(screen.getByRole('article', { name: 'Sheet Visible' })).toHaveAttribute('data-z-index', '3');
    expect(screen.getByRole('article', { name: 'Sheet Overlap' })).toHaveAttribute('data-z-index', '9');
    baseline.unmount();

    sheetFrameRenderSpy.mockClear();
    render(<App initialWorkbook={workbookWithSheets(fixtureSheets)} />);
    expect(sheetFrameRenderSpy.mock.calls.flat()).not.toContain('sheet-distant-0');
    expect(sheetFrameRenderSpy.mock.calls.flat().some((sheetId) => sheetId.startsWith('sheet-distant-')))
      .toBe(false);
    measureWorkspace();
    await waitFor(() => expect(screen.getAllByTestId('sheet-frame')).toHaveLength(2));
    expect(mountedDomCounts()).toEqual(baselineCounts);
    expect(baselineCounts).toEqual({
      cells: 1_100,
      columnHeaders: 40,
      frames: 2,
      grids: 2,
      headerCorners: 2,
      rowHeaders: 50,
    });
    expect(screen.getByText('42 sheets')).toBeInTheDocument();
    expect(baselineCounts.cells).toBeLessThan(1_200);

    const surface = workspaceSurface();
    fireEvent(surface, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }));
    fireEvent(surface, new MouseEvent('pointermove', { bubbles: true, clientX: -2_200, clientY: -1_400 }));
    fireEvent(surface, new MouseEvent('pointerup', { bubbles: true, clientX: -2_200, clientY: -1_400 }));

    await waitFor(() => expect(screen.getAllByTestId('sheet-frame')).toHaveLength(1));
    expect(screen.getByRole('article', { name: 'Sheet Distant 0' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Distant 0 B2 cell' })).toHaveTextContent('retained');
    expect(screen.getByText('42 sheets')).toBeInTheDocument();
  });

  it('recomputes mounted frames for pan, zoom, and surface resize', async () => {
    render(<App initialWorkbook={workbookWithSheets([
      positionedSheet('sheet-origin', 'Origin', { x: 40, y: 40 }),
      positionedSheet('sheet-edge', 'Edge', { x: 1_000, y: 40 }),
      positionedSheet('sheet-far', 'Far', { x: 1_200, y: 40 }),
    ])} />);
    const geometry = measureWorkspace(600, 600);

    await waitFor(() => expect(screen.getAllByTestId('sheet-frame')).toHaveLength(1));
    expect(screen.getByRole('article', { name: 'Sheet Origin' })).toBeInTheDocument();

    geometry.resize({ height: 600, width: 800 });
    await screen.findByRole('article', { name: 'Sheet Edge' });
    expect(screen.queryByRole('article', { name: 'Sheet Far' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom workspace out' }));
    await screen.findByRole('article', { name: 'Sheet Far' });

    for (let step = 0; step < 10; step += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Pan workspace left' }));
    }
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Sheet Origin' })).not.toBeInTheDocument());
    expect(screen.getByRole('article', { name: 'Sheet Far' })).toBeInTheDocument();
  });

  it('pins a dragged frame through an offscreen preview and releases it after commit', async () => {
    render(<App initialWorkbook={workbookWithSheets([
      positionedSheet('sheet-inputs', 'Inputs', { x: 40, y: 40 }),
    ])} />);
    measureWorkspace();
    const frame = await screen.findByRole('article', { name: 'Sheet Inputs' });
    const header = within(frame).getByTestId('sheet-frame-header');

    fireEvent(header, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }));
    fireEvent(header, new MouseEvent('pointermove', { bubbles: true, clientX: 2_000, clientY: 1_400 }));

    expect(frame).toHaveStyle({ left: '1940px', top: '1340px' });
    expect(frame).toBeInTheDocument();

    fireEvent(header, new MouseEvent('pointerup', { bubbles: true, clientX: 2_000, clientY: 1_400 }));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Sheet Inputs' })).not.toBeInTheDocument());
  });

  it('pins resize and editing through culling boundaries, then releases each finished interaction', async () => {
    const user = userEvent.setup();
    const resizeRender = render(<App initialWorkbook={workbookWithSheets([
      positionedSheet('sheet-resize', 'Resize', { x: 1_115, y: 40 }),
    ])} />);
    measureWorkspace();
    const resizeFrame = await screen.findByRole('article', { name: 'Sheet Resize' });
    const leftHandle = resizeHandle(resizeFrame, 'left');
    fireEvent(leftHandle, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 100 }));
    fireEvent(leftHandle, new MouseEvent('pointermove', { bubbles: true, clientX: 100, clientY: 100 }));
    expect(resizeFrame).toHaveStyle({ left: '1175px', width: '180px' });
    fireEvent(leftHandle, new MouseEvent('pointerup', { bubbles: true, clientX: 100, clientY: 100 }));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Sheet Resize' })).not.toBeInTheDocument());
    resizeRender.unmount();

    render(<App initialWorkbook={workbookWithSheets([
      positionedSheet('sheet-edit', 'Edit', { x: 40, y: 40 }),
    ])} />);
    measureWorkspace();
    const editFrame = await screen.findByRole('article', { name: 'Sheet Edit' });
    const cell = within(editFrame).getByRole('cell', { name: 'Edit A1 empty cell' });
    await openCellEditor(user, cell);
    const editor = screen.getByRole('textbox', { name: 'Edit A1 editor' });
    await user.type(editor, 'draft');

    const surface = workspaceSurface();
    fireEvent(surface, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }));
    fireEvent(surface, new MouseEvent('pointermove', { bubbles: true, clientX: 2_000, clientY: 1_400 }));
    fireEvent(surface, new MouseEvent('pointerup', { bubbles: true, clientX: 2_000, clientY: 1_400 }));
    expect(screen.getByRole('textbox', { name: 'Edit A1 editor' })).toHaveValue('draft');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Sheet Edit' })).not.toBeInTheDocument());
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

  it('keeps drag preview transient and discards it on pointer cancel', () => {
    const apiClient = autosaveClient();
    render(
      <App
        apiClient={apiClient}
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    const header = within(frame).getByTestId('sheet-frame-header');
    fireEvent(header, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 120 }));
    fireEvent(header, new MouseEvent('pointermove', { bubbles: true, clientX: 148, clientY: 154 }));

    expect(frame).toHaveStyle({ left: '168px', top: '114px' });
    expect(apiClient.updateSheetPosition).not.toHaveBeenCalled();
    expect(workspaceSurface()).toHaveAttribute('data-viewport-x', '0');
    expect(workspaceSurface()).toHaveAttribute('data-viewport-y', '0');

    fireEvent(header, new MouseEvent('pointercancel', { bubbles: true, clientX: 148, clientY: 154 }));

    expect(frame).toHaveStyle({ left: '120px', top: '80px' });
    expect(apiClient.updateSheetPosition).not.toHaveBeenCalled();
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

  it('keeps resize preview transient and discards it on pointer cancel', () => {
    const apiClient = autosaveClient();
    render(
      <App
        apiClient={apiClient}
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    const rightHandle = resizeHandle(frame, 'right');
    fireEvent(rightHandle, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 360, clientY: 120 }));
    fireEvent(rightHandle, new MouseEvent('pointermove', { bubbles: true, clientX: 440, clientY: 120 }));

    expect(frame).toHaveStyle({ width: '320px', height: '160px' });
    expect(apiClient.updateSheetFrameLayout).not.toHaveBeenCalled();

    fireEvent(rightHandle, new MouseEvent('pointercancel', { bubbles: true, clientX: 440, clientY: 120 }));

    expect(frame).toHaveStyle({ width: '240px', height: '160px' });
    expect(apiClient.updateSheetFrameLayout).not.toHaveBeenCalled();
  });

  it('closes an open sheet menu when resize interaction takes ownership', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    openSheetContextMenu(frame);
    const rightHandle = resizeHandle(frame, 'right');
    fireEvent(rightHandle, new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 360,
      clientY: 120,
    }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(workspaceSurface()).not.toHaveClass('workspace-surface-panning');
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

    expect(apiClient.updateSheetFrameLayout).toHaveBeenCalledWith(
      'sheet-inputs',
      { x: 120, y: 80 },
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
