import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { virtualGridGeometry } from '@test-support/domGeometry';
import { GRID_CELL_HEIGHT, GRID_COLUMN_HEADER_HEIGHT } from '../grid/gridGeometry';
import { App } from './App';

it('retains native focus through DOM moves for repeated row and column shifts and history', async () => {
  const user = userEvent.setup();
  const sheet = sheetDocument({ id: 's', name: 'Inputs', rowCount: 3, columnCount: 3, cells: { A1: 'moving' } });
  render(<App initialWorkbook={workbookWithSheets([sheet])} />);
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  const cell = (key: string) => frame.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;
  await user.click(cell('A1'));
  const insertBefore = Node.prototype.insertBefore;
  let focusLosses = 0;
  const spy = vi.spyOn(Node.prototype, 'insertBefore').mockImplementation(function (this: Node, node, child) {
    if (node.contains(document.activeElement) && document.activeElement instanceof HTMLElement) {
      focusLosses++;
      document.activeElement.blur();
    }
    return insertBefore.call(this, node, child);
  });
  try {
    await user.keyboard('{Alt>}{Shift>}{ArrowDown}{ArrowDown}{ArrowRight}{ArrowRight}{/Shift}{/Alt}');
    expect(cell('C3')).toHaveTextContent('moving');
    expect(cell('C3')).toHaveFocus();
    await user.keyboard('{Control>}z{/Control}');
    expect(cell('B3')).toHaveFocus();
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(cell('C3')).toHaveFocus();
    expect(focusLosses).toBeGreaterThan(0);
  } finally {
    spy.mockRestore();
  }
});

it('reveals the focused identity after an off-viewport reorder and history replay', async () => {
  const user = userEvent.setup();
  const sheet = sheetDocument({ id: 's', name: 'Inputs', rowCount: 12, columnCount: 2, cells: { A2: 'moving' } });
  render(<App initialWorkbook={workbookWithSheets([sheet])} />);
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  const body = within(frame).getByTestId('sheet-frame-body');
  act(() => { virtualGridGeometry(body, { width: 200, height: 80 }); });
  const cell = (key: string) => frame.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;
  await user.click(cell('A2'));
  await user.keyboard('{Alt>}{Shift>}{ArrowDown}{ArrowDown}{ArrowDown}{/Shift}{/Alt}');
  await waitFor(() => expect(body.scrollTop).toBeGreaterThan(0));
  expect(cell('A5')).toHaveTextContent('moving');
  expect(cell('A5')).toHaveFocus();
  const expectRowVisible = (row: number) => {
    const top = GRID_COLUMN_HEADER_HEIGHT + (row - 1) * GRID_CELL_HEIGHT - body.scrollTop;
    expect(top).toBeGreaterThanOrEqual(GRID_COLUMN_HEADER_HEIGHT);
    expect(top + GRID_CELL_HEIGHT).toBeLessThanOrEqual(body.clientHeight);
  };
  act(() => { body.scrollTop = 240; fireEvent.scroll(body); });
  expect(GRID_COLUMN_HEADER_HEIGHT + 3 * GRID_CELL_HEIGHT - body.scrollTop).toBeLessThan(GRID_COLUMN_HEADER_HEIGHT);
  await user.keyboard('{Control>}z{/Control}');
  expect(cell('A4')).toHaveTextContent('moving');
  expect(cell('A4')).toHaveFocus();
  await waitFor(() => expectRowVisible(4));
  act(() => { body.scrollTop = 0; fireEvent.scroll(body); });
  expect(GRID_COLUMN_HEADER_HEIGHT + 5 * GRID_CELL_HEIGHT).toBeGreaterThan(body.clientHeight);
  await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
  expect(cell('A5')).toHaveTextContent('moving');
  expect(cell('A5')).toHaveFocus();
  await waitFor(() => expectRowVisible(5));
});

it('returns focus to the moved cell after a palette reorder', async () => {
  const user = userEvent.setup();
  const sheet = sheetDocument({ id: 's', name: 'Inputs', rowCount: 3, columnCount: 1, cells: { A1: 'moving' } });
  render(<App initialWorkbook={workbookWithSheets([sheet])} />);
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  const cell = (key: string) => frame.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;
  await user.click(cell('A1'));
  await user.keyboard('{Control>}{Shift>}p{/Shift}{/Control}');
  await user.click(screen.getByRole('button', { name: /Move rows down/ }));
  expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  expect(cell('A2')).toHaveTextContent('moving');
  await waitFor(() => expect(cell('A2')).toHaveFocus());
  await user.keyboard('{Alt>}{Shift>}{ArrowDown}{/Shift}{/Alt}');
  expect(cell('A3')).toHaveTextContent('moving');
});

it('routes repeated native shortcuts through reorder history without restoring an older selection', async () => {
  const user = userEvent.setup();
  const sheet = sheetDocument({ id: 's', name: 'Inputs', rowCount: 3, columnCount: 2, cells: { A1: 'first', A2: 'second', A3: 'third' } });
  render(<App initialWorkbook={workbookWithSheets([sheet])} />);
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  const cell = (key: string) => frame.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;
  await user.click(cell('A1'));
  await user.keyboard('{Alt>}{Shift>}{ArrowDown}{ArrowDown}{/Shift}{/Alt}');
  expect(cell('A3')).toHaveTextContent('first');
  expect(cell('A3')).toHaveAttribute('data-active-cell', 'true');
  expect(cell('A3')).toHaveFocus();
  await user.keyboard('{Control>}z{/Control}');
  expect(cell('A2')).toHaveTextContent('first');
  expect(cell('A2')).toHaveFocus();
  await user.click(cell('B1'));
  await user.keyboard('{Control>}z{/Control}');
  expect(cell('A1')).toHaveTextContent('first');
  expect(cell('B2')).toHaveAttribute('data-active-cell', 'true');
  await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
  expect(cell('A2')).toHaveTextContent('first');
  expect(cell('B1')).toHaveAttribute('data-active-cell', 'true');
  expect(within(frame).getByRole('table', { name: 'Inputs grid' })).toBeInTheDocument();
});

it('does not route reorder shortcuts from an editor or an inactive sheet', async () => {
  const user = userEvent.setup();
  const inputs = sheetDocument({ id: 's', name: 'Inputs', rowCount: 2, columnCount: 1, cells: { A1: 'first', A2: 'second' } });
  const other = sheetDocument({ id: 'other', name: 'Other', rowCount: 2, columnCount: 1 });
  render(<App initialWorkbook={workbookWithSheets([inputs, other])} />);
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  const cell = (key: string) => frame.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;
  await user.click(cell('A1'));
  await user.keyboard('{F2}');
  const editor = screen.getByRole('textbox', { name: 'Inputs A1 editor' });
  fireEvent.keyDown(editor, { key: 'ArrowDown', altKey: true, shiftKey: true });
  expect(cell('A2')).toHaveTextContent('second');
  await user.keyboard('{Escape}');
  await user.click(within(screen.getByRole('article', { name: 'Sheet Other' })).getByRole('cell', { name: 'Other A1 empty cell' }));
  fireEvent.keyDown(cell('A1'), { key: 'ArrowDown', altKey: true, shiftKey: true });
  expect(cell('A1')).toHaveTextContent('first');
  expect(cell('A2')).toHaveTextContent('second');
});
