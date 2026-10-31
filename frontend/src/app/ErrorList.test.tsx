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

it('scrolls selection into view, clamps boundaries and falls back when a selected identity disappears', async () => {
  const user = userEvent.setup();
  const scroll = vi.fn();
  const previous = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = scroll;
  try {
    const activate = vi.fn();
    const props = { errors, open: true, focusRequest: 1, onClose: vi.fn(), onActivate: activate };
    const view = render(<ErrorList {...props} />);
    const list = screen.getByRole('grid', { name: 'Error list' });
    await user.keyboard('{ArrowUp}{ArrowDown}{ArrowDown}');
    expect(list).toHaveFocus();
    expect(screen.getByText('two').closest('tr')).toHaveAttribute('aria-selected', 'true');
    expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' });
    const replacement = { ...errors[1], key: 'replacement', cell: { rowId: 'new', columnId: 'new' } };
    view.rerender(<ErrorList {...props} errors={[errors[0], replacement]} />);
    await user.keyboard('{Enter}');
    expect(activate).toHaveBeenCalledWith(errors[0]);
    expect(activate).not.toHaveBeenCalledWith(replacement);
    expect(list).toHaveFocus();
  } finally {
    Element.prototype.scrollIntoView = previous;
  }
});
