import { FormulaEditorPanel } from '@application/react/FormulaEditorPanel';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SheetGridCell } from './SheetGridCell';
import { cellTargetAt } from './cellInteraction';
import { sheetDocument } from '@test-support/workbookFactories';
import { tabularProjection } from '@workbook/read/queries';
import * as queries from '@workbook/read/queries';

afterEach(cleanup);
function setup() {
  const sheet = tabularProjection(sheetDocument({ id: 'inputs', name: 'Inputs' }));
  const commands = () => ({ clear: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn(), extend: vi.fn(), navigateKeyboard: vi.fn(() => true) });
  const editor = () => ({ FormulaEditor: FormulaEditorPanel, cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() });
  const props = { cellKey: 'A1', columnIndex: 1, displayText: 'Value', editingCell: null, isActive: true, isEditing: false, cellInteraction: commands(), editorInteraction: editor(), registerCell: vi.fn(), onNativeFocusTarget: vi.fn(), sheet, style: { width: 80 } };
  return { ...render(<SheetGridCell {...props} />), props, commands, editor, target: cellTargetAt(sheet, 'A1')! };
}
it('uses replacement commands and focus callbacks without reattaching an unchanged cell', () => {
  const rawContent = vi.spyOn(queries, 'cellRawContent');
  const { props, commands, target, rerender, unmount } = setup();
  const renderReads = rawContent.mock.calls.length;
  const cell = screen.getByRole('cell');
  const next = commands();
  const onNativeFocusTarget = vi.fn();
  rerender(<SheetGridCell {...props} cellInteraction={next} onNativeFocusTarget={onNativeFocusTarget} style={{ width: 80 }} />);
  expect(rawContent).toHaveBeenCalledTimes(renderReads);
  expect(props.registerCell).toHaveBeenCalledTimes(1);
  fireEvent.focus(cell);
  fireEvent.click(cell, { detail: 0 });
  fireEvent.click(cell, { detail: 0, shiftKey: true });
  fireEvent.keyDown(cell, { key: 'ArrowRight' });
  fireEvent.keyDown(cell, { key: 'Backspace' });
  fireEvent.keyDown(cell, { key: 'F2' });
  expect(onNativeFocusTarget).toHaveBeenCalledWith(target);
  expect(next.select).toHaveBeenCalledWith(target);
  expect(next.extend).toHaveBeenCalledWith(target);
  expect(next.navigateKeyboard).toHaveBeenCalledWith(target, expect.objectContaining({ key: 'ArrowRight' }));
  expect(next.clear).toHaveBeenCalledWith(target);
  expect(next.startEditing).toHaveBeenCalledWith(target, undefined);
  expect(props.cellInteraction.select).not.toHaveBeenCalled();
  unmount();
  expect(props.registerCell).toHaveBeenLastCalledWith('A1', null);
  rawContent.mockRestore();
});
it('updates presentation and registration when their inputs change', () => {
  const { props, rerender } = setup();
  const registerCell = vi.fn();
  rerender(<SheetGridCell {...props} displayText="Changed" isActive={false} isRangeSelected style={{ width: 100 }} registerCell={registerCell} />);
  const cell = screen.getByRole('cell');
  expect(cell).toHaveTextContent('Changed');
  expect(cell).toHaveAttribute('aria-selected', 'true');
  expect(cell).not.toHaveAttribute('data-active-cell');
  expect(cell).toHaveStyle({ width: '100px' });
  expect(props.registerCell).toHaveBeenLastCalledWith('A1', null);
  expect(registerCell).toHaveBeenCalledWith('A1', cell);
});
it('updates the live editor when its interaction changes', () => {
  const { props, target, editor, rerender } = setup();
  const editingCell = { target, draft: 'Draft', sessionId: 1 };
  const first = editor();
  const next = editor();
  rerender(<SheetGridCell {...props} editingCell={editingCell} isEditing editorInteraction={first} />);
  const input = screen.getByRole('textbox');
  rerender(<SheetGridCell {...props} editingCell={editingCell} isEditing editorInteraction={next} />);
  fireEvent.change(input, { target: { value: 'New' } });
  expect(next.updateValue).toHaveBeenCalledWith('New', editingCell);
  expect(first.updateValue).not.toHaveBeenCalled();
});
