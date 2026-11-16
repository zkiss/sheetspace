import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { SheetSortingControls } from './SheetSortingControls';

it.each([1, 2])('keeps keyboard ownership after removing focused rule %s', async (removedRule) => {
  const user = userEvent.setup();
  const sheet = sheetDocument({ id: 's', name: 'Sheet', columnCount: 2 });
  const sorting = sheet.content.columns.map((columnId) => ({ columnId, direction: 'ascending' as const }));
  const result = { ok: true as const };
  const apply = vi.fn(() => ({ result, completion: Promise.resolve(result) }));
  const close = vi.fn();
  render(<SheetSortingControls sheet={{ ...sheet, sorting }} onApply={apply} onClose={close} />);

  await user.click(screen.getByRole('button', { name: `Remove sort rule ${removedRule}` }));

  expect(screen.getByLabelText('Column 1')).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByRole('button', { name: 'Apply' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(close).toHaveBeenCalledOnce();
  expect(apply).not.toHaveBeenCalled();
});

it('focuses Add after removing the final draft rule and cancels from the keyboard', async () => {
  const user = userEvent.setup();
  const sheet = sheetDocument({ id: 's', name: 'Sheet', columnCount: 1 });
  const result = { ok: true as const };
  const apply = vi.fn(() => ({ result, completion: Promise.resolve(result) }));
  const close = vi.fn();
  render(<SheetSortingControls sheet={sheet} onApply={apply} onClose={close} />);
  await user.click(screen.getByRole('button', { name: /Add another sort column/ }));

  await user.click(screen.getByRole('button', { name: 'Remove sort rule 1' }));

  expect(screen.getByRole('button', { name: /Add another sort column/ })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(close).toHaveBeenCalledOnce();
  expect(apply).not.toHaveBeenCalled();
});

it('returns focus to Add when clearing disables the focused Clear button', async () => {
  const user = userEvent.setup();
  const sheet = sheetDocument({ id: 's', name: 'Sheet', columnCount: 1 });
  const sorting = [{ columnId: sheet.content.columns[0]!, direction: 'ascending' as const }];
  const result = { ok: true as const };
  render(<SheetSortingControls sheet={{ ...sheet, sorting }} onApply={() => ({ result, completion: Promise.resolve(result) })} onClose={vi.fn()} />);

  await user.click(screen.getByRole('button', { name: 'Clear sort' }));

  expect(screen.getByRole('button', { name: /Add another sort column/ })).toHaveFocus();
});
