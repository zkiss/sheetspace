import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { SheetSortingControls } from './SheetSortingControls';

it('edits ordered distinct criteria as one command and closes after saving', async () => {
  const sheet = sheetDocument({ id: 's', name: 'Sheet', columnCount: 2 });
  const result = { ok: true as const };
  const apply = vi.fn(() => ({ result, completion: Promise.resolve(result) }));
  const close = vi.fn();
  render(<SheetSortingControls sheet={sheet} onApply={apply} onClose={close} />);
  fireEvent.click(screen.getByRole('button', { name: /Add another sort column/ }));
  expect(screen.getByRole('button', { name: 'Move sort rule 1 up' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /Add another sort column/ }));
  expect(screen.getByRole('button', { name: /Add another sort column/ })).toBeDisabled();
  expect(within(screen.getByLabelText('Column 1')).queryByRole('option', { name: 'B' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Sort order 2'), { target: { value: 'descending' } });
  fireEvent.click(screen.getByRole('button', { name: 'Move sort rule 2 up' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(apply).toHaveBeenCalledWith('s', [{ columnId: 's:column:2', direction: 'descending' }, { columnId: 's:column:1', direction: 'ascending' }]);
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});

it('cancels drafts and clears only on apply while reflecting renamed and deleted columns', () => {
  const sheet = sheetDocument({ id: 's', name: 'Sheet', columnCount: 2 });
  const sorted = { ...sheet, sorting: [{ columnId: sheet.content.columns[0]!, direction: 'ascending' as const }] };
  const result = { ok: true as const };
  const apply = vi.fn(() => ({ result, completion: Promise.resolve(result) }));
  const close = vi.fn();
  const { unmount } = render(<SheetSortingControls sheet={sorted} onApply={apply} onClose={close} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove sort rule 1' }));
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'Sort Sheet' }), { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
  expect(apply).not.toHaveBeenCalled();
  unmount();
  const view = render(<SheetSortingControls sheet={{ ...sorted, columnNames: { [sheet.content.columns[0]!]: 'Price' } }} onApply={apply} onClose={close} />);
  expect(screen.getByLabelText('Column 1')).toHaveTextContent('Price');
  fireEvent.click(screen.getByRole('button', { name: 'Clear sort' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(apply).toHaveBeenCalledWith('s', []);
  view.unmount();
  render(<SheetSortingControls sheet={{ ...sorted, content: { ...sheet.content, columns: [] } }} onApply={apply} onClose={close} />);
  expect(screen.getByText(/No sorting applied/)).toBeInTheDocument();
});

it('shows rejection and pending feedback without losing the draft', async () => {
  const sheet = sheetDocument({ id: 's', name: 'Sheet', columnCount: 1 });
  let finish!: (result: { ok: false; reason: string }) => void;
  const rejected = { ok: false as const, reason: 'pending-model-transition' };
  const apply = vi.fn().mockReturnValueOnce({ result: rejected, completion: Promise.resolve(rejected) })
    .mockReturnValueOnce({ result: { ok: true }, completion: new Promise((resolve) => { finish = resolve; }) })
    .mockReturnValueOnce({ result: rejected, completion: Promise.resolve(rejected) });
  const close = vi.fn();
  render(<SheetSortingControls sheet={sheet} onApply={apply} onClose={close} />);
  expect(screen.getByRole('button', { name: /Add another sort column/ })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: /Add another sort column/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(screen.getByRole('alert')).toHaveTextContent('could not be applied');
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(screen.getByRole('status')).toHaveTextContent('Saving');
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
  finish({ ok: false, reason: 'persistence-failed' });
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not be saved'));
  expect(screen.getByLabelText('Column 1')).toHaveValue('s:column:1');
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(apply).toHaveBeenLastCalledWith('s', [{ columnId: 's:column:1', direction: 'ascending' }]);
});

it('keeps keyboard focus on the column selector when its value changes', async () => {
  const user = userEvent.setup();
  const sheet = sheetDocument({ id: 's', name: 'Sheet', columnCount: 2 });
  const result = { ok: true as const };
  render(<SheetSortingControls sheet={sheet} onApply={() => ({ result, completion: Promise.resolve(result) })} onClose={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /Add another sort column/ }));
  const column = screen.getByLabelText('Column 1');
  column.focus();
  await user.selectOptions(column, 's:column:2');
  expect(column).toHaveFocus();
  expect(column).toHaveValue('s:column:2');
  await user.tab();
  expect(screen.getByLabelText('Sort order 1')).toHaveFocus();
});

it.each([
  ['sorting-history-too-large', 'too large to undo'],
  ['invalid-sorting', 'Cancel and reopen'],
  ['blocked-persistence-prerequisite', 'earlier save failure'],
  ['pending-axis-creation', 'pending row or column'],
] as const)('explains %s whether rejected immediately or during settlement', async (reason, message) => {
  const sheet = sheetDocument({ id: 's', name: 'Sheet', columnCount: 1 });
  const failure = { ok: false as const, reason };
  const apply = vi.fn().mockReturnValueOnce({ result: failure, completion: Promise.resolve(failure) })
    .mockReturnValueOnce({ result: { ok: true }, completion: Promise.resolve(failure) });
  render(<SheetSortingControls sheet={sheet} onApply={apply} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(screen.getByRole('alert')).toHaveTextContent(message);
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
});
