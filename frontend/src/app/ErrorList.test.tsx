import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ErrorList } from './ErrorList';
import type { WorkbookError } from './workbookErrors';

const errors: WorkbookError[] = ['one', 'two'].map((key) => ({ key, sheetId: key, cell: { rowId: key, columnId: key }, reference: key, code: '#REF!', text: 'Invalid reference' }));
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { delete (Element.prototype as Partial<Element>).scrollIntoView; });

it('expands only the inspected trace in a large propagated chain', async () => {
  const user = userEvent.setup();
  const traces = Array.from({ length: 100 }, (_, index) => vi.fn(() => [
    { key: String(index), depth: 0, message: 'propagated' },
    ...Array.from({ length: index }, (_, cause) => ({ key: String(cause), depth: 1, message: 'cause' })),
  ]));
  const chain: WorkbookError[] = traces.map((trace, index) => ({
    key: String(index), sheetId: 'sheet', cell: { rowId: String(index), columnId: 'column' },
    reference: `cell${index}`, code: '#REF!', text: 'propagated', hasCauses: true, get trace() { return trace(); },
  }));
  const props = { errors: chain, focusRequest: 1, onClose: vi.fn(), onActivate: vi.fn() };
  const view = render(<ErrorList {...props} open={false} />);
  expect(traces.every((trace) => trace.mock.calls.length === 0)).toBe(true);
  view.rerender(<ErrorList {...props} open />);
  expect(traces.every((trace) => trace.mock.calls.length === 0)).toBe(true);
  await user.keyboard('{End}{F2}');
  expect(await screen.findByRole('textbox', { name: 'Errors Stack trace editor' })).toHaveValue('propagated');
  expect(traces[0]).toHaveBeenCalled();
  expect(traces.slice(1).every((trace) => trace.mock.calls.length === 0)).toBe(true);
});

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
  fireEvent.keyDown(reference, { key: 'ArrowDown' });
  expect(screen.getByRole('gridcell', { name: 'one' })).toHaveFocus();
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

it('clears a removed or changed hovered reference without clearing another cell’s hover', () => {
  const hover = vi.fn();
  const props = { errors, open: true, focusRequest: 1, onClose: vi.fn(), onActivate: vi.fn(), onReferenceHover: hover };
  const view = render(<ErrorList {...props} />);
  const first = screen.getByRole('gridcell', { name: 'one' }).querySelector('.error-list-reference')!;
  fireEvent.mouseEnter(first);
  view.rerender(<ErrorList {...props} errors={[errors[1]]} />);
  expect(hover).toHaveBeenLastCalledWith(null);

  const second = screen.getByRole('gridcell', { name: 'two' }).querySelector('.error-list-reference')!;
  fireEvent.mouseEnter(second);
  view.rerender(<ErrorList {...props} errors={[{ ...errors[1], reference: 'changed' }]} />);
  expect(hover).toHaveBeenLastCalledWith(null);

  view.rerender(<ErrorList {...props} />);
  fireEvent.mouseEnter(screen.getByRole('gridcell', { name: 'one' }).querySelector('.error-list-reference')!);
  const current = screen.getByRole('gridcell', { name: 'two' }).querySelector('.error-list-reference')!;
  fireEvent.mouseEnter(current);
  view.rerender(<ErrorList {...props} errors={[errors[1]]} />);
  expect(hover).toHaveBeenLastCalledWith(expect.objectContaining({ element: current }));
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
  await user.keyboard('{ArrowLeft}{ArrowRight}');
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

it('moves through the grid when committing a read-only inspection', async () => {
  const user = userEvent.setup();
  render(<ErrorList errors={errors} open focusRequest={1} onClose={vi.fn()} onActivate={vi.fn()} />);
  await user.keyboard('{ArrowRight}{Enter}');
  expect(await screen.findByRole('textbox', { name: 'Errors Error code editor' })).toHaveValue('#REF!');
  await user.keyboard('{Tab}');
  await waitFor(() => expect(screen.getAllByRole('gridcell', { name: 'Invalid reference' })[0]).toHaveFocus());
  await user.keyboard('{F2}{Enter}');
  await waitFor(() => expect(screen.getAllByRole('gridcell', { name: 'Invalid reference' })[1]).toHaveFocus());
  await user.keyboard('{F2}{Shift>}{Tab}{/Shift}');
  await waitFor(() => expect(screen.getAllByRole('gridcell', { name: '#REF!' })[1]).toHaveFocus());
});

it('clears hover on leaving a reference and navigates with the meta key', async () => {
  const user = userEvent.setup();
  const hover = vi.fn();
  const navigate = vi.fn();
  render(<ErrorList errors={errors} open focusRequest={1} onClose={vi.fn()} onActivate={vi.fn()} onNavigate={navigate} onReferenceHover={hover} />);
  const reference = screen.getByRole('gridcell', { name: 'one' }).querySelector('.error-list-reference')!;
  await user.hover(reference);
  await user.unhover(reference);
  expect(hover).toHaveBeenLastCalledWith(null);
  await user.keyboard('{Meta>}');
  await user.click(reference);
  await user.keyboard('{/Meta}');
  expect(navigate).toHaveBeenCalledWith({ sheetId: 'one', cell: errors[0].cell });
  await user.keyboard('{F2}{Escape}');
  expect(hover).toHaveBeenLastCalledWith(null);
});

it('follows and inspects with rebound shortcuts, derives hints, and closes with rebound cancel', async () => {
  const { keymap } = await import('@shared/keyboard/keymap');
  const map = keymap as unknown as Record<string, import('@shared/keyboard/keymap').Binding>;
  const original = { ...map };
  map['error-inspect'] = [{ key: 'i', alt: true }];
  map['error-follow'] = [{ key: 'f', alt: true }];
  map.cancel = [{ key: 'q', alt: true }];
  try {
    const activate = vi.fn(); const close = vi.fn();
    render(<ErrorList errors={errors} open focusRequest={1} onClose={close} onActivate={activate} />);
    expect(screen.getByText(/Alt\+I inspect/)).toHaveTextContent('Alt+F follow cell');
    expect(screen.getByTitle('Close errors (Alt+Q)')).toBeInTheDocument();
    const cell = screen.getByRole('gridcell', { name: 'one' });
    fireEvent.keyDown(cell, { key: 'F4' });
    expect(activate).not.toHaveBeenCalled();
    fireEvent.keyDown(cell, { key: 'f', altKey: true });
    expect(activate).toHaveBeenCalledWith(errors[0]);
    fireEvent.keyDown(cell, { key: 'i', altKey: true });
    expect(await screen.findByRole('textbox', { name: 'Errors Cell editor' })).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
  } finally { Object.assign(map, original); }
});

it('uses rebound follow to inspect cells with no navigable reference and rebound cancel to close', async () => {
  const { keymap } = await import('@shared/keyboard/keymap');
  const map = keymap as unknown as Record<string, import('@shared/keyboard/keymap').Binding>;
  const original = { ...map };
  map['error-follow'] = [{ key: 'f', alt: true }]; map.cancel = [{ key: 'q', alt: true }];
  try {
    const close = vi.fn(); const activate = vi.fn();
    render(<ErrorList errors={errors} open focusRequest={1} onClose={close} onActivate={activate} />);
    const cell = screen.getByRole('gridcell', { name: 'one' });
    fireEvent.keyDown(cell, { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getAllByRole('gridcell', { name: '#REF!' })[0], { key: 'f', altKey: true });
    expect(await screen.findByRole('textbox', { name: 'Errors Error code editor' })).toBeInTheDocument();
    expect(activate).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Errors Error code editor' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Errors Error code editor' })).not.toBeInTheDocument());
    fireEvent.keyDown(screen.getAllByRole('gridcell', { name: '#REF!' })[0], { key: 'q', altKey: true });
    expect(close).toHaveBeenCalledOnce();
  } finally { Object.assign(map, original); }
});
