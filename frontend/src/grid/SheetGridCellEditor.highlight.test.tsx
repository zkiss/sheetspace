import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SheetGridCellEditor } from './SheetGridCellEditor';

it.each(['Revenue', '123', 'hello world', '  text\nwith whitespace  '])('keeps ordinary draft %j neutral while still marking unfinished formulas', (draft) => {
  const anchor = { current: document.createElement('div') };
  const interaction = { cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() };
  const component = (value: string) => <SheetGridCellEditor anchor={anchor} cellKey="A1" sheetName="Inputs"
    interaction={interaction}
    editingCell={{ target: { sheetId: 'inputs', cell: { rowId: 'r1', columnId: 'c1' } }, draft: value, sessionId: 1 }} />;
  const view = render(component(draft));
  const editor = screen.getByRole('textbox');
  const overlay = document.querySelector('.formula-editor-highlight')!;

  expect(editor).toHaveValue(draft);
  expect(overlay.textContent).toBe(`${draft}\u200b`);
  expect(overlay.querySelector('.formula-syntax-token-invalid')).toBeNull();
  expect(overlay.querySelector('.formula-syntax-token-invalid')).toBeNull();
  expect(editor).toHaveFocus();

  const unfinished = "=SUM(@'Revenue'[";
  view.rerender(component(unfinished));

  expect(screen.getByRole('textbox')).toBe(editor);
  expect(editor).toHaveValue(unfinished);
  expect(overlay.textContent).toBe(`${unfinished}\u200b`);
  expect(overlay.querySelector('.formula-syntax-token-invalid')).not.toBeNull();
  expect(editor).toHaveFocus();
});
