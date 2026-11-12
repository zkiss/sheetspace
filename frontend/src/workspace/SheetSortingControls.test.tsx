import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { SheetSortingControls } from './SheetSortingControls';

it('edits ordered distinct criteria as one command and restores focus', async () => {
  const sheet = sheetDocument({ id: 's', name: 'Sheet', columnCount: 2 });
  const result = { ok: true as const, value: workbookWithSheets([sheet]), changed: true };
  const apply = vi.fn(() => ({ result, completion: Promise.resolve(result) }));
  render(<SheetSortingControls sheet={sheet} onApply={apply} />);
  const open = screen.getByRole('menuitem', { name: 'Sorting…' });
  fireEvent.click(open);
  fireEvent.click(screen.getByRole('button', { name: 'Add criterion' }));
  expect(screen.getByRole('button', { name: 'Move up 1' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Add criterion' }));
  expect(screen.getByRole('button', { name: 'Add criterion' })).toBeDisabled();
  expect(within(screen.getByLabelText('Column 1')).queryByRole('option', { name: 'B' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Direction 2'), { target: { value: 'descending' } });
  fireEvent.click(screen.getByRole('button', { name: 'Move up 2' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply sorting' }));
  expect(apply).toHaveBeenCalledWith('s', [{ columnId: 's:column:2', direction: 'descending' }, { columnId: 's:column:1', direction: 'ascending' }]);
  await waitFor(() => expect(open).toHaveFocus());
});

it('cancels drafts and clears only on apply while reflecting renamed and deleted columns', async () => {
  const sheet = sheetDocument({ id: 's', name: 'Sheet', columnCount: 2 });
  const sorted = { ...sheet, sorting: [{ columnId: sheet.content.columns[0]!, direction: 'ascending' as const }] };
  const result = { ok: true as const, value: workbookWithSheets([sheet]), changed: true };
  const apply = vi.fn(() => ({ result, completion: Promise.resolve(result) }));
  const { rerender } = render(<SheetSortingControls sheet={sorted} onApply={apply} />);
  expect(screen.getByLabelText('Active sorting')).toHaveTextContent('A (ascending)');
  fireEvent.click(screen.getByRole('menuitem', { name: 'Sorting…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove 1' }));
  fireEvent.keyDown(screen.getByRole('group', { name: 'Sorting for Sheet' }), { key: 'Escape' });
  expect(apply).not.toHaveBeenCalled();
  rerender(<SheetSortingControls sheet={{ ...sorted, columnNames: { [sheet.content.columns[0]!]: 'Price' } }} onApply={apply} />);
  expect(screen.getByLabelText('Active sorting')).toHaveTextContent('Price');
  fireEvent.click(screen.getByRole('menuitem', { name: 'Sorting…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear sorting' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply sorting' }));
  expect(apply).toHaveBeenCalledWith('s', []);
  await waitFor(() => expect(screen.queryByRole('group')).not.toBeInTheDocument());
  rerender(<SheetSortingControls sheet={{ ...sorted, content: { ...sheet.content, columns: [] } }} onApply={apply} />);
  expect(screen.getByLabelText('Active sorting')).toHaveTextContent('Sorting off');
});

it('shows rejection and pending feedback without losing the draft', async () => {
  const sheet = sheetDocument({ id: 's', name: 'Sheet', columnCount: 1 });
  let finish!: (result: { ok: false; reason: string }) => void;
  const rejected = { ok: false as const, reason: 'pending-model-transition' };
  const apply = vi.fn().mockReturnValueOnce({ result: rejected, completion: Promise.resolve(rejected) })
    .mockReturnValueOnce({ result: { ok: true }, completion: new Promise((resolve) => { finish = resolve; }) });
  render(<SheetSortingControls sheet={sheet} onApply={apply} />);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Sorting…' }));
  expect(screen.getByRole('button', { name: 'Add criterion' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Add criterion' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply sorting' }));
  expect(screen.getByRole('alert')).toHaveTextContent('could not be applied');
  fireEvent.click(screen.getByRole('button', { name: 'Apply sorting' }));
  expect(screen.getByRole('status')).toHaveTextContent('Saving');
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  finish({ ok: false, reason: 'persistence-failed' });
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not be saved'));
  expect(screen.getByLabelText('Column 1')).toHaveValue('s:column:1');
});


it('keeps keyboard focus on the column selector when its value changes', async () => {
  const user = userEvent.setup();
  const sheet = sheetDocument({ id: 's', name: 'Sheet', columnCount: 2 });
  const result = { ok: true as const };
  render(<SheetSortingControls sheet={sheet} onApply={() => ({ result, completion: Promise.resolve(result) })} />);
  await user.click(screen.getByRole('menuitem', { name: 'Sorting…' }));
  await user.click(screen.getByRole('button', { name: 'Add criterion' }));
  const column = screen.getByLabelText('Column 1');
  column.focus();
  await user.selectOptions(column, 's:column:2');
  expect(column).toHaveFocus();
  expect(column).toHaveValue('s:column:2');
  await user.tab();
  expect(screen.getByLabelText('Direction 1')).toHaveFocus();
});
