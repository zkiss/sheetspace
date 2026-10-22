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
      { id: 'one', label: 'Go to Alpha', shortcut: 'Alt+A', run },
      { id: 'two', label: 'Go to unavailable', unavailable: 'Missing target', run },
    ]} onClose={close} />);

    const search = screen.getByLabelText('Command search');
    await user.type(search, 'alpha');
    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}');
    expect(run).toHaveBeenCalledOnce();
    expect(screen.getByText('Alt+A')).toBeInTheDocument();
    await user.clear(search);
    await user.keyboard('{ArrowDown}{Enter}{Escape}');
    expect(close).toHaveBeenCalledOnce();
    await user.type(search, 'nothing');
    expect(screen.getByText('No commands found.')).toBeInTheDocument();
  });
});
