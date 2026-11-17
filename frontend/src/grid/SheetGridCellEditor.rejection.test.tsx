import { FormulaEditorPanel } from '@application/react/FormulaEditorPanel';
import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellTargetAt } from './cellInteraction';
import { SheetGridCellEditor } from './SheetGridCellEditor';
import { useCellEditing } from './useCellEditing';

it('retains and retries a shared cell draft rejected during a model transition', () => {
  const sheet = sheetDocument({ id: 'inputs', name: 'Inputs' });
  const workbook = workbookWithSheets([sheet]);
  const updateCellContent = vi.fn().mockReturnValueOnce({ ok: false, reason: 'pending-model-transition' }).mockReturnValueOnce({ ok: true, changed: true });
  const commands = { updateCellContent, writeCells: vi.fn() };
  function Harness() {
    const anchor = useRef<HTMLButtonElement>(null);
    const editing = useCellEditing({ commands, workbook });
    return <><button ref={anchor} onClick={() => editing.startEditingCell(cellTargetAt(sheet, 'A1')!)}>Edit</button>
      {editing.editingCell && <SheetGridCellEditor anchor={anchor} cellKey="A1" sheetName="Inputs" editingCell={editing.editingCell} interaction={{
        FormulaEditor: FormulaEditorPanel, cancel: editing.cancelActiveEdit, commit: editing.commitActiveEdit,
        commitAndNavigate: editing.commitEditAndNavigate, updateValue: editing.updateEditingCellValue,
      }} />}</>;
  }
  render(<Harness />);
  fireEvent.click(screen.getByText('Edit'));
  const editor = screen.getByRole('textbox');
  fireEvent.change(editor, { target: { value: '=draft' } });
  fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
  expect(updateCellContent).toHaveBeenCalledWith('inputs', 'A1', '=draft');
  expect(screen.getByRole('textbox')).toHaveValue('=draft');
  fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
  expect(updateCellContent).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

it('selects a cell input type, retains invalid input and commits the corrected typed draft', () => {
  const sheet = sheetDocument({ id: 'inputs', name: 'Inputs' });
  const workbook = workbookWithSheets([sheet]);
  const updateCellContent = vi.fn().mockReturnValueOnce({ ok: false, reason: 'invalid-input', message: 'Enter a valid date as YYYY-MM-DD.' }).mockReturnValueOnce({ ok: true, changed: true });
  const commands = { updateCellContent, writeCells: vi.fn() };
  function Harness() {
    const anchor = useRef<HTMLButtonElement>(null);
    const editing = useCellEditing({ commands, workbook });
    return <><button ref={anchor} onClick={() => editing.startEditingCell(cellTargetAt(sheet, 'A1')!)}>Edit</button>
      {editing.editingCell && <SheetGridCellEditor anchor={anchor} cellKey="A1" sheetName="Inputs" editingCell={editing.editingCell} interaction={{
        FormulaEditor: FormulaEditorPanel, cancel: editing.cancelActiveEdit, commit: editing.commitActiveEdit,
        commitAndNavigate: editing.commitEditAndNavigate, updateValue: editing.updateEditingCellValue, updateMode: editing.updateEditingCellMode,
      }} />}</>;
  }
  render(<Harness />);
  fireEvent.click(screen.getByText('Edit'));
  const editor = screen.getByRole('textbox');
  const selector = screen.getByRole('combobox', { name: 'Input type' });
  fireEvent.change(editor, { target: { value: '2026-02-30' } });
  fireEvent.blur(editor, { relatedTarget: selector });
  fireEvent.change(selector, { target: { value: 'date' } });
  expect(editor).toHaveValue('2026-02-30');
  expect(updateCellContent).not.toHaveBeenCalled();
  fireEvent.keyDown(editor, { key: 'Enter' });
  expect(updateCellContent).toHaveBeenCalledWith('inputs', 'A1', '2026-02-30', 'date');
  expect(editor).toHaveAttribute('aria-invalid', 'true');
  expect(editor).toHaveAccessibleDescription('Enter a valid date as YYYY-MM-DD.');
  fireEvent.change(editor, { target: { value: '2026-02-28' } });
  expect(editor).not.toHaveAttribute('aria-invalid');
  fireEvent.keyDown(editor, { key: 'Tab' });
  expect(updateCellContent).toHaveBeenLastCalledWith('inputs', 'A1', '2026-02-28', 'date');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});
