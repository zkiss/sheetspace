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
    expect(within(frame).getByTestId('sheet-frame-body')).toHaveTextContent('10 columns x 20 rows');
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
});
