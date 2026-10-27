import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandNumberForm } from './CommandNumberForm';

describe('command number form', () => {
  it('validates required, bounded whole numbers and displays application failures until corrected', () => {
    const apply = vi.fn().mockReturnValueOnce('Cannot resize').mockReturnValueOnce(undefined);
    render(<CommandNumberForm fields={[{ label: 'Width', value: 2, min: 1, max: 10, integer: true }]} onApply={apply} />);
    const width = screen.getByLabelText('Width');
    const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    for (const value of ['', '1.5', '0', '11']) {
      fireEvent.change(width, { target: { value } });
      submit();
      expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid whole number');
      expect(apply).not.toHaveBeenCalled();
    }
    fireEvent.change(width, { target: { value: '4' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    submit();
    expect(apply).toHaveBeenCalledWith([4]);
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot resize');
    submit();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
