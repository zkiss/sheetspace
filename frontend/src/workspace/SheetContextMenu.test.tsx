import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { SheetContextMenu } from './SheetContextMenu';

describe('context-menu percentage scaling', () => {
  it('preserves fractional percentages and resets the draft when the sheet changes', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', visualScale: 0.1234 });
    const onSetScale = vi.fn();
    const props = { menu: { sheetId: sheet.id, x: 10, y: 20 }, sheet, onSetScale,
      onAppendColumn: vi.fn(), onAppendRow: vi.fn(), onChangeZOrder: vi.fn(), onDelete: vi.fn(), onRename: vi.fn() };
    const { rerender } = render(<SheetContextMenu {...props} />);
    const input = screen.getByRole('spinbutton', { name: 'Display scale percentage' });
    expect(input).toHaveValue(12.34);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSetScale).toHaveBeenCalledWith('inputs', 0.1234);
    fireEvent.change(input, { target: { value: '150' } });
    rerender(<SheetContextMenu {...props} sheet={sheetDocument({ id: 'outputs', name: 'Outputs', visualScale: 2 })} />);
    expect(input).toHaveValue(200);
  });

  it('rejects empty and nonpositive percentages and clamps valid extreme values before applying', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs' });
    const onSetScale = vi.fn();
    render(<SheetContextMenu menu={{ sheetId: sheet.id, x: 0, y: 0 }} sheet={sheet} onSetScale={onSetScale}
      onAppendColumn={vi.fn()} onAppendRow={vi.fn()} onChangeZOrder={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} />);
    const input = screen.getByRole('spinbutton', { name: 'Display scale percentage' });
    const button = screen.getByRole('button', { name: 'Set scale' });
    for (const value of ['', '0', '-1']) {
      fireEvent.change(input, { target: { value } }); fireEvent.click(button);
    }
    expect(onSetScale).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '9999' } }); fireEvent.click(button);
    expect(onSetScale).toHaveBeenLastCalledWith('inputs', 8);
    fireEvent.change(input, { target: { value: '0.1' } }); fireEvent.click(button);
    expect(onSetScale).toHaveBeenLastCalledWith('inputs', 0.1);
  });
});
