import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { App } from './App';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

it('keeps focus aligned through navigation, range extension, collapse and editing cancellation', async () => {
  const user = userEvent.setup();
  const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', columnCount: 3, rowCount: 3 });
  render(<App initialWorkbook={workbookWithSheets([sheet])} />);
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  const cell = (key: string) => within(frame).getByRole('cell', { name: `Inputs ${key} empty cell` });
  await user.click(cell('A1'));
  await user.keyboard('{ArrowRight}{ArrowDown}');
  expect(cell('B2')).toHaveFocus();
  expect(cell('B2')).toHaveAttribute('data-active-cell', 'true');
  await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
  expect(cell('B3')).toHaveFocus();
  expect(cell('B3')).toHaveAttribute('aria-selected', 'true');
  await user.keyboard('{ArrowUp}');
  expect(cell('B2')).toHaveFocus();
  expect(cell('B2')).toHaveAttribute('data-active-cell', 'true');
  expect(cell('B3')).not.toHaveAttribute('aria-selected');
  await user.keyboard('{F2}discard');
  expect(screen.getByRole('textbox', { name: 'Inputs B2 editor' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(cell('B2')).toHaveFocus();
  expect(cell('B2')).toHaveAttribute('data-active-cell', 'true');
});
