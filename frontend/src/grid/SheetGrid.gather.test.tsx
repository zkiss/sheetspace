import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormulaEditorPanel } from '@application/react/FormulaEditorPanel';
import { projectGridAxes } from './gridAxisProjection';
import { SheetGrid } from './SheetGrid';
import { workbookWithSheets, smallSheetDocument } from '@test-support/workbookFactories';
import { tabularProjection } from '@workbook/read/queries';
import { testRect, virtualGridGeometry } from '@test-support/domGeometry';
import { gatherAxis } from '@workbook/mutations/reorderAxis';
import { cellTargetAt } from './cellInteraction';
import { animateGridAxes } from './gridAxisMotionEffects';

function pointer(element: Element, type: string, x: number, y: number, pointerId = 1, modifiers: MouseEventInit = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, ...modifiers });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  fireEvent(element, event);
}
function setup(axis: 'rows' | 'columns' = 'rows', allowColumnGather = true, long = false, special = false, mixed = false, cellSelection = false, memberCount = 0) {
  const original = tabularProjection(smallSheetDocument({ id: 'gather', name: 'Gather' }));
  const sheet = long ? { ...original, rows: Array.from({ length: 30 }, (_, i) => `row-${i}`), columns: Array.from({ length: 30 }, (_, i) => `column-${i}`) } : original;
  const ref = createRef<HTMLDivElement>();
  const gather = vi.fn(); const select = vi.fn(); const activity = vi.fn();
  const anchor = cellTargetAt(sheet, 'A1')!;
  const members = sheet[axis];
  const selection = cellSelection ? { mode: 'cells' as const, anchor, extent: anchor } : { mode: axis, anchor, extent: anchor, members: memberCount ? members.slice(0, memberCount) : [members[0], members[2]] };
  const view = (changes: { activeSheetId?: string; interactionsEnabled?: boolean; allowColumnGather?: boolean; modelId?: string; selectionOwner?: symbol; sheet?: typeof sheet; projectionChange?: 'rows' | 'columns' } = {}) => {
    const currentSheet = changes.sheet ?? sheet;
    const slots = changes.projectionChange ? { rows: changes.projectionChange === 'rows' ? [{ kind: 'creating' as const, operationId: 'new', boundary: 1 }] : [], columns: changes.projectionChange === 'columns' ? [{ kind: 'creating' as const, operationId: 'new', boundary: 1 }] : [] } : special ? { rows: [{ kind: 'creating' as const, operationId: 'pending-row', boundary: 30 }], columns: [{ kind: 'creating' as const, operationId: 'pending-column', boundary: 30 }] } : undefined;
    return <div ref={ref}><SheetGrid activeCellKey="A1" activeSheetId={changes.activeSheetId ?? sheet.id} axisProjection={projectGridAxes(currentSheet, slots)}
    presentation={special ? { rowHeights: { [mixed ? 'row-2' : 'row-1']: 50 }, columnWidths: { [mixed ? 'column-2' : 'column-1']: 160 } } : undefined}
    cellInteraction={{ clear: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn() }}
    editingCell={null} editorInteraction={{ FormulaEditor: FormulaEditorPanel, cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() }}
    formulaResults={{}} keyboardFocusRequest={null} onKeyboardFocusRequestConsumed={vi.fn()} navigationHighlightCellKey={null}
    logicalSelection={selection} selectionOwner={changes.selectionOwner} interactionsEnabled={changes.interactionsEnabled}
    onSelectAxis={select} onGatherAxis={gather} allowColumnGather={changes.allowColumnGather ?? allowColumnGather} modelId={changes.modelId}
    onPointerInteractionChange={activity} scrollContainerRef={ref} sheet={currentSheet} /></div>;
  };
  const rendered = render(view());
  virtualGridGeometry(ref.current!, { width: 400, height: 160 });
  return { sheet, gather, select, activity, container: ref.current!, grid: screen.getByTestId('sheet-grid'), rerender: (changes: Parameters<typeof view>[0]) => rendered.rerender(view(changes)), unmount: rendered.unmount };
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); delete (document as Partial<Document>).elementFromPoint; });
describe('header gather controls', () => {
  it.each(['rows', 'columns'] as const)('drags %s selection rather than gathering from cell selection', (axis) => {
    const { grid, select, gather } = setup(axis, true, false, false, false, true);
    const row = axis === 'rows';
    const header = screen.getAllByRole(row ? 'rowheader' : 'columnheader').filter((item) => item.hasAttribute('data-axis-durable-index'))[0];
    pointer(header, 'pointerdown', 50, 30);
    pointer(grid, 'pointermove', row ? 50 : 200, row ? 85 : 30);
    pointer(grid, 'pointerup', row ? 50 : 200, row ? 85 : 30);
    expect(select).toHaveBeenCalledWith(axis, expect.anything(), false, expect.objectContaining({ start: true }));
    expect(select).toHaveBeenCalledWith(axis, expect.anything(), true, expect.anything());
    expect(gather).not.toHaveBeenCalled();
  });
  it.each([{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }])('keeps modifier %o as a selection gesture', (modifiers) => {
    const { grid, select, gather } = setup();
    pointer(screen.getAllByRole('rowheader')[0], 'pointerdown', 20, 30, 1, modifiers);
    pointer(grid, 'pointermove', 20, 100);
    pointer(grid, 'pointerup', 20, 100);
    expect(select).toHaveBeenCalled();
    expect(gather).not.toHaveBeenCalled();
    expect(screen.queryByTestId('axis-gather-line')).not.toBeInTheDocument();
  });
  it.each(['rows', 'columns'] as const)('scrolls %s at a scaled edge and releases the stationary pointer at its updated gap', (axis) => {
    let callback: FrameRequestCallback | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((next) => { callback = next; return 1; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { callback = undefined; });
    const { sheet, gather, grid, container, activity } = setup(axis, true, true);
    Object.defineProperties(container, { scrollHeight: { configurable: true, value: 900 }, scrollWidth: { configurable: true, value: 3000 } });
    container.getBoundingClientRect = () => testRect({ left: 10, top: 10, width: 200, height: 80 });
    const row = axis === 'rows';
    const x = row ? 20 : 205; const y = row ? 85 : 15;
    const source = screen.getAllByRole(row ? 'rowheader' : 'columnheader').filter((header) => header.hasAttribute('data-axis-durable-index'))[2];
    const capture = vi.fn(); const release = vi.fn();
    Object.assign(grid, { setPointerCapture: capture, hasPointerCapture: () => true, releasePointerCapture: release });
    pointer(source, 'pointerdown', 60, 45);
    expect(capture).toHaveBeenCalledWith(1);
    pointer(grid, 'pointermove', x, y);
    const before = screen.getByTestId('axis-gather-line').getAttribute('style');
    expect(callback).toBeDefined();
    act(() => { const next = callback!; callback = undefined; next(16); });
    expect(row ? container.scrollTop : container.scrollLeft).toBeGreaterThan(12);
    act(() => { for (let i = 0; i < 24 && callback; i++) { const next = callback; callback = undefined; next(32 + i * 16); fireEvent.scroll(container); } });
    expect(screen.getByTestId('axis-gather-line').getAttribute('style')).not.toBe(before);
    expect(activity).toHaveBeenLastCalledWith(sheet.id, true);
    expect(source).not.toBeInTheDocument();
    pointer(grid, 'pointerup', x, y);
    expect(gather).toHaveBeenCalledWith(row ? 'row' : 'column', row ? [sheet.rows[0], sheet.rows[2]] : [sheet.columns[0], sheet.columns[2]], row ? 24 : 11);
    expect(gather).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(1);
    expect(activity).toHaveBeenLastCalledWith(sheet.id, false);
    expect(callback).toBeUndefined();
  });
  it.each(['rows', 'columns'] as const)('uses variable %s sizes at the saved endpoint and rejects the adjacent placeholder', (axis) => {
    const { sheet, grid, container, gather } = setup(axis, true, true, true);
    const row = axis === 'rows';
    const button = screen.getAllByRole(row ? 'rowheader' : 'columnheader').filter((header) => header.hasAttribute('data-axis-durable-index'))[0];
    pointer(button, 'pointerdown', 20, 30);
    // The last saved midpoint lies 29 default sizes plus the extra size of axis 2 away.
    const lastMidpoint = row ? 29 * 26.4 + (50 - 26.4) + 13.2 : 29 * 76 + 84 + 38;
    const header = row ? 26.4 : 40;
    const position = row ? 100 : 200;
    if (row) container.scrollTop = lastMidpoint - position + header;
    else container.scrollLeft = lastMidpoint - position + header;
    fireEvent.scroll(container);
    pointer(grid, 'pointermove', row ? 20 : position, row ? position : 10);
    pointer(grid, 'pointerup', row ? 20 : position, row ? position : 10);
    expect(gather).toHaveBeenCalledWith(row ? 'row' : 'column', row ? [sheet.rows[0], sheet.rows[2]] : [sheet.columns[0], sheet.columns[2]], 30);
    pointer(button, 'pointerdown', 20, 30);
    if (row) container.scrollTop += 14; else container.scrollLeft += 39;
    fireEvent.scroll(container);
    pointer(grid, 'pointermove', row ? 20 : position, row ? position : 10);
    expect(screen.queryByTestId('axis-gather-line')).not.toBeInTheDocument();
    pointer(grid, 'pointerup', row ? 20 : position, row ? position : 10);
    expect(gather).toHaveBeenCalledTimes(1);
  });
  it.each(['rows', 'columns'] as const)('cleans up %s frame work on cancellation and starts a fresh gesture', (axis) => {
    let callback: FrameRequestCallback | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((next) => { callback = next; return 1; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { callback = undefined; });
    const { sheet, grid, container, gather, activity } = setup(axis, true, true);
    Object.defineProperties(container, { scrollHeight: { configurable: true, value: 900 }, scrollWidth: { configurable: true, value: 3000 } });
    const row = axis === 'rows';
    const button = screen.getAllByRole(row ? 'rowheader' : 'columnheader').filter((header) => header.hasAttribute('data-axis-durable-index'))[0];
    pointer(button, 'pointerdown', 20, 30);
    pointer(grid, 'pointermove', row ? 20 : 395, row ? 155 : 10);
    const stale = callback!;
    expect(stale).toBeDefined();
    pointer(grid, 'pointercancel', row ? 20 : 395, row ? 155 : 10);
    expect(callback).toBeUndefined();
    expect(activity).toHaveBeenLastCalledWith(sheet.id, false);
    act(() => stale(16));
    expect(container.scrollTop).toBe(0);
    expect(container.scrollLeft).toBe(0);
    pointer(grid, 'pointerup', row ? 20 : 395, row ? 155 : 10);
    expect(gather).not.toHaveBeenCalled();
    pointer(button, 'pointerdown', 20, 30);
    pointer(grid, 'pointerup', 20, 30);
    expect(gather).not.toHaveBeenCalled();
  });
  it('updates the stationary target on external scrolling and cancels queued work over an invalid surface', () => {
    let callback: FrameRequestCallback | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((next) => { callback = next; return 1; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { callback = undefined; });
    const { gather, grid, container } = setup('rows', true, true);
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 900 });
    const surface = vi.fn((): Element | null => grid);
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: surface });
    pointer(screen.getAllByRole('rowheader')[0], 'pointerdown', 20, 30);
    pointer(grid, 'pointermove', 20, 155);
    const before = screen.getByTestId('axis-gather-line').getAttribute('style');
    container.scrollTop = 80;
    fireEvent.scroll(container);
    expect(screen.getByTestId('axis-gather-line').getAttribute('style')).not.toBe(before);
    expect(callback).toBeDefined();
    surface.mockReturnValue(null);
    fireEvent.scroll(container);
    expect(callback).toBeUndefined();
    expect(screen.queryByTestId('axis-gather-line')).not.toBeInTheDocument();
    pointer(grid, 'pointerup', 20, 155);
    expect(gather).not.toHaveBeenCalled();
  });
  it('stops at scroll bounds and restarts in the opposite direction without retaining cancelled work', () => {
    let callback: FrameRequestCallback | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((next) => { callback = next; return 1; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { callback = undefined; });
    const { grid, container, gather } = setup('rows', true, true);
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 200 });
    const button = screen.getAllByRole('rowheader')[0];
    pointer(button, 'pointerdown', 20, 30);
    pointer(grid, 'pointermove', 20, 155);
    act(() => { for (let i = 0; i < 10 && callback; i++) { const next = callback; callback = undefined; next(i * 16); } });
    expect(container.scrollTop).toBe(40);
    expect(callback).toBeUndefined();
    pointer(grid, 'pointermove', 20, 30);
    expect(callback).toBeDefined();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(callback).toBeUndefined();
    pointer(grid, 'pointerup', 20, 25);
    expect(gather).not.toHaveBeenCalled();
    pointer(button, 'pointerdown', 20, 30);
    pointer(grid, 'pointerup', 20, 30);
    expect(gather).not.toHaveBeenCalled();
  });
  it('gathers scattered selected rows at the original gap without selecting again', () => {
    const { sheet, gather, select, activity, grid } = setup();
    pointer(screen.getAllByRole('rowheader')[0], 'pointerdown', 20, 30);
    expect(activity).toHaveBeenLastCalledWith(sheet.id, true);
    pointer(grid, 'pointermove', 20, 100);
    expect(screen.getByTestId('axis-gather-line')).toHaveStyle({ height: '2px', left: '0px', right: '0px' });
    expect(gather).not.toHaveBeenCalled();
    pointer(grid, 'pointerup', 20, 100);
    expect(gather).toHaveBeenCalledWith('row', [sheet.rows[0], sheet.rows[2]], 3);
    expect(select).not.toHaveBeenCalled();
  });
  it('uses the column control and does not commit below the threshold', () => {
    const { sheet, gather, grid } = setup('columns');
    const button = screen.getAllByRole('columnheader').filter((header) => header.hasAttribute('data-axis-durable-index'))[0];
    pointer(button, 'pointerdown', 50, 10); pointer(grid, 'pointerup', 53, 10);
    expect(gather).not.toHaveBeenCalled();
    pointer(button, 'pointerdown', 50, 10); pointer(grid, 'pointermove', 230, 10); pointer(grid, 'pointerup', 230, 10);
    expect(gather).toHaveBeenCalledWith('column', [sheet.columns[0], sheet.columns[2]], 3);
  });
  it('ignores foreign pointers and cancels on escape', () => {
    const { gather, grid } = setup();
    pointer(screen.getAllByRole('rowheader')[0], 'pointerdown', 20, 30);
    pointer(grid, 'pointerup', 20, 100, 2);
    pointer(grid, 'pointermove', 20, 100);
    fireEvent.keyDown(window, { key: 'Escape' });
    pointer(grid, 'pointerup', 20, 100);
    expect(gather).not.toHaveBeenCalled();
    expect(screen.queryByTestId('axis-gather-line')).not.toBeInTheDocument();
  });
  it('selects an unselected source and dispatches only that identity', () => {
    const { sheet, gather, select, grid } = setup();
    pointer(screen.getAllByRole('rowheader')[1], 'pointerdown', 20, 60);
    expect(select).toHaveBeenCalledWith('rows', expect.objectContaining({ cell: expect.objectContaining({ rowId: sheet.rows[1] }) }), false, expect.objectContaining({ start: true }));
    pointer(grid, 'pointermove', 20, 100); pointer(grid, 'pointerup', 20, 100);
    expect(gather).toHaveBeenCalledWith('row', [sheet.rows[1]], 3);
  });
  it('rejects invalid destinations and pointer cancellation', () => {
    const { gather, grid } = setup();
    const button = screen.getAllByRole('rowheader')[0];
    pointer(button, 'pointerdown', 20, 30); pointer(grid, 'pointermove', 500, 100); pointer(grid, 'pointerup', 500, 100);
    expect(gather).not.toHaveBeenCalled();
    pointer(button, 'pointerdown', 20, 30); pointer(grid, 'pointermove', 20, 100); pointer(grid, 'pointercancel', 20, 100);
    pointer(grid, 'pointerup', 20, 100);
    expect(gather).not.toHaveBeenCalled();
  });
  it('rejects an overlapping sheet during preview and rechecks the release surface', () => {
    const { gather, grid, container } = setup();
    const otherSheet = document.createElement('div');
    document.body.append(otherSheet);
    const surface = vi.fn((): Element | null => grid);
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: surface });
    const button = screen.getAllByRole('rowheader')[0];
    pointer(button, 'pointerdown', 20, 30);
    pointer(grid, 'pointermove', 20, 100);
    expect(screen.getByTestId('axis-gather-line')).toBeInTheDocument();
    surface.mockReturnValue(otherSheet);
    pointer(grid, 'pointermove', 20, 100);
    expect(screen.queryByTestId('axis-gather-line')).not.toBeInTheDocument();
    surface.mockReturnValue(null);
    pointer(grid, 'pointermove', 20, 100);
    expect(screen.queryByTestId('axis-gather-line')).not.toBeInTheDocument();
    surface.mockReturnValue(container);
    pointer(grid, 'pointermove', 20, 100);
    surface.mockReturnValue(otherSheet);
    pointer(grid, 'pointerup', 20, 100);
    expect(gather).not.toHaveBeenCalled();
    otherSheet.remove();
  });
  it.each([[undefined, 'model-a'], ['model-a', undefined], ['model-a', 'model-b']] as const)(
    'cancels row gathering when model changes from %s to %s', (before, after) => {
      const { gather, grid, rerender } = setup();
      rerender({ modelId: before });
      pointer(screen.getAllByRole('rowheader')[0], 'pointerdown', 20, 30);
      pointer(grid, 'pointermove', 20, 100);
      expect(screen.getByTestId('axis-gather-line')).toBeInTheDocument();
      rerender({ modelId: after });
      expect(screen.queryByTestId('axis-gather-line')).not.toBeInTheDocument();
      pointer(grid, 'pointerup', 20, 100);
      expect(gather).not.toHaveBeenCalled();
    },
  );
  it('allows row gathering while the model binding remains unchanged', () => {
    const { sheet, gather, grid, rerender } = setup();
    rerender({ modelId: 'model-a' });
    pointer(screen.getAllByRole('rowheader')[0], 'pointerdown', 20, 30);
    pointer(grid, 'pointermove', 20, 100);
    pointer(grid, 'pointerup', 20, 100);
    expect(gather).toHaveBeenCalledWith('row', [sheet.rows[0], sheet.rows[2]], 3);
  });
  it('passes the original gap to the real gather mutation', () => {
    const { sheet, gather, grid } = setup();
    pointer(screen.getAllByRole('rowheader')[0], 'pointerdown', 20, 30);
    pointer(grid, 'pointermove', 20, 100); pointer(grid, 'pointerup', 20, 100);
    const document = smallSheetDocument({ id: 'gather', name: 'Gather' });
    const [axis, ids, gap] = gather.mock.calls[0] as ['row', string[], number];
    const result = gatherAxis(workbookWithSheets([document]), sheet.id, axis, ids, gap);
    expect(result.status).toBe('changed');
    expect(result.workbook.documents[sheet.id]?.content.rows).toEqual([sheet.rows[1], sheet.rows[0], sheet.rows[2]]);
  });
  it('converts scrolled and scaled viewport coordinates before hit testing', () => {
    const { sheet, gather, grid, container } = setup();
    container.scrollTop = 26.4;
    container.getBoundingClientRect = () => testRect({ left: 10, top: 10, width: 200, height: 80 });
    pointer(screen.getAllByRole('rowheader')[0], 'pointerdown', 20, 28);
    pointer(grid, 'pointermove', 20, 47);
    expect(screen.getByTestId('axis-gather-line')).toHaveStyle({ top: '104.6px', height: '2px' });
    pointer(grid, 'pointerup', 20, 47);
    expect(gather).toHaveBeenCalledWith('row', [sheet.rows[0], sheet.rows[2]], 3);
  });
  it.each(['rows', 'columns'] as const)('accounts for scaled non-overlay scrollbars when gathering %s', (axis) => {
    const { sheet, gather, grid, container } = setup(axis);
    Object.defineProperties(container, { offsetWidth: { configurable: true, value: 420 }, offsetHeight: { configurable: true, value: 180 } });
    container.getBoundingClientRect = () => testRect({ left: 10, top: 10, width: 210, height: 90 });
    container.scrollTop = 26.4; container.scrollLeft = 20;
    const row = axis === 'rows';
    pointer(screen.getAllByRole(row ? 'rowheader' : 'columnheader').filter((header) => header.hasAttribute('data-axis-durable-index'))[0], 'pointerdown', 20, 25);
    pointer(grid, 'pointermove', row ? 20 : 110, row ? 47 : 15);
    pointer(grid, 'pointerup', row ? 20 : 110, row ? 47 : 15);
    expect(gather).toHaveBeenCalledWith(row ? 'row' : 'column', row ? [sheet.rows[0], sheet.rows[2]] : [sheet.columns[0], sheet.columns[2]], row ? 3 : 2);
  });
  it.each(['owner', 'sheet', 'order', 'disabled', 'model'] as const)('cancels on %s changes', (change) => {
    const { sheet, gather, grid, rerender, container } = setup('columns');
    pointer(screen.getAllByRole('columnheader').filter((header) => header.hasAttribute('data-axis-durable-index'))[0], 'pointerdown', 50, 10);
    pointer(grid, 'pointermove', 230, 10);
    rerender(change === 'owner' ? { selectionOwner: Symbol('external') }
      : change === 'sheet' ? { activeSheetId: 'other' }
        : change === 'order' ? { sheet: { ...sheet, columns: [...sheet.columns].reverse() } }
          : change === 'disabled' ? { interactionsEnabled: false } : { allowColumnGather: false });
    pointer(grid, 'pointerup', 230, 10);
    expect(gather).not.toHaveBeenCalled();
    expect(screen.queryByTestId('axis-gather-line')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.sheet-grid-axis-flight-card')).toHaveLength(2);
  });
  it.each(['rows', 'columns'] as const)('returns the %s deck on a projection-only change', (axis) => {
    const { gather, grid, rerender, container } = setup(axis);
    const row = axis === 'rows';
    const header = screen.getAllByRole(row ? 'rowheader' : 'columnheader').filter((item) => item.hasAttribute('data-axis-durable-index'))[0];
    pointer(header, 'pointerdown', 20, 30);
    pointer(grid, 'pointermove', row ? 20 : 230, row ? 100 : 10);
    rerender({ projectionChange: axis });
    expect(container.querySelectorAll('.sheet-grid-axis-flight-card')).toHaveLength(2);
    pointer(grid, 'pointerup', row ? 20 : 230, row ? 100 : 10);
    expect(gather).not.toHaveBeenCalled();
  });
  it('cancels when hidden and on unmount', () => {
    const { gather, grid, unmount } = setup();
    const button = screen.getAllByRole('rowheader')[0];
    pointer(button, 'pointerdown', 20, 30); pointer(grid, 'pointermove', 20, 100);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    pointer(grid, 'pointerup', 20, 100);
    pointer(button, 'pointerdown', 20, 30); unmount(); pointer(grid, 'pointerup', 20, 100);
    expect(gather).not.toHaveBeenCalled();
  });
  it('captures on the stable grid and ignores non-primary starts', () => {
    const { grid, gather } = setup();
    const capture = vi.fn(); const release = vi.fn();
    Object.assign(grid, { setPointerCapture: capture, hasPointerCapture: () => true, releasePointerCapture: release });
    const button = screen.getAllByRole('rowheader')[0];
    const secondary = new MouseEvent('pointerdown', { bubbles: true, button: 0 });
    Object.defineProperties(secondary, { pointerId: { value: 2 }, isPrimary: { value: false } });
    fireEvent(button, secondary);
    pointer(grid, 'pointercancel', 20, 30, 2);
    capture.mockClear();
    pointer(button, 'pointerdown', 20, 30);
    expect(capture).toHaveBeenCalledWith(1);
    button.remove();
    pointer(grid, 'pointerup', 20, 100);
    expect(release).toHaveBeenCalledWith(1);
    expect(gather).toHaveBeenCalledTimes(1);
  });
  it('cancels on lost capture or window blur and starts a fresh gesture', () => {
    const { gather, grid } = setup();
    const button = screen.getAllByRole('rowheader')[0];
    pointer(button, 'pointerdown', 20, 30); pointer(grid, 'pointermove', 20, 100);
    pointer(grid, 'lostpointercapture', 20, 100); pointer(grid, 'pointerup', 20, 100);
    pointer(button, 'pointerdown', 20, 30); fireEvent.blur(window); pointer(grid, 'pointerup', 20, 100);
    expect(gather).not.toHaveBeenCalled();
    pointer(button, 'pointerdown', 20, 30); pointer(grid, 'pointerup', 20, 100);
    expect(gather).toHaveBeenCalledTimes(1);
  });
  it.each(['rows', 'columns'] as const)('renders the %s deck and restores mixed sizes and labels in flight', (axis) => {
    vi.useFakeTimers();
    const { grid, container } = setup(axis, true, true, true, true);
    const row = axis === 'rows';
    const headers = screen.getAllByRole(row ? 'rowheader' : 'columnheader').filter((header) => header.hasAttribute('data-axis-durable-index'));
    pointer(headers[2], 'pointerdown', row ? 20 : 210, row ? 90 : 10);
    expect(container.querySelector('.sheet-grid-axis-deck')).toBeNull();
    pointer(grid, 'pointermove', row ? 120 : 300, row ? 120 : 80);
    const cards = [...container.querySelectorAll<HTMLElement>('.sheet-grid-axis-deck .sheet-grid-axis-card')];
    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.textContent)).toEqual(row ? ['3', ''] : ['C', '']);
    expect(cards[0].style.width).toBe(cards[1].style.width);
    expect(cards[0].style.height).toBe(cards[1].style.height);
    expect(cards[0].style.width).toBe(row ? '40px' : '160px');
    expect(cards[0].style.height).toBe(row ? '50px' : '26.4px');
    expect(parseFloat(cards[1].style.left) - parseFloat(cards[0].style.left)).toBe(4);
    expect(parseFloat(cards[1].style.top) - parseFloat(cards[0].style.top)).toBe(4);
    expect(screen.getAllByTestId('axis-gather-line')).toHaveLength(1);
    pointer(grid, 'pointerup', row ? 120 : 300, row ? 120 : 80);
    const flight = [...container.querySelectorAll<HTMLElement>('.sheet-grid-axis-flight-card')];
    expect(flight.map((card) => card.textContent)).toEqual(row ? ['3', '1'] : ['C', 'A']);
    expect(flight.map((card) => card.style.getPropertyValue(row ? '--flight-to-y' : '--flight-to-x'))).toEqual(row ? ['52.8px', '26.4px'] : ['152px', '76px']);
    expect(flight.map((card) => card.style.getPropertyValue(row ? '--flight-from-y' : '--flight-from-x'))).toEqual(row ? ['30px', '34px'] : ['90px', '94px']);
    expect(flight[1].style.getPropertyValue(row ? '--flight-scale-y' : '--flight-scale-x')).not.toBe('1');
    act(() => vi.advanceTimersByTime(340));
    expect(container.querySelector('.sheet-grid-axis-flight')).toBeNull();
    vi.useRealTimers();
  });
  it.each(['rows', 'columns'] as const)('caps the visible %s deck at three stacked depths', (axis) => {
    const { grid, container } = setup(axis, true, true, false, false, false, 5);
    const row = axis === 'rows';
    const headers = screen.getAllByRole(row ? 'rowheader' : 'columnheader').filter((header) => header.hasAttribute('data-axis-durable-index'));
    pointer(headers[0], 'pointerdown', 20, 30);
    pointer(grid, 'pointermove', row ? 120 : 200, row ? 100 : 80);
    const cards = [...container.querySelectorAll<HTMLElement>('.sheet-grid-axis-deck .sheet-grid-axis-card')];
    expect(cards).toHaveLength(5);
    expect(cards.map((card) => card.textContent)).toEqual(row ? ['1', '', '', '', ''] : ['A', '', '', '', '']);
    expect(cards.map((card) => Number(card.style.zIndex))).toEqual([3, 2, 1, 0, 0]);
    for (const coordinate of ['left', 'top'] as const) {
      const origin = parseFloat(cards[0].style[coordinate]);
      expect(cards.map((card) => parseFloat(card.style[coordinate]) - origin)).toEqual([0, 4, 8, 8, 8]);
    }
  });
  it('synchronizes the flight transform and easing with real axis motion', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div data-motion-row="row"></div><div data-motion-column="column"></div>';
    const animate = vi.fn(() => ({ cancel: vi.fn(), onfinish: null } as unknown as Animation));
    root.querySelectorAll<HTMLElement>('div').forEach((element) => { element.animate = animate; });
    const cancel = animateGridAxes(root, { rows: [{ id: 'row', delta: 50, index: 0, start: 0, size: 50 }], columns: [{ id: 'column', delta: 160, index: 0, start: 0, size: 160 }] }, vi.fn());
    expect(animate).toHaveBeenNthCalledWith(1, [{ transform: 'translateY(50px)' }, { transform: 'translateY(0px)' }], { duration: 220, easing: 'ease-out' });
    expect(animate).toHaveBeenNthCalledWith(2, [{ transform: 'translateX(160px)' }, { transform: 'translateX(0px)' }], { duration: 220, easing: 'ease-out' });
    cancel();
  });
  it('flies headers home on Escape and clears an earlier flight on the next press', () => {
    const { grid, container, gather } = setup();
    const header = screen.getAllByRole('rowheader')[0];
    pointer(header, 'pointerdown', 20, 30);
    pointer(grid, 'pointermove', 120, 100);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(gather).not.toHaveBeenCalled();
    expect([...container.querySelectorAll('.sheet-grid-axis-flight-card')].map((card) => card.textContent)).toEqual(['1', '3']);
    pointer(header, 'pointerdown', 20, 30);
    expect(container.querySelector('.sheet-grid-axis-flight')).toBeNull();
    pointer(grid, 'pointerup', 20, 30);
  });
  it('does not offer model-owned column controls', () => {
    const { grid, gather } = setup('columns', false);
    const header = screen.getAllByRole('columnheader').find((item) => item.hasAttribute('data-axis-durable-index'))!;
    pointer(header, 'pointerdown', 50, 10);
    pointer(grid, 'pointermove', 230, 10);
    pointer(grid, 'pointerup', 230, 10);
    expect(gather).not.toHaveBeenCalled();
    expect(screen.queryByTestId('axis-gather-line')).not.toBeInTheDocument();
  });
});
