import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SheetDialog } from './SheetDialogs';

describe('shared sheet dialog cancellation ownership', () => {
  it.each(['name', 'cancel', 'submit', 'form'])('owns Escape from the %s without submitting or leaking it', (target) => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    const outerKeyDown = vi.fn();
    render(<div onKeyDown={outerKeyDown}>
      <SheetDialog error="Invalid name" id="name" label="Sheet dialog" name="Draft"
        onCancel={onCancel} onNameChange={vi.fn()} onSubmit={onSubmit} submitLabel="Save" title="Sheet dialog" />
    </div>);
    const control = target === 'name' ? screen.getByRole('textbox')
      : target === 'form' ? screen.getByRole('form')
        : screen.getByRole('button', { name: target === 'cancel' ? 'Cancel' : 'Save' });
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    fireEvent(control, event);
    expect(event.defaultPrevented).toBe(true);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(outerKeyDown).not.toHaveBeenCalled();
  });

  it('leaves ordinary name input keys alone and shares cancellation with the Cancel button', () => {
    const onCancel = vi.fn();
    const onNameChange = vi.fn();
    render(<SheetDialog error="" id="name" label="Sheet dialog" name=""
      onCancel={onCancel} onNameChange={onNameChange} onSubmit={vi.fn()} submitLabel="Save" title="Sheet dialog" />);
    expect(fireEvent.keyDown(screen.getByRole('textbox'), { key: 'n' })).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Name' } });
    expect(onNameChange).toHaveBeenCalledWith('Name');
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

it('uses the rebound cancel chord without consuming the old key or ordinary typing', async () => {
  const { keymap } = await import('@shared/keyboard/keymap');
  const map = keymap as unknown as Record<string, import('@shared/keyboard/keymap').Binding>;
  const original = map.cancel;
  map.cancel = [{ key: 'q', alt: true }];
  try {
    const onCancel = vi.fn();
    render(<SheetDialog error="" id="name" label="Sheet dialog" name="" onCancel={onCancel}
      onNameChange={vi.fn()} onSubmit={vi.fn()} submitLabel="Save" title="Sheet dialog" />);
    const input = screen.getByRole('textbox');
    expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'q' })).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(input, { key: 'q', altKey: true })).toBe(false);
    expect(onCancel).toHaveBeenCalledOnce();
  } finally { map.cancel = original; }
});
