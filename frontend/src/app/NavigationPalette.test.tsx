import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NavigationPalette } from './NavigationPalette';

describe('NavigationPalette', () => {
  it('filters labelled commands, skips unavailable results, and supports keyboard selection and cancellation', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    const close = vi.fn();
    render(<NavigationPalette commands={[
      { id: 'one', group: 'Cell usages — Direct usages', label: 'Go to Alpha', shortcut: 'Alt+A', run },
      { id: 'two', label: 'Go to unavailable', unavailable: 'Missing target', run },
    ]} onClose={close} />);

    const search = screen.getByLabelText('Command search');
    await user.type(search, 'alpha');
    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}');
    expect(run).toHaveBeenCalledOnce();
    expect(screen.getByText('Alt+A')).toBeInTheDocument();
    expect(screen.getByText('Cell usages — Direct usages')).toBeInTheDocument();
    await user.clear(search);
    await user.keyboard('{ArrowDown}{Enter}{Escape}');
    expect(close).toHaveBeenCalledOnce();
    await user.type(search, 'nothing');
    expect(screen.getByText('No commands found.')).toBeInTheDocument();
  });

  it('keeps Tab focus inside the command dialog', async () => {
    const user = userEvent.setup();
    render(<NavigationPalette commands={[{ id: 'one', label: 'Go to Alpha', run: vi.fn() }]} onClose={vi.fn()} />);

    const search = screen.getByLabelText('Command search');
    expect(search).toHaveFocus();
    await user.keyboard('{Tab}');
    expect(screen.getByRole('button', { name: 'Go to Alpha' })).toHaveFocus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(search).toHaveFocus();
  });

  it('exposes the active command through combobox semantics', () => {
    render(<NavigationPalette commands={[{ id: 'alpha', label: 'Go to Alpha', run: vi.fn() }]} onClose={vi.fn()} />);

    const search = screen.getByRole('combobox', { name: 'Command search' });
    expect(search).toHaveAttribute('aria-expanded', 'true');
    expect(search).toHaveAttribute('aria-controls', 'navigation-command-results');
    expect(search).toHaveAttribute('aria-activedescendant', 'navigation-command-alpha');
    expect(screen.getByRole('option', { name: 'Go to Alpha' })).toHaveAttribute('id', 'navigation-command-alpha');
  });
});
