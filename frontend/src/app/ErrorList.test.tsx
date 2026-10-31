import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ErrorList } from './ErrorList';
import type { WorkbookError } from './workbookErrors';

const errors: WorkbookError[] = ['one', 'two'].map((key) => ({ key, sheetId: key, cell: { rowId: key, columnId: key }, reference: key, code: '#REF!', text: 'Invalid reference' }));

it('focuses the list, moves selection, activates and retains it across reopening', async () => {
  const user = userEvent.setup();
  const activate = vi.fn();
  const props = { errors, open: true, focusRequest: 1, onClose: vi.fn(), onActivate: activate };
  const view = render(<ErrorList {...props} />);
  expect(screen.getByRole('grid', { name: 'Error list' })).toHaveFocus();
  await user.keyboard('{ArrowDown}{F4}');
  expect(activate).toHaveBeenCalledWith(errors[1]);
  view.rerender(<ErrorList {...props} open={false} />);
  view.rerender(<ErrorList {...props} focusRequest={2} />);
  await user.keyboard('{Enter}');
  expect(activate).toHaveBeenLastCalledWith(errors[1]);
  await user.click(screen.getByText('one'));
  expect(activate).toHaveBeenLastCalledWith(errors[0]);
  view.rerender(<ErrorList {...props} errors={[]} />);
  await user.keyboard('{ArrowDown}{Enter}');
  expect(screen.getByText('No workbook errors.')).toBeInTheDocument();
});
