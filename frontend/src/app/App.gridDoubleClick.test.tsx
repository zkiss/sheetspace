import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import { autosaveClient } from '@test-support/apiClients';
import { virtualGridGeometry } from '@test-support/domGeometry';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { App } from './App';

function pointer(element: Element, type: string, x: number) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 40 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(element, event);
}

function doubleClickCell(cell: HTMLElement, x: number) {
  const grid = screen.getByTestId('sheet-grid');
  for (let i = 0; i < 2; i++) {
    pointer(cell, 'pointerdown', x);
    pointer(grid, 'pointerup', x);
  }
  fireEvent.doubleClick(grid, { clientX: x, clientY: 40 });
}

function setup(calculated = false) {
  const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', rowCount: 2, columnCount: 2, cells: { B1: '3' } });
  let workbook = workbookWithSheets([sheet]);
  if (calculated) {
    const model = { id: 'model', name: 'Model', columns: [
      { id: 'total', name: 'Total', kind: 'calculated' as const, type: 'float' as const, formula: '=SUM(@B[1]) * 2' },
      { id: 'input', name: 'Input', kind: 'manual' as const, type: 'float' as const },
    ] };
    const bound = bindSheetToModel({ ...workbook, dataModels: { model } }, sheet.id, model.id, () => 'unused-column');
    if (!bound.ok) throw new Error(bound.reason);
    workbook = bound.value;
  }
  const api = autosaveClient();
  render(<App initialWorkbook={workbook} apiClient={api} />);
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  virtualGridGeometry(within(frame).getByTestId('sheet-frame-body'));
  const cell = (key: string) => frame.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;
  return { api, cell };
}

describe('grid-retargeted double click editing', () => {
  it.each([
    ['A1', 50, '', false], ['A1', 50, '', true],
    ['B1', 130, '3', false], ['B1', 130, '3', true],
  ])('opens %s with its light editor and focus (x: %s, value: %s, selected: %s)', (key, x, value, selected) => {
    const { cell } = setup();
    if (selected) fireEvent.click(cell(key));
    doubleClickCell(cell(key), x);
    const editors = screen.getAllByRole('textbox', { name: `Inputs ${key} editor` });
    expect(editors).toHaveLength(1);
    expect(editors[0]).toHaveValue(value);
    expect(editors[0]).toHaveFocus();
    expect(editors[0].closest('.formula-editor-panel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
    expect((editors[0] as HTMLTextAreaElement).selectionStart).toBe(value.length);
  });

  it('opens a calculated cell for read-only inspection without writing', () => {
    const { api, cell } = setup(true);
    doubleClickCell(cell('A1'), 50);
    const editor = screen.getByRole('textbox', { name: 'Inputs A1 editor' });
    expect(editor).toHaveFocus();
    expect(editor).toHaveValue('=SUM(@B[1]) * 2');
    expect(editor).toHaveAttribute('aria-readonly', 'true');
    fireEvent.change(editor, { target: { value: '=999' } });
    expect(editor).toHaveValue('=SUM(@B[1]) * 2');
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(api.writeCells).not.toHaveBeenCalled();
    expect(cell('A1')).toHaveTextContent('6');
  });
});
