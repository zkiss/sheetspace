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
  pointer(within(frame).getByRole('button', { name: 'Drag row 1' }), 'pointerdown', 20, 30);
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
it('selects an unselected drag source through controlled ownership before moving it', async () => {
  const user = userEvent.setup();
  const sheet = sheetDocument({ id: 's', name: 'Inputs', rowCount: 4, columnCount: 2,
    cells: { A1: 'a', A2: 'b', A3: 'c', A4: 'd' } });
  render(<App initialWorkbook={workbookWithSheets([sheet])} />);
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  act(() => { virtualGridGeometry(within(frame).getByTestId('sheet-frame-body'), { height: 160, width: 240 }); });
  await user.click(within(frame).getAllByRole('rowheader')[0]);
  const grid = within(frame).getByTestId('sheet-grid');
  pointer(within(frame).getByRole('button', { name: 'Drag row 2' }), 'pointerdown', 20, 60);
  pointer(grid, 'pointermove', 20, 130); pointer(grid, 'pointerup', 20, 130);
  expect([1, 2, 3, 4].map((row) => frame.querySelector(`[data-cell-key="A${row}"]`)?.textContent)).toEqual(['a', 'c', 'd', 'b']);
  expect(within(frame).getAllByRole('rowheader')[3]).toHaveClass('sheet-grid-axis-selected');
  expect(frame.querySelector('[data-cell-key="A4"]')).toHaveFocus();
});
it('focuses an unselected source on a below-threshold release', async () => {
  const user = userEvent.setup();
  const sheet = sheetDocument({ id: 's', name: 'Inputs', rowCount: 4, columnCount: 2 });
  render(<App initialWorkbook={workbookWithSheets([sheet])} />);
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  act(() => { virtualGridGeometry(within(frame).getByTestId('sheet-frame-body'), { height: 160, width: 240 }); });
  await user.click(within(frame).getAllByRole('rowheader')[0]);
  pointer(within(frame).getByRole('button', { name: 'Drag row 2' }), 'pointerdown', 20, 60);
  pointer(within(frame).getByTestId('sheet-grid'), 'pointerup', 20, 60);
  expect(frame.querySelector('[data-cell-key="A2"]')).toHaveFocus();
});
it('cancels an unselected source gesture when another selection replaces its owner', async () => {
  const user = userEvent.setup();
  const sheet = sheetDocument({ id: 's', name: 'Inputs', rowCount: 4, columnCount: 2 });
  render(<App initialWorkbook={workbookWithSheets([sheet])} />);
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  act(() => { virtualGridGeometry(within(frame).getByTestId('sheet-frame-body'), { height: 160, width: 240 }); });
  await user.click(within(frame).getAllByRole('rowheader')[0]);
  const grid = within(frame).getByTestId('sheet-grid');
  pointer(within(frame).getByRole('button', { name: 'Drag row 2' }), 'pointerdown', 20, 60);
  await user.click(within(frame).getAllByRole('rowheader')[2]);
  pointer(grid, 'pointerup', 20, 130);
  expect(within(frame).getAllByRole('rowheader')[2]).toHaveClass('sheet-grid-axis-selected');
  expect(frame.querySelector('[data-cell-key="A3"]')).toHaveFocus();
});
