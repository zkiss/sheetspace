import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ErrorList } from './ErrorList';
import type { WorkbookError } from './workbookErrors';

const errors: WorkbookError[] = ['one', 'two'].map((key) => ({ key, sheetId: key, cell: { rowId: key, columnId: key }, reference: key, code: '#REF!', text: 'Invalid reference' }));
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { delete (Element.prototype as Partial<Element>).scrollIntoView; });

it('focuses the selected cell, navigates and retains selection across reopening', async () => {
  const user = userEvent.setup();
  const activate = vi.fn();
  const props = { errors, open: true, focusRequest: 1, onClose: vi.fn(), onActivate: activate };
  const view = render(<ErrorList {...props} />);
  expect(screen.getByRole('gridcell', { name: 'one' })).toHaveFocus();
  await user.keyboard('{ArrowDown}{F4}');
  expect(activate).toHaveBeenCalledWith(errors[1]);
  view.rerender(<ErrorList {...props} open={false} />);
  view.rerender(<ErrorList {...props} focusRequest={2} />);
  await user.keyboard('{Enter}');
  expect(activate).toHaveBeenLastCalledWith(errors[1]);
  await user.click(screen.getByRole('gridcell', { name: 'one' }));
  await user.keyboard('{Enter}');
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
    await user.keyboard('{ArrowUp}{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('gridcell', { name: 'two' })).toHaveFocus();
    expect(screen.getByRole('gridcell', { name: 'two' })).toHaveAttribute('aria-selected', 'true');
    expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'nearest' });
    const replacement = { ...errors[1], key: 'replacement', cell: { rowId: 'new', columnId: 'new' } };
    view.rerender(<ErrorList {...props} errors={[errors[0], replacement]} />);
    await user.keyboard('{Enter}');
    expect(activate).toHaveBeenCalledWith(errors[0]);
    expect(activate).not.toHaveBeenCalledWith(replacement);
    expect(screen.getByRole('gridcell', { name: 'one' })).toHaveFocus();
  } finally {
    Element.prototype.scrollIntoView = previous;
  }
});

it('clears hovered references on close and follows modified clicks without closing', async () => {
  const user = userEvent.setup();
  const hover = vi.fn();
  const navigate = vi.fn();
  const close = vi.fn();
  const props = { errors, open: true, focusRequest: 1, onClose: close, onActivate: vi.fn(), onNavigate: navigate, onReferenceHover: hover };
  const view = render(<ErrorList {...props} />);
  const reference = screen.getByRole('gridcell', { name: 'one' }).querySelector('.error-list-reference')!;
  await user.hover(reference);
  expect(hover).toHaveBeenLastCalledWith(expect.objectContaining({ element: reference, reference: expect.objectContaining({ text: 'one' }) }));
  await user.keyboard('{Control>}');
  await user.click(reference);
  await user.keyboard('{/Control}');
  expect(navigate).toHaveBeenCalledWith({ sheetId: 'one', cell: errors[0].cell });
  expect(close).not.toHaveBeenCalled();
  view.rerender(<ErrorList {...props} open={false} />);
  expect(hover).toHaveBeenLastCalledWith(null);
});

it('inspects read-only cells in light and heavy modes and restores grid focus', async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  render(<ErrorList errors={errors} open focusRequest={1} onClose={close} onActivate={vi.fn()} />);
  await user.keyboard('{End}{F2}');
  const editor = await screen.findByRole('textbox', { name: 'Errors Stack trace editor' });
  expect(editor).toHaveValue('one: Invalid reference');
  await user.type(editor, 'changed');
  expect(editor).toHaveValue('one: Invalid reference');
  await user.keyboard('{F2}');
  expect(screen.getByRole('textbox', { name: 'Errors Stack trace editor' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(close).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByTitle('one: Invalid reference')).toHaveFocus());
  await user.keyboard('{Escape}');
  expect(close).toHaveBeenCalledOnce();
});

it('navigates columns with Tab, Home and End and toggles closed from the grid', async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  render(<ErrorList errors={errors} open focusRequest={1} onClose={close} onActivate={vi.fn()} />);
  await user.keyboard('{End}');
  expect(screen.getByTitle('one: Invalid reference')).toHaveFocus();
  await user.keyboard('{Tab}');
  expect(screen.getByRole('gridcell', { name: 'two' })).toHaveFocus();
  await user.keyboard('{Shift>}{Tab}{/Shift}');
  expect(screen.getByTitle('one: Invalid reference')).toHaveFocus();
  await user.keyboard('{Home}');
  expect(screen.getByRole('gridcell', { name: 'one' })).toHaveFocus();
  await user.keyboard('{Alt>}{Shift>}e{/Shift}{/Alt}');
  expect(close).toHaveBeenCalledOnce();
});
