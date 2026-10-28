import { FormulaEditorPanel } from '@application/react/FormulaEditorPanel';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SheetGridCellEditor } from './SheetGridCellEditor';

it('allows selection and mode switching while blocking mutations of a calculated formula', () => {
  const anchor = { current: document.createElement('div') };
  const interaction = { FormulaEditor: FormulaEditorPanel, cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() };
  render(<SheetGridCellEditor anchor={anchor} cellKey="A1" sheetName="Inputs" interaction={interaction}
    editingCell={{ target: { sheetId: 'inputs', cell: { rowId: 'row', columnId: 'column' } }, draft: '=1+2', sessionId: 1, readOnly: true }} />);
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  expect(input).toHaveAttribute('aria-readonly', 'true');
  expect(input).not.toHaveAttribute('readonly');
  input.setSelectionRange(1, 3);
  fireEvent.keyDown(input, { key: 'F2' });
  expect(screen.getByRole('textbox')).toBe(input);
  expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
  expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
  for (const event of [createEvent.paste(input), createEvent.cut(input), createEvent.drop(input)]) {
    fireEvent(input, event);
    expect(event.defaultPrevented).toBe(true);
  }
  fireEvent.change(input, { target: { value: 'changed' } });
  expect(interaction.updateValue).not.toHaveBeenCalled();
  expect(interaction.commit).not.toHaveBeenCalled();
});
