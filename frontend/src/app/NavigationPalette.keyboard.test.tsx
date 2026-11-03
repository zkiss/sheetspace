import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NavigationPalette } from './NavigationPalette';

describe('command palette keyboard navigation', () => {
  it('skips unavailable commands and runs the next available command', () => {
    const run = vi.fn();
    render(<NavigationPalette onClose={vi.fn()} commands={[
      { id: 'first', label: 'First', run: vi.fn() },
      { id: 'disabled', label: 'Disabled', unavailable: 'Unavailable', run: vi.fn() },
      { id: 'last', label: 'Last', run },
    ]} />);
    const search = screen.getByLabelText('Command search');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(run).toHaveBeenCalledOnce();
    fireEvent.keyDown(search, { key: 'ArrowUp' });
    expect(search).toHaveAttribute('aria-activedescendant', 'navigation-command-first');
  });

  it('cycles focus in both directions and closes only when the backdrop itself is clicked', () => {
    const onClose = vi.fn();
    render(<NavigationPalette commands={[]} onClose={onClose} />);
    const search = screen.getByLabelText('Command search');
    const close = screen.getByRole('button', { name: 'Close command palette' });
    fireEvent.keyDown(search, { key: 'Tab', shiftKey: true });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(search).toHaveFocus();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('leaves panel keys to its controls while retaining focus cycling', () => {
    render(<NavigationPalette commands={[]} onClose={vi.fn()} panel={{ title: 'Details', content: <input aria-label="Details input" /> }} />);
    const input = screen.getByLabelText('Details input');
    expect(input).toHaveFocus();
    expect(fireEvent.keyDown(input, { key: 'ArrowDown' })).toBe(true);
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Close command palette' })).toHaveFocus();
  });

  it('scrolls the active command into view in either direction', () => {
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    rect.mockImplementation(function (this: Element) {
      if (this.getAttribute('role') === 'listbox') return { top: 10, bottom: 30 } as DOMRect;
      if (this.id === 'navigation-command-first') return { top: 0, bottom: 5 } as DOMRect;
      return { top: 35, bottom: 40 } as DOMRect;
    });
    try {
      render(<NavigationPalette onClose={vi.fn()} commands={[
        { id: 'first', label: 'First', run: vi.fn() },
        { id: 'second', label: 'Second', run: vi.fn() },
      ]} />);
      const list = screen.getByRole('listbox');
      expect(list.scrollTop).toBe(-10);
      fireEvent.keyDown(screen.getByLabelText('Command search'), { key: 'ArrowDown' });
      expect(list.scrollTop).toBe(0);
    } finally {
      rect.mockRestore();
    }
  });

  it('moves focus through intermediate controls without wrapping', () => {
    render(<NavigationPalette commands={[{ id: 'first', label: 'First', run: vi.fn() }]} onClose={vi.fn()} />);
    const search = screen.getByLabelText('Command search');
    const close = screen.getByRole('button', { name: 'Close command palette' });
    const command = screen.getByRole('button', { name: 'First' });
    fireEvent.keyDown(search, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(command).toHaveFocus();
    fireEvent.keyDown(command, { key: 'Tab', shiftKey: true });
    expect(close).toHaveFocus();
  });

  it('validates row input before navigating and leaves other row picker keys alone', () => {
    const onNavigate = vi.fn();
    render(<NavigationPalette commands={[]} onClose={vi.fn()} rowPicker={{ sheetName: 'Sheet', rowCount: 5, onNavigate }} />);
    const input = screen.getByLabelText('Row number');
    expect(fireEvent.keyDown(input, { key: 'ArrowDown' })).toBe(true);
    fireEvent.change(input, { target: { value: '6' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a row number from 1 to 5.');
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalledWith(3);
  });
});
