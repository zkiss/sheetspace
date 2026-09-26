import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { openCellEditor } from '@test-support/appScreen';
import { measuredElementGeometry } from '@test-support/domGeometry';
import { positionedSheet, workbookWithSheets } from '@test-support/workbookFactories';

function inputsSheet() {
  return positionedSheet('sheet-inputs', 'Inputs', { x: 48, y: 96 });
}

function outputsSheet() {
  return positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 96 });
}

function scaleInput() {
  return screen.getByRole('spinbutton', { name: 'Scale sheet Inputs percentage' });
}

function zoomWorkspace(direction: 'in' | 'out', times: number) {
  const button = screen.getByRole('button', { name: `Zoom workspace ${direction}` });
  for (let index = 0; index < times; index += 1) fireEvent.click(button);
}

describe('App rendering-mode transitions', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves logical selection and hands focus through a viewport-scale overview transition', async () => {
    render(<App initialWorkbook={workbookWithSheets([inputsSheet()])} />);
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const a1 = within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' });

    fireEvent.click(a1);
    a1.focus();
    zoomWorkspace('out', 6);

    await waitFor(() => expect(frame).toHaveAttribute('data-rendering-mode', 'overview'));
    expect(screen.queryByTestId('sheet-grid')).not.toBeInTheDocument();
    expect(screen.getByTestId('sheet-frame-body')).toHaveFocus();

    zoomWorkspace('in', 6);
    await waitFor(() => expect(frame).toHaveAttribute('data-rendering-mode', 'detailed'));
    expect(within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' })).toHaveAttribute('data-active-cell', 'true');
    await waitFor(() => expect(within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' })).toHaveFocus());
  });

  it('preserves a directional range and its active extent through settled overview', async () => {
    const user = userEvent.setup();
    render(<App initialWorkbook={workbookWithSheets([inputsSheet()])} />);
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const a1 = within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' });
    const b2 = within(frame).getByRole('cell', { name: 'Inputs B2 empty cell' });

    await user.click(b2);
    await user.keyboard('{Shift>}');
    await user.click(a1);
    await user.keyboard('{/Shift}');
    expect(a1).toHaveAttribute('data-active-cell', 'true');
    expect(b2).toHaveAttribute('data-reference-selected', 'true');

    zoomWorkspace('out', 6);
    await waitFor(() => expect(frame).toHaveAttribute('data-rendering-mode', 'overview'));
    expect(within(frame).queryByTestId('sheet-grid')).not.toBeInTheDocument();

    zoomWorkspace('in', 6);
    await waitFor(() => expect(frame).toHaveAttribute('data-rendering-mode', 'detailed'));
    expect(within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' })).toHaveAttribute('data-active-cell', 'true');
    expect(within(frame).getByRole('cell', { name: 'Inputs B2 empty cell' })).toHaveAttribute('data-reference-selected', 'true');
  });

  it('does not restore a stale overview focus request after another sheet takes ownership', async () => {
    render(<App initialWorkbook={workbookWithSheets([inputsSheet(), outputsSheet()])} />);
    const inputsFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const outputsFrame = screen.getByRole('article', { name: 'Sheet Outputs' });
    const inputsCell = within(inputsFrame).getByRole('cell', { name: 'Inputs A1 empty cell' });

    fireEvent.click(inputsCell);
    inputsCell.focus();
    zoomWorkspace('out', 6);
    await waitFor(() => expect(inputsFrame).toHaveAttribute('data-rendering-mode', 'overview'));
    expect(within(inputsFrame).getByTestId('sheet-frame-body')).toHaveFocus();

    fireEvent.click(within(outputsFrame).getByRole('button', { name: 'Select sheet Outputs overview' }));
    zoomWorkspace('in', 6);

    await waitFor(() => expect(inputsFrame).toHaveAttribute('data-rendering-mode', 'detailed'));
    expect(within(outputsFrame).getByRole('cell', { name: 'Outputs A1 empty cell' })).toHaveAttribute('data-active-cell', 'true');
    expect(within(inputsFrame).getByRole('cell', { name: 'Inputs A1 empty cell' })).not.toHaveFocus();
  });

  it('keeps a draft and the detailed owner mounted while a scale preview crosses the threshold', async () => {
    const user = userEvent.setup();
    render(<App initialWorkbook={workbookWithSheets([inputsSheet()])} />);
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const cell = within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' });
    const editor = await openCellEditor(user, cell);
    await user.type(editor, 'Uncommitted draft');

    fireEvent.change(scaleInput(), { target: { value: '30' } });

    expect(frame).toHaveAttribute('data-rendering-mode', 'detailed');
    expect(screen.getByTestId('sheet-grid')).toBeInTheDocument();
    expect(editor).toHaveValue('Uncommitted draft');
  });

  it('enters overview when a visual-scale input is committed', async () => {
    render(<App initialWorkbook={workbookWithSheets([inputsSheet()])} />);
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    fireEvent.click(within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' }));
    const input = scaleInput();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '30' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(frame).toHaveAttribute('data-rendering-mode', 'overview'));
    expect(screen.queryByTestId('sheet-grid')).not.toBeInTheDocument();
  });

  it('retains a frame drag until completion, then enters overview immediately with reduced motion', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    render(<App initialWorkbook={workbookWithSheets([inputsSheet()])} />);
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const header = screen.getByTestId('sheet-frame-header');
    fireEvent.click(within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' }));

    fireEvent.pointerDown(header, { button: 0, clientX: 100, clientY: 100 });
    zoomWorkspace('out', 6);
    expect(frame).toHaveAttribute('data-rendering-mode', 'detailed');

    fireEvent.pointerUp(header, { clientX: 100, clientY: 100 });
    await waitFor(() => expect(frame).toHaveAttribute('data-rendering-mode', 'overview'));
    expect(screen.queryByTestId('sheet-grid')).not.toBeInTheDocument();
  });

  it('retains a live frame interaction through zero-size culling, then releases its pin', async () => {
    render(<App initialWorkbook={workbookWithSheets([inputsSheet()])} />);
    const surface = screen.getByTestId('workspace-surface');
    const geometry = measuredElementGeometry(surface, { width: 800, height: 600 });
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const header = within(frame).getByTestId('sheet-frame-header');

    fireEvent.pointerDown(header, { button: 0, clientX: 100, clientY: 100 });
    act(() => { geometry.resize({ width: 0, height: 0 }); });
    expect(screen.getByRole('article', { name: 'Sheet Inputs' })).toBeInTheDocument();

    fireEvent.pointerUp(header, { clientX: 100, clientY: 100 });
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Sheet Inputs' })).not.toBeInTheDocument());
  });
});
