import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { virtualGridGeometry } from '@test-support/domGeometry';
import { App } from './App';
import { controlledAxisAnimations } from '@test-support/controlledAxisAnimations';
import { autosaveClient } from '@test-support/apiClients';

let animation: ReturnType<typeof controlledAxisAnimations>;
beforeEach(() => { animation = controlledAxisAnimations(); });
afterEach(() => { cleanup(); animation.restore(); });
function pointer(element: Element, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: 8 });
  fireEvent(element, event);
}
it('routes a scattered header drag through the controller while retaining logical selection', async () => {
  const user = userEvent.setup();
  const sheet = sheetDocument({ id: 's', name: 'Inputs', rowCount: 4, columnCount: 2,
    cells: { A1: 'a', A2: 'b', A3: 'c', A4: 'd' } });
  let persisted = sheet;
  const save = vi.fn(async (_id: string, axis: 'row' | 'column', order: readonly string[], revision: number) => {
    persisted = { ...persisted, revision: revision + 1, content: { ...persisted.content, [axis === 'row' ? 'rows' : 'columns']: [...order] } };
    return structuredClone(persisted);
  });
  const api = autosaveClient({ writeAxisOrder: save, loadSheet: vi.fn(async () => structuredClone(persisted)) });
  render(<App initialWorkbook={workbookWithSheets([sheet])} apiClient={api} />);
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  const body = within(frame).getByTestId('sheet-frame-body');
  act(() => { virtualGridGeometry(body, { height: 160, width: 240 }); });
  const headers = () => within(frame).getAllByRole('rowheader');
  await user.click(headers()[0]);
  await user.keyboard('{Control>}'); await user.click(headers()[2]); await user.keyboard('{/Control}');
  const grid = within(frame).getByTestId('sheet-grid');
  pointer(within(frame).getAllByRole('rowheader')[0], 'pointerdown', 20, 30);
  pointer(grid, 'pointermove', 20, 130); pointer(grid, 'pointerup', 20, 130);
  const values = [1, 2, 3, 4].map((row) => frame.querySelector(`[data-cell-key="A${row}"]`)?.textContent);
  expect(values).toEqual(['b', 'd', 'a', 'c']);
  expect(headers()[2]).toHaveClass('sheet-grid-axis-selected');
  expect(headers()[3]).toHaveClass('sheet-grid-axis-selected');
  expect(frame.querySelector('[data-cell-key="A3"]')).toHaveFocus();
  const travel = [...animation.effects];
  expect(travel.filter((effect) => effect.frames[0].transform !== 'translateY(0px)')).toHaveLength(4);
  expect(travel.find((effect) => (effect.element as HTMLElement).dataset.motionRow === sheet.content.rows[0])?.frames[0].transform).toBe('translateY(-52.8px)');
  const scatteredSource = travel.find((effect) => (effect.element as HTMLElement).dataset.motionRow === sheet.content.rows[2])!;
  expect(Number.parseFloat(String(scatteredSource.frames[0].transform).replace('translateY(', ''))).toBeCloseTo(-26.4);
  expect(travel.every((effect) => effect.cancel.mock.calls.length === 0)).toBe(true);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenLastCalledWith('s', 'row', [sheet.content.rows[1], sheet.content.rows[3], sheet.content.rows[0], sheet.content.rows[2]], expect.any(Number));
  await user.keyboard('{Alt>}{Shift>}{ArrowUp}{/Shift}{/Alt}');
  expect([1, 2, 3, 4].map((row) => frame.querySelector(`[data-cell-key="A${row}"]`)?.textContent)).toEqual(['b', 'a', 'c', 'd']);
  expect(animation.effects.length).toBeGreaterThan(travel.length);
  expect(travel.every((effect) => effect.cancel.mock.calls.length > 0)).toBe(true);
  const afterShift = animation.effects.length;
  await user.keyboard('{Control>}z{/Control}');
  expect([1, 2, 3, 4].map((row) => frame.querySelector(`[data-cell-key="A${row}"]`)?.textContent)).toEqual(['b', 'd', 'a', 'c']);
  expect(animation.effects.length).toBeGreaterThan(afterShift);
  const afterUndo = animation.effects.length;
  await user.keyboard('{Control>}y{/Control}');
  expect([1, 2, 3, 4].map((row) => frame.querySelector(`[data-cell-key="A${row}"]`)?.textContent)).toEqual(['b', 'a', 'c', 'd']);
  expect(animation.effects.length).toBeGreaterThan(afterUndo);
});
it.each(['row', 'column'] as const)('animates an unselected %s drag and its displaced neighbors after owned settlement', async (axis) => {
  const user = userEvent.setup();
  const row = axis === 'row';
  const sheet = sheetDocument({ id: 's', name: 'Inputs', rowCount: 4, columnCount: 4,
    cells: row ? { A1: 'a', A2: 'b', A3: 'c', A4: 'd' } : { A1: 'a', B1: 'b', C1: 'c', D1: 'd' } });
  render(<App initialWorkbook={workbookWithSheets([sheet])} />);
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  act(() => { virtualGridGeometry(within(frame).getByTestId('sheet-frame-body'), { height: 160, width: 600 }); });
  const headers = () => within(frame).getAllByRole(row ? 'rowheader' : 'columnheader').filter((header) => header.hasAttribute('data-axis-durable-index'));
  await user.click(headers()[0]);
  const grid = within(frame).getByTestId('sheet-grid');
  pointer(headers()[1], 'pointerdown', row ? 20 : 200, row ? 60 : 10);
  pointer(grid, 'pointermove', row ? 20 : 340, row ? 130 : 10);
  pointer(grid, 'pointerup', row ? 20 : 340, row ? 130 : 10);
  const keys = row ? ['A1', 'A2', 'A3', 'A4'] : ['A1', 'B1', 'C1', 'D1'];
  expect(keys.map((key) => frame.querySelector(`[data-cell-key="${key}"]`)?.textContent)).toEqual(['a', 'c', 'd', 'b']);
  expect(headers()[3]).toHaveClass('sheet-grid-axis-selected');
  expect(frame.querySelector(`[data-cell-key="${keys[3]}"]`)).toHaveFocus();
  const ids = row ? sheet.content.rows : sheet.content.columns;
  const attribute = row ? 'motionRow' : 'motionColumn';
  for (const index of [1, 2, 3]) {
    const effects = animation.effects.filter((effect) => (effect.element as HTMLElement).dataset[attribute] === ids[index]);
    expect(effects.length).toBeGreaterThan(0);
    const delta = Number.parseFloat(String(effects[0].frames[0].transform).replace(`translate${row ? 'Y' : 'X'}(`, ''));
    expect(delta).toBeCloseTo((row ? 26.4 : 76) * (index === 1 ? -2 : 1));
    expect(effects.every((effect) => effect.frames[0].transform === effects[0].frames[0].transform)).toBe(true);
    expect(effects.every((effect) => effect.cancel.mock.calls.length === 0)).toBe(true);
  }
});
it('focuses an unselected source on a below-threshold release', async () => {
  const user = userEvent.setup();
  const sheet = sheetDocument({ id: 's', name: 'Inputs', rowCount: 4, columnCount: 2 });
  render(<App initialWorkbook={workbookWithSheets([sheet])} />);
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  act(() => { virtualGridGeometry(within(frame).getByTestId('sheet-frame-body'), { height: 160, width: 240 }); });
  await user.click(within(frame).getAllByRole('rowheader')[0]);
  pointer(within(frame).getAllByRole('rowheader')[1], 'pointerdown', 20, 60);
  pointer(within(frame).getByTestId('sheet-grid'), 'pointerup', 20, 60);
  expect(frame.querySelector('[data-cell-key="A2"]')).toHaveFocus();
});
it.each(['row', 'column'] as const)('cancels an unselected %s source without travel when another selection replaces its owner', async (axis) => {
  const user = userEvent.setup();
  const row = axis === 'row';
  const sheet = sheetDocument({ id: 's', name: 'Inputs', rowCount: 4, columnCount: 4,
    cells: { A1: 'a', A2: 'b', A3: 'c', A4: 'd', B1: 'e', C1: 'f', D1: 'g' } });
  render(<App initialWorkbook={workbookWithSheets([sheet])} />);
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  act(() => { virtualGridGeometry(within(frame).getByTestId('sheet-frame-body'), { height: 160, width: 600 }); });
  const headers = () => within(frame).getAllByRole(row ? 'rowheader' : 'columnheader').filter((header) => header.hasAttribute('data-axis-durable-index'));
  await user.click(headers()[0]);
  const grid = within(frame).getByTestId('sheet-grid');
  pointer(headers()[1], 'pointerdown', row ? 20 : 200, row ? 60 : 10);
  await user.click(headers()[2]);
  pointer(grid, 'pointerup', row ? 20 : 340, row ? 130 : 10);
  expect(headers()[2]).toHaveClass('sheet-grid-axis-selected');
  expect(frame.querySelector(`[data-cell-key="${row ? 'A3' : 'C1'}"]`)).toHaveFocus();
  expect(['A1', 'A2', 'A3', 'A4', 'B1', 'C1', 'D1'].map((key) => frame.querySelector(`[data-cell-key="${key}"]`)?.textContent)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  expect(animation.effects).toHaveLength(0);
});
