import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ColourPicker } from './ColourPicker';

it('contains rebound cancellation and returns focus without applying a colour', async () => {
  const { keymap } = await import('@shared/keyboard/keymap');
  const map = keymap as unknown as Record<string, import('@shared/keyboard/keymap').Binding>;
  const original = map.cancel; map.cancel = [{ key: 'q', alt: true }];
  try {
    const apply = vi.fn(), outer = vi.fn();
    render(<div onKeyDown={outer}><ColourPicker ariaLabel="Text colour" colour="#000000" customColours={[]} disabled={false}
      onApply={apply} onApplyInherited={vi.fn()} onApplyDefault={vi.fn()} defaultOptionLabel="Default"
      purpose="text" status="colour" descriptionId="description" localOverrideState="explicit" defaultOpen /></div>);
    const input = screen.getByLabelText('Custom colour');
    expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'q' })).toBe(true);
    outer.mockClear();
    expect(fireEvent.keyDown(input, { key: 'q', altKey: true })).toBe(false);
    expect(outer).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Text colour: #000000' })).toHaveFocus();
    expect(apply).not.toHaveBeenCalled();
  } finally { map.cancel = original; }
});
