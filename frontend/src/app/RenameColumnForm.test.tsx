import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RenameColumnForm } from './RenameColumnForm';

describe('rename column form', () => {
  it('focuses the name, retains the draft on failure and prevents duplicate submissions', async () => {
    let resolve!: (error: string) => void;
    const apply = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    render(<RenameColumnForm target={{ kind: 'ordinary', sheetId: 's', columnId: 'c' }} initialName="Old" onApply={apply} onCancel={vi.fn()} />);
    const input = screen.getByLabelText('Column name');
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'New' } });
    fireEvent.submit(input.closest('form')!);
    fireEvent.submit(input.closest('form')!);
    expect(apply).toHaveBeenCalledTimes(1);
    resolve('Name already exists');
    await screen.findByRole('alert');
    expect(input).toHaveValue('New');
    expect(screen.getByRole('alert')).toHaveTextContent('Name already exists');
    expect(input).toHaveFocus();
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, 'Another{Enter}');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(apply).toHaveBeenLastCalledWith('Another');
  });

  it('requires consent before editing a shared property and allows cancellation', async () => {
    const cancel = vi.fn();
    const target = { kind: 'property' as const, sheetId: 's', columnId: 'c', modelId: 'm', modelName: 'Model', propertyId: 'p', propertyName: 'Price' };
    const { unmount } = render(<RenameColumnForm target={target} initialName="Price" onApply={vi.fn()} onCancel={cancel} />);
    expect(screen.getByText(/all sheets bound to the model/)).toHaveTextContent('Model');
    expect(screen.queryByLabelText('Column name')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancel).toHaveBeenCalledOnce();
    unmount();
    render(<RenameColumnForm target={target} initialName="Price" onApply={vi.fn()} onCancel={cancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByLabelText('Column name')).toHaveFocus());
  });
});
