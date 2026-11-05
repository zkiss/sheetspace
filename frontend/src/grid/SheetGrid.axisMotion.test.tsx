import { createRef, type ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormulaEditorPanel } from '@application/react/FormulaEditorPanel';
import { smallSheetDocument } from '@test-support/workbookFactories';
import { controlledAxisAnimations } from '@test-support/controlledAxisAnimations';
import { virtualGridGeometry } from '@test-support/domGeometry';
import { tabularProjection } from '@workbook/read/queries';
import { projectGridAxes } from './gridAxisProjection';
import { SheetGrid } from './SheetGrid';

let animation: ReturnType<typeof controlledAxisAnimations>;
let reduced = false;
let preferenceChanged: () => void;
beforeEach(() => {
  animation = controlledAxisAnimations(); reduced = false;
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced; },
    addEventListener: (_: string, callback: () => void) => { preferenceChanged = callback; }, removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); animation.restore(); vi.unstubAllGlobals(); });

function setup(large = false) {
  const original = tabularProjection(smallSheetDocument({ id: 'motion', name: 'Motion' }));
  const sheet = large ? { ...original, rows: Array.from({ length: 1000 }, (_, i) => `r${i}`), columns: Array.from({ length: 1000 }, (_, i) => `c${i}`) } : original;
  const ref = createRef<HTMLDivElement>();
  const base: ComponentProps<typeof SheetGrid> = {
    sheet, axisProjection: projectGridAxes(sheet), activeSheetId: sheet.id, activeCellKey: null,
    cellInteraction: { clear: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn() },
    editingCell: null, editorInteraction: { FormulaEditor: FormulaEditorPanel, cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() },
    formulaResults: {}, keyboardFocusRequest: null, onKeyboardFocusRequestConsumed: vi.fn(), navigationHighlightCellKey: null, scrollContainerRef: ref,
  };
  let current = base;
  const view = () => <div ref={ref}><SheetGrid {...current} /></div>;
  const rendered = render(view());
  const geometry = virtualGridGeometry(ref.current!, { width: 400, height: 160 });
  const update = (changes: Partial<typeof base> = {}) => {
    current = { ...current, ...changes };
    current = { ...current, axisProjection: projectGridAxes(current.sheet) };
    rendered.rerender(view());
  };
  update();
  const move = (rows = sheet.rows, columns = sheet.columns, changes: Partial<typeof base> = {}) => update({ sheet: { ...sheet, rows, columns }, ...changes });
  return { sheet, update, move, geometry, body: ref.current!, unmount: rendered.unmount };
}

describe('live identity-based grid travel', () => {
  it('moves saved rows with their selected cells and headers while final focus and values are already committed', () => {
    const { sheet, move, update } = setup();
    update({ activeCellKey: 'A1' });
    const focused = screen.getByRole('cell', { name: /Motion A1/ });
    act(() => focused.focus());
    const [a, b, c] = sheet.rows;
    move([b, a, c], sheet.columns, { activeCellKey: 'A2', selectedRange: { start: { rowIndex: 1, columnIndex: 0 }, end: { rowIndex: 1, columnIndex: 0 } } });
    const source = animation.effects.find((effect) => (effect.element as HTMLElement).dataset.motionRow === a)!;
    const displaced = animation.effects.find((effect) => (effect.element as HTMLElement).dataset.motionRow === b)!;
    expect(source.frames[0].transform).toBe('translateY(-26.4px)');
    expect(displaced.frames[0].transform).toBe('translateY(26.4px)');
    expect(source.element).toContainElement(focused);
    expect(source.element.querySelector('[role="rowheader"]')).toHaveTextContent('2');
    expect(focused).toHaveAttribute('data-cell-key', 'A2');
    expect(focused).toHaveAttribute('aria-selected', 'true');
    expect(focused).toHaveFocus();
    const text = focused.textContent;
    act(() => animation.effects.forEach((effect) => effect.onfinish?.()));
    expect(focused).toHaveFocus(); expect(focused).toHaveTextContent(text!);
  });

  it('animates column cells and headers from separate gather sources with variable logical widths, without scaling twice', () => {
    const { sheet, update, move, body } = setup();
    const [a, b, c] = sheet.columns;
    update({ presentation: { rowHeights: {}, columnWidths: { [a]: 100, [b]: 180, [c]: 60 } } });
    body.style.transform = 'scale(0.5)';
    move(sheet.rows, [b, a, c]);
    const effectsFor = (id: string) => animation.effects.filter((effect) => (effect.element as HTMLElement).dataset.motionColumn === id);
    expect(effectsFor(a)).toHaveLength(4);
    expect(effectsFor(a).map((effect) => effect.frames[0].transform)).toEqual(Array(4).fill('translateX(-180px)'));
    expect(effectsFor(b).map((effect) => effect.frames[0].transform)).toEqual(Array(4).fill('translateX(100px)'));
    expect(effectsFor(a).some((effect) => effect.element.getAttribute('role') === 'columnheader')).toBe(true);
    expect(effectsFor(a).filter((effect) => effect.element.getAttribute('role') === 'cell')).toHaveLength(3);
  });

  it('replaces in-flight effects for further moves, undo and redo and ignores old completion callbacks', () => {
    const { sheet, move } = setup();
    const reversed = [...sheet.rows].reverse();
    move(reversed);
    const first = [...animation.effects]; const stale = first[0].onfinish!;
    move(sheet.rows);
    const second = animation.effects.slice(first.length);
    expect(first.every((effect) => effect.cancel.mock.calls.length > 0)).toBe(true);
    act(stale);
    expect(second.every((effect) => effect.cancel.mock.calls.length === 0)).toBe(true);
    move(reversed);
    expect(second.every((effect) => effect.cancel.mock.calls.length > 0)).toBe(true);
    expect(animation.effects.length).toBeGreaterThan(first.length + second.length);
  });

  it.each(['scroll', 'viewport', 'size', 'owner', 'sheet', 'disabled', 'unmount', 'reduced'] as const)('cancels travel on %s without changing committed data', (reason) => {
    const { sheet, move, update, body, geometry, unmount } = setup();
    move([...sheet.rows].reverse(), [...sheet.columns].reverse());
    const effects = [...animation.effects]; expect(effects.length).toBeGreaterThan(0);
    if (reason === 'scroll') { body.scrollTop = 20; fireEvent.scroll(body); }
    else if (reason === 'viewport') act(() => geometry.resize({ width: 500, height: 200 }));
    else if (reason === 'size') update({ presentation: { columnWidths: {}, rowHeights: { [sheet.rows[0]]: 50 } } });
    else if (reason === 'owner') update({ selectionOwner: Symbol('new owner') });
    else if (reason === 'sheet') update({ activeSheetId: 'other' });
    else if (reason === 'disabled') update({ interactionsEnabled: false });
    else if (reason === 'unmount') unmount();
    else act(() => { reduced = true; preferenceChanged(); });
    expect(effects.every((effect) => effect.cancel.mock.calls.length > 0)).toBe(true);
  });

  it('does not animate initial, unchanged or content-only projections or replay reduced-motion changes', () => {
    const { sheet, move, update } = setup();
    expect(animation.effects).toHaveLength(0);
    update(); update({ formulaResults: {} });
    expect(animation.effects).toHaveLength(0);
    act(() => { reduced = true; preferenceChanged(); }); move([...sheet.rows].reverse());
    expect(animation.effects).toHaveLength(0);
    act(() => { reduced = false; preferenceChanged(); });
    update(); expect(animation.effects).toHaveLength(0);
    move(sheet.rows); expect(animation.effects.length).toBeGreaterThan(0);
    const count = animation.effects.length;
    update({ formulaResults: {} });
    expect(animation.effects).toHaveLength(count);
    expect(animation.effects.every((effect) => effect.cancel.mock.calls.length === 0)).toBe(true);
  });

  it('uses instant final layout on initial reduced motion and unsupported animation APIs', () => {
    reduced = true;
    const { sheet, move } = setup();
    move([...sheet.rows].reverse());
    expect(animation.effects).toHaveLength(0);
    act(() => { reduced = false; preferenceChanged(); });
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: undefined });
    move(sheet.rows);
    expect(screen.getAllByRole('rowheader')[0]).toHaveTextContent('1');
    expect(animation.effects).toHaveLength(0);
  });

  it('cancels for structural or sheet changes and starts fresh after a scroll without replaying old movement', () => {
    const { sheet, move, update, body } = setup();
    move([...sheet.rows].reverse());
    body.scrollTop = 10; fireEvent.scroll(body);
    const count = animation.effects.length;
    move(sheet.rows);
    expect(animation.effects.length).toBeGreaterThan(count);
    update({ sheet: { ...sheet, id: 'other' }, activeSheetId: 'other' });
    expect(animation.effects.every((effect) => effect.cancel.mock.calls.length > 0)).toBe(true);
    const before = animation.effects.length;
    move([...sheet.rows, 'new-row']);
    expect(animation.effects).toHaveLength(before);
  });

  it('keeps endpoint-only identities mounted using current data, not a whole travel corridor', () => {
    const { sheet, move, body } = setup(true);
    move([...sheet.rows.slice(1), sheet.rows[0]], [...sheet.columns.slice(1), sheet.columns[0]]);
    const firstRow = body.querySelector('[data-motion-row="r0"]')!;
    const firstCell = firstRow.querySelector('[data-motion-column="c0"]')!;
    expect(firstRow).toBeInTheDocument(); expect(firstCell).toBeInTheDocument();
    expect(firstCell).toHaveAttribute('data-cell-key', 'ALL1000');
    expect(body.querySelectorAll('[data-motion-row]').length).toBeLessThan(40);
    expect(body.querySelectorAll('[data-cell-key]').length).toBeLessThan(1200);
    expect(animation.effects.some((effect) => effect.element === firstRow)).toBe(true);
    expect(animation.effects.some((effect) => effect.element === firstCell)).toBe(true);
    act(() => animation.effects.forEach((effect) => effect.onfinish?.()));
    expect(firstRow).not.toBeInTheDocument();
  });

  it('animates newly mounted visible destinations from their offscreen identity offsets', () => {
    const { sheet, move, body } = setup(true);
    expect(body.querySelector('[data-motion-row="r999"]')).toBeNull();
    move([...sheet.rows].reverse(), [...sheet.columns].reverse());
    const enteringRow = body.querySelector('[data-motion-row="r999"]')!;
    const enteringCell = enteringRow.querySelector('[data-motion-column="c999"]')!;
    expect(enteringCell).toHaveAttribute('data-cell-key', 'A1');
    expect(animation.effects.find((effect) => effect.element === enteringRow)?.frames[0].transform).toMatch(/^translateY\(26373\./);
    expect(animation.effects.find((effect) => effect.element === enteringCell)?.frames[0].transform).toBe('translateX(75924px)');
    expect(body.querySelectorAll('[data-cell-key]').length).toBeLessThan(1200);
  });
});
