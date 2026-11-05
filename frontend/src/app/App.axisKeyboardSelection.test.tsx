import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { setSheetScale } from '@test-support/workspaceActions';
import { App } from './App';

function setup() {
  const sheet = sheetDocument({ id: 's', name: 'Inputs', rowCount: 5, columnCount: 4,
    cells: { A1: 'a', A2: 'b', A3: 'c', A4: 'd', A5: 'e', B1: 'B', C1: 'C', D1: 'D' } });
  render(<App initialWorkbook={workbookWithSheets([sheet])} />);
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  const cell = (key: string) => frame.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;
  const header = (mode: 'rowheader' | 'columnheader', index: number) =>
    within(frame).getAllByRole(mode).find((element) => element.getAttribute('data-axis-durable-index') === String(index))!;
  const rows = () => [1, 2, 3, 4, 5].map((row) => cell(`A${row}`).textContent);
  return { cell, header, rows };
}

it('shifts every row intersecting a rectangular selection via the shared shortcut', async () => {
  const user = userEvent.setup();
  const { cell, rows } = setup();
  await user.click(cell('A2'));
  await user.keyboard('{Shift>}');
  await user.click(cell('B3'));
  await user.keyboard('{/Shift}{Alt>}{Shift>}{ArrowDown}{/Shift}{/Alt}');
  expect(rows()).toEqual(['a', 'd', 'b', 'c', 'e']);
  expect(cell('B4')).toHaveFocus();
});

it('shifts scattered selected rows without gathering and rejects a boundary move', async () => {
  const user = userEvent.setup();
  const { header, rows } = setup();
  await user.click(header('rowheader', 1));
  await user.keyboard('{Control>}');
  await user.click(header('rowheader', 3));
  await user.keyboard('{/Control}{Alt>}{Shift>}{ArrowDown}{/Shift}{/Alt}');
  expect(rows()).toEqual(['a', 'c', 'b', 'e', 'd']);
  await user.keyboard('{Alt>}{Shift>}{ArrowDown}{/Shift}{/Alt}');
  expect(rows()).toEqual(['a', 'c', 'b', 'e', 'd']);
});

it('moves only the focused column when rows are explicitly selected', async () => {
  const user = userEvent.setup();
  const { cell, header } = setup();
  await user.click(cell('B2'));
  await user.click(header('rowheader', 1));
  await user.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}');
  expect(['A1', 'B1', 'C1', 'D1'].map((key) => cell(key).textContent)).toEqual(['B', 'a', 'C', 'D']);
});

it('does not reorder model-owned columns through the shared shortcut', async () => {
  const user = userEvent.setup();
  const sheet = sheetDocument({ id: 's', name: 'Inputs', rowCount: 2, columnCount: 2, cells: { A1: '1', B1: '2' } });
  const model = { id: 'model', name: 'Model', columns: [
    { id: 'a', name: 'First', kind: 'manual' as const, type: 'float' as const },
    { id: 'b', name: 'Second', kind: 'manual' as const, type: 'float' as const },
  ] };
  const bound = bindSheetToModel({ ...workbookWithSheets([sheet]), dataModels: { model } }, sheet.id, model.id, () => 'unused');
  if (!bound.ok) throw new Error(bound.reason);
  render(<App initialWorkbook={bound.value} />);
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  const cell = (key: string) => frame.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;
  await user.click(cell('A1'));
  await user.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}');
  expect(cell('A1')).toHaveTextContent('1');
  expect(cell('B1')).toHaveTextContent('2');
  expect(cell('A1')).toHaveFocus();
});

it('does not route shortcuts while the palette owns focus', async () => {
  const user = userEvent.setup();
  const { cell, rows } = setup();
  await user.click(cell('A1'));
  await user.keyboard('{Control>}{Shift>}p{/Shift}{/Control}');
  const dialog = screen.getByRole('dialog', { name: 'Command palette' });
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown', altKey: true, shiftKey: true });
  expect(dialog).toBeInTheDocument();
  expect(rows()).toEqual(['a', 'b', 'c', 'd', 'e']);
});

it('does not route from a model-entry editor or a model dialog', async () => {
  const user = userEvent.setup();
  const sheet = sheetDocument({ id: 's', name: 'Inputs', rowCount: 2, columnCount: 1, cells: { A1: '1', A2: '2' } });
  const model = { id: 'model', name: 'Model', columns: [
    { id: 'a', name: 'Amount', kind: 'manual' as const, type: 'float' as const },
  ] };
  const bound = bindSheetToModel({ ...workbookWithSheets([sheet]), dataModels: { model } }, sheet.id, model.id, () => 'unused');
  if (!bound.ok) throw new Error(bound.reason);
  render(<App initialWorkbook={bound.value} />);
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  const cell = (key: string) => frame.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;
  await user.click(cell('A1'));
  const entry = screen.getByRole('cell', { name: 'Amount new record' });
  entry.focus();
  fireEvent.keyDown(entry, { key: '3' });
  const editor = await screen.findByRole('textbox', { name: 'Inputs Amount editor' });
  fireEvent.keyDown(editor, { key: 'ArrowDown', altKey: true, shiftKey: true });
  expect(cell('A1')).toHaveTextContent('1');
  expect(cell('A2')).toHaveTextContent('2');
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Data models' }));
  await user.click(screen.getByRole('button', { name: 'Create model' }));
  const form = screen.getByRole('form', { name: 'Create data model' });
  const input = within(form).getByLabelText('Model name');
  input.focus();
  fireEvent.keyDown(input, { key: 'ArrowDown', altKey: true, shiftKey: true });
  expect(cell('A1')).toHaveTextContent('1');
  expect(cell('A2')).toHaveTextContent('2');
});

it('does not route while a miniature sheet awaits a native grid focus lease', async () => {
  const sheet = sheetDocument({ id: 's', name: 'Inputs', rowCount: 2, columnCount: 1,
    visualScale: 0.25, cells: { A1: 'first', A2: 'second' } });
  render(<App initialWorkbook={workbookWithSheets([sheet])} />);
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  expect(frame).toHaveAttribute('data-rendering-mode', 'overview');
  const header = within(frame).getByTestId('sheet-frame-header');
  const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: 100, clientY: 100 });
  Object.defineProperty(down, 'pointerId', { value: 17 });
  fireEvent(header, down);
  expect(within(frame).queryByTestId('sheet-grid')).not.toBeInTheDocument();
  fireEvent.keyDown(document.body, { key: 'ArrowDown', altKey: true, shiftKey: true });
  const up = new MouseEvent('pointerup', { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 100 });
  Object.defineProperty(up, 'pointerId', { value: 17 });
  fireEvent(header, up);
  setSheetScale(frame, 100);
  expect(frame.querySelector('[data-cell-key="A1"]')).toHaveTextContent('first');
  expect(frame.querySelector('[data-cell-key="A2"]')).toHaveTextContent('second');
});
