import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { App } from './App';

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
