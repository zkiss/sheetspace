import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ErrorTrace } from './ErrorTrace';
import type { WorkbookError } from './workbookErrors';

it('navigates the header and selects and activates individual causal branches', async () => {
  const user = userEvent.setup();
  const navigate = vi.fn();
  const target = { sheetId: 'other', cell: { rowId: 'r', columnId: 'c' }, reference: '@Other!A[1]' };
  const error: WorkbookError = { key: 'a', sheetId: 's', cell: { rowId: 'r', columnId: 'c' }, reference: '@Sheet!A[1]', code: '#VALUE!', text: 'Invalid value', trace: [
    { key: '0', depth: 0, message: 'Propagated', target },
    { key: '0.0', depth: 1, message: 'Missing reference' },
    { key: '0.1', depth: 1, message: 'Invalid value', target },
  ] };
  render(<ErrorTrace error={error} onNavigate={navigate} />);
  await user.click(screen.getByRole('button', { name: '@Sheet!A[1]' }));
  expect(navigate).toHaveBeenCalledWith(error);
  await user.click(screen.getAllByRole('button', { name: '@Other!A[1]' })[0]);
  expect(navigate).toHaveBeenLastCalledWith(target);
  screen.getByRole('listbox').focus();
  await user.keyboard('{ArrowDown}{Enter}');
  expect(navigate).toHaveBeenCalledTimes(2);
  await user.keyboard('{ArrowDown}{F4}');
  expect(navigate).toHaveBeenLastCalledWith(target);
  expect(screen.getByText(/unresolved origin/)).toHaveTextContent('Missing reference');
});

it('falls back to the remaining cause when selection disappears and tolerates an empty trace', async () => {
  const user = userEvent.setup();
  const navigate = vi.fn();
  const target = { sheetId: 's', cell: { rowId: 'r', columnId: 'c' }, reference: '@Sheet!A[1]' };
  const error: WorkbookError = { key: 'a', ...target, code: '#REF!', text: 'Invalid reference', trace: [
    { key: '0', depth: 0, message: 'First', target },
    { key: '1', depth: 0, message: 'Second', target },
  ] };
  const { rerender } = render(<ErrorTrace error={error} onNavigate={navigate} />);
  screen.getByRole('listbox').focus();
  await user.keyboard('{ArrowDown}');
  expect(screen.getByText(/Second/)).toHaveAttribute('aria-selected', 'true');
  rerender(<ErrorTrace error={{ ...error, trace: error.trace?.slice(0, 1) }} onNavigate={navigate} />);
  expect(screen.getByText(/First/)).toHaveAttribute('aria-selected', 'true');
  await user.keyboard('{ArrowUp}{Enter}');
  expect(navigate).toHaveBeenCalledWith(target);
  rerender(<ErrorTrace error={{ ...error, trace: undefined }} onNavigate={navigate} />);
  await user.keyboard('{ArrowDown}{F4}');
  expect(navigate).toHaveBeenCalledTimes(1);
});
