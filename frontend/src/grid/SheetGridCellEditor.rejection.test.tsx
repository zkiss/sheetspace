import { FormulaEditorPanel } from '@application/react/FormulaEditorPanel';
import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellTargetAt } from './cellInteraction';
import { SheetGridCellEditor } from './SheetGridCellEditor';
import { useCellEditing } from './useCellEditing';
import { useWorkbookController } from '@application/react/useWorkbookController';
import { cellRawContent } from '@workbook/read/queries';

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
  expect(editor).toHaveAccessibleDescription('(Alt+↑) Enter a valid date as YYYY-MM-DD.');
  fireEvent.change(editor, { target: { value: '2026-02-28' } });
  expect(editor).not.toHaveAttribute('aria-invalid');
  fireEvent.keyDown(editor, { key: 'Tab' });
  expect(updateCellContent).toHaveBeenLastCalledWith('inputs', 'A1', '2026-02-28', 'date');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

it('writes a selected date through the real editing session and workbook controller', () => {
  const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '"2024-02-29"' } });
  const workbook = workbookWithSheets([sheet]);
  function Harness() {
    const anchor = useRef<HTMLButtonElement>(null);
    const controller = useWorkbookController({ initialWorkbook: workbook });
    const editing = useCellEditing({ commands: controller.commands, workbook: controller.workbook });
    const currentSheet = controller.workbook.documents.inputs;
    return <><button ref={anchor} onClick={() => editing.startEditingCell(cellTargetAt(currentSheet, 'A1')!)}>Edit</button>
      <output data-testid="raw">{cellRawContent(currentSheet, 'A1')}</output>
      {editing.editingCell && <SheetGridCellEditor anchor={anchor} cellKey="A1" sheetName="Inputs" editingCell={editing.editingCell} interaction={{
        FormulaEditor: FormulaEditorPanel, cancel: editing.cancelActiveEdit, commit: editing.commitActiveEdit,
        commitAndNavigate: editing.commitEditAndNavigate, updateValue: editing.updateEditingCellValue, updateMode: editing.updateEditingCellMode,
      }} />}</>;
  }
  render(<Harness />);
  fireEvent.click(screen.getByText('Edit'));
  expect(screen.getByRole('combobox', { name: 'Input type' })).toHaveValue('text');
  fireEvent.change(screen.getByRole('combobox', { name: 'Input type' }), { target: { value: 'date' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(screen.getByTestId('raw')).toHaveTextContent('@date:2024-02-29');
  fireEvent.click(screen.getByText('Edit'));
  expect(screen.getByRole('combobox', { name: 'Input type' })).toHaveValue('date');
  expect(screen.getByRole('textbox')).toHaveValue('2024-02-29');
  const picker = screen.getByLabelText('Choose date');
  fireEvent.blur(screen.getByRole('textbox'), { relatedTarget: picker });
  fireEvent.change(picker, { target: { value: '2025-03-01' } });
  expect(screen.getByRole('textbox')).toHaveValue('2025-03-01');
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(screen.getByTestId('raw')).toHaveTextContent('@date:2025-03-01');
});

it('preserves a precise datetime through picker mounting, focus, and cancel', () => {
  const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '@datetime:2024-02-29 12:34:00.123456789' } });
  const workbook = workbookWithSheets([sheet]);
  function Harness() {
    const anchor = useRef<HTMLButtonElement>(null);
    const controller = useWorkbookController({ initialWorkbook: workbook });
    const editing = useCellEditing({ commands: controller.commands, workbook: controller.workbook });
    const currentSheet = controller.workbook.documents.inputs;
    return <><button ref={anchor} onClick={() => editing.startEditingCell(cellTargetAt(currentSheet, 'A1')!)}>Edit</button>
      <output data-testid="raw">{cellRawContent(currentSheet, 'A1')}</output>
      {editing.editingCell && <SheetGridCellEditor anchor={anchor} cellKey="A1" sheetName="Inputs" editingCell={editing.editingCell} interaction={{
        FormulaEditor: FormulaEditorPanel, cancel: editing.cancelActiveEdit, commit: editing.commitActiveEdit,
        commitAndNavigate: editing.commitEditAndNavigate, updateValue: editing.updateEditingCellValue, updateMode: editing.updateEditingCellMode,
      }} />}</>;
  }
  render(<Harness />);
  fireEvent.click(screen.getByText('Edit'));
  const editor = screen.getByRole('textbox');
  const picker = screen.getByLabelText('Choose date and time');
  expect(editor).toHaveValue('2024-02-29 12:34:00.123456789');
  expect(picker).toHaveValue('');
  expect(screen.getByText('Exact value is in the text above.')).toBeInTheDocument();
  fireEvent.blur(editor, { relatedTarget: picker });
  fireEvent.keyDown(editor, { key: 'Escape' });
  expect(screen.getByTestId('raw')).toHaveTextContent('@datetime:2024-02-29 12:34:00.123456789');
  fireEvent.click(screen.getByText('Edit'));
  expect(screen.getByRole('textbox')).toHaveValue('2024-02-29 12:34:00.123456789');
});

it('retains an invalid draft across mode changes and picker keyboard focus', () => {
  const sheet = sheetDocument({ id: 'inputs', name: 'Inputs' });
  const workbook = workbookWithSheets([sheet]);
  const updateCellContent = vi.fn().mockReturnValue({ ok: true, changed: true });
  function Harness() {
    const anchor = useRef<HTMLButtonElement>(null);
    const editing = useCellEditing({ commands: { updateCellContent, writeCells: vi.fn() }, workbook });
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
  fireEvent.change(editor, { target: { value: '2024-02-30 12:' } });
  fireEvent.change(selector, { target: { value: 'datetime' } });
  const picker = screen.getByLabelText('Choose date and time');
  expect(picker).toHaveValue('');
  fireEvent.blur(editor, { relatedTarget: picker });
  fireEvent.keyDown(picker, { key: 'Enter' });
  fireEvent.keyDown(picker, { key: 'Tab' });
  expect(updateCellContent).not.toHaveBeenCalled();
  fireEvent.change(selector, { target: { value: 'text' } });
  fireEvent.change(selector, { target: { value: 'datetime' } });
  expect(editor).toHaveValue('2024-02-30 12:');
  fireEvent.change(screen.getByLabelText('Choose date and time'), { target: { value: '2024-02-29T12:30' } });
  expect(editor).toHaveValue('2024-02-29 12:30');
  fireEvent.keyDown(editor, { key: 'Enter' });
  expect(updateCellContent).toHaveBeenCalledWith('inputs', 'A1', '2024-02-29 12:30', 'datetime');
});
