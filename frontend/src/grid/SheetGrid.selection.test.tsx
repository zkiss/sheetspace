import { useEffect, useMemo, useRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cellAddressOf } from '@workbook/core/cellIdentity';
import { cellKey } from '@workbook/core/address';
import { tabularProjection } from '@workbook/read/queries';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { testRect, virtualGridGeometry } from '@test-support/domGeometry';
import { cellKeyForTarget, cellTargetAt } from './cellInteraction';
import { projectGridAxes } from './gridAxisProjection';
import { useCellEditing } from './useCellEditing';
import { SheetGrid } from './SheetGrid';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function pointer(element: Element, type: string, clientX = 50, clientY = 40, pointerId = 22) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  fireEvent(element, event);
}

function frames() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let next = 1;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.set(next, callback);
    return next++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  return {
    queued: () => [...callbacks.values()],
    run(container: HTMLElement, rounds = 1) {
      for (let round = 0; round < rounds; round++) {
        const pending = [...callbacks.entries()];
        for (const [id, callback] of pending) {
          callbacks.delete(id);
          act(() => callback(0));
        }
        fireEvent.scroll(container);
      }
    },
  };
}

const commands = { updateCellContent: vi.fn() };
const consumed = vi.fn();
function SelectionGrid({ sheet, replacement, replacementKey = 'C1' }: {
  sheet: ReturnType<typeof sheetDocument>;
  replacement?: 'cell' | 'range' | 'edit';
  replacementKey?: string;
}) {
  const workbook = useMemo(() => workbookWithSheets([sheet]), [sheet]);
  const interaction = useCellEditing({ commands, workbook });
  const projection = tabularProjection(sheet);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!replacement) return;
    const target = cellTargetAt(sheet, replacementKey)!;
    if (replacement === 'edit') interaction.startEditingCell(target, 'retained draft');
    else interaction.selectReferenceTarget(replacement === 'cell'
      ? { kind: 'cell', target }
      : { kind: 'range', sheetId: sheet.id, range: { start: target.cell, end: cellTargetAt(sheet, 'D2')!.cell } });
  }, [replacement, replacementKey, sheet]);
  const range = interaction.selectionRange;
  const anchor = range && cellAddressOf(sheet.content, range.anchor.cell)!;
  const extent = range && cellAddressOf(sheet.content, range.extent.cell)!;
  const selectedRange = anchor && extent ? {
    start: {
      columnIndex: range?.mode === 'rows' ? 0 : Math.min(anchor.columnIndex, extent.columnIndex),
      rowIndex: range?.mode === 'columns' ? 0 : Math.min(anchor.rowIndex, extent.rowIndex),
    },
    end: {
      columnIndex: range?.mode === 'rows' ? sheet.content.columns.length - 1 : Math.max(anchor.columnIndex, extent.columnIndex),
      rowIndex: range?.mode === 'columns' ? sheet.content.rows.length - 1 : Math.max(anchor.rowIndex, extent.rowIndex),
    },
  } : undefined;
  return <>
    <output data-testid="selection-state">{JSON.stringify({
      active: cellKeyForTarget(sheet, interaction.activeCell),
      anchor: range && cellKeyForTarget(sheet, range.anchor),
      extent: range && cellKeyForTarget(sheet, range.extent),
      mode: range?.mode,
      reference: interaction.referenceSelection,
      editing: interaction.editingCell,
    })}</output>
    <div ref={scrollContainerRef} style={{ overflow: 'auto' }}>
      <SheetGrid
        activeCellKey={cellKeyForTarget(sheet, interaction.activeCell)}
        activeSheetId={interaction.activeCell?.sheetId ?? null}
        selectionOwner={interaction.selectionOwner}
        axisProjection={projectGridAxes(projection, { columns: [], rows: [] })}
        cellInteraction={{ clear: interaction.clearCellContent, select: interaction.selectCell, extend: interaction.extendSelection,
          focusSelection: interaction.focusSelection, navigate: interaction.navigateCell, startEditing: interaction.startEditingCell }}
        editingCell={interaction.editingCell}
        editorInteraction={{ cancel: interaction.cancelActiveEdit, commit: interaction.commitActiveEdit,
          commitAndNavigate: interaction.commitEditAndNavigate, updateValue: interaction.updateEditingCellValue }}
        formulaResults={{}}
        keyboardFocusRequest={interaction.keyboardFocusRequest && {
          id: interaction.keyboardFocusRequest.id, targetKey: cellKeyForTarget(sheet, interaction.keyboardFocusRequest.target),
        }}
        onKeyboardFocusRequestConsumed={(id) => { consumed(id); interaction.acknowledgeKeyboardFocusRequest(id); }}
        navigationHighlightCellKey={null}
        scrollContainerRef={scrollContainerRef}
        selectedRange={selectedRange}
        selectionMode={range?.mode}
        onSelectAxis={interaction.selectAxis}
        sheet={projection}
      />
    </div>
  </>;
}
function state() { return JSON.parse(screen.getByTestId('selection-state').textContent!); }
function activeCell(name: string, key: string) { return screen.getByRole('cell', { name: `${name} ${key} empty cell` }); }

// Native offsets stop at the content size, unlike JSDOM's default writable properties.
function clampedScroll(container: HTMLElement, maximum: { left: number; top: number }) {
  let left = 0, top = 0;
  Object.defineProperties(container, {
    scrollLeft: { configurable: true, get: () => left, set: (value: number) => { left = Math.min(maximum.left, Math.max(0, value)); } },
    scrollTop: { configurable: true, get: () => top, set: (value: number) => { top = Math.min(maximum.top, Math.max(0, value)); } },
  });
}

describe('selection context ownership', () => {
  it.each((['cell', 'range', 'edit'] as const).flatMap((replacement) =>
    (['move', 'raf', 'release'] as const).map((first) => ({ replacement, first })),
  ))('preserves same-address $replacement replacement when stale $first arrives first', async ({ replacement, first }) => {
    commands.updateCellContent.mockClear(); consumed.mockClear();
    const sheet = sheetDocument({ id: 'replacement', name: 'Replacement' });
    const raf = frames();
    const view = render(<SelectionGrid sheet={sheet} />);
    const grid = screen.getByTestId('sheet-grid');
    const container = grid.parentElement!;
    virtualGridGeometry(container);
    const release = vi.fn();
    grid.setPointerCapture = vi.fn(); grid.hasPointerCapture = () => true; grid.releasePointerCapture = release;
    pointer(activeCell(sheet.name, 'A1'), 'pointerdown');
    pointer(grid, 'pointermove', 230, 40);
    expect(state()).toMatchObject({ active: 'C1', anchor: 'A1', extent: 'C1' });
    const queued = raf.queued();
    expect(queued.length).toBeGreaterThan(0);
    view.rerender(<SelectionGrid sheet={sheet} replacement={replacement} />);
    const replaced = state();
    const expectedExtent = replacement === 'range' ? 'D2' : 'C1';
    expect(replaced).toMatchObject({ active: 'C1', anchor: 'C1', extent: expectedExtent });
    const beforeScroll = [container.scrollLeft, container.scrollTop];
    const beforeFocus = consumed.mock.calls.length;
    const stale = {
      move: () => pointer(grid, 'pointermove', 130, 40),
      raf: () => queued.forEach((callback) => act(() => callback(0))),
      release: () => pointer(grid, 'pointerup'),
    };
    for (const action of [first, ...(['move', 'raf', 'release'] as const).filter((action) => action !== first)]) {
      stale[action]();
      expect(state()).toEqual(replaced);
      expect([container.scrollLeft, container.scrollTop]).toEqual(beforeScroll);
    }
    expect(state()).toEqual(replaced);
    expect([container.scrollLeft, container.scrollTop]).toEqual(beforeScroll);
    expect(consumed).toHaveBeenCalledTimes(beforeFocus);
    expect(release).toHaveBeenCalledOnce();
    expect(commands.updateCellContent).not.toHaveBeenCalled();
    if (replacement === 'edit') {
      expect(screen.getByRole('textbox', { name: 'Replacement C1 editor' })).toHaveValue('retained draft');
      expect(screen.getByRole('textbox', { name: 'Replacement C1 editor' })).toHaveFocus();
    } else await waitFor(() => expect(activeCell(sheet.name, 'C1')).toHaveFocus());
  });

  it.each(['rows', 'columns'] as const)('invalidates a %s owner when editing starts at its active address', (mode) => {
    commands.updateCellContent.mockClear();
    const sheet = sheetDocument({ id: 'axis-edit', name: 'Axis edit' });
    const raf = frames();
    const view = render(<SelectionGrid sheet={sheet} />);
    const grid = screen.getByTestId('sheet-grid');
    const container = grid.parentElement!;
    virtualGridGeometry(container);
    const key = mode === 'rows' ? 'A1' : 'C1';
    const source = mode === 'rows' ? screen.getByRole('rowheader', { name: '1' }) : screen.getByRole('columnheader', { name: 'C' });
    pointer(source, 'pointerdown', mode === 'rows' ? 10 : 210, mode === 'rows' ? 40 : 10);
    expect(state()).toMatchObject({ active: key, mode });
    const queued = raf.queued();
    expect(queued.length).toBeGreaterThan(0);
    view.rerender(<SelectionGrid sheet={sheet} replacement="edit" replacementKey={key} />);
    const replaced = state();
    pointer(grid, 'pointermove', 130, 40);
    queued.forEach((callback) => act(() => callback(0)));
    pointer(grid, 'pointerup');
    expect(state()).toEqual(replaced);
    expect(screen.getByRole('textbox', { name: `Axis edit ${key} editor` })).toHaveFocus();
    expect(commands.updateCellContent).not.toHaveBeenCalled();
  });
});

describe('stationary scaled drag autoscroll', () => {
  it.each((['cells', 'rows', 'columns'] as const).flatMap((mode) => [
    { mode, reverse: false }, { mode, reverse: true },
  ]))('$mode reverse=$reverse advances durable extent across virtual windows to clamped endpoints', ({ mode, reverse }) => {
    commands.updateCellContent.mockClear(); consumed.mockClear();
    const sheet = sheetDocument({ id: 'scaled-raf', name: 'Scaled RAF', columnCount: 20, rowCount: 30 });
    const raf = frames();
    render(<SelectionGrid sheet={sheet} />);
    const grid = screen.getByTestId('sheet-grid');
    const container = grid.parentElement!;
    virtualGridGeometry(container, { height: 160, width: 240 });
    container.getBoundingClientRect = () => testRect({ height: 80, width: 120, left: 0, top: 0 });
    const maximum = { left: 40 + 20 * 76 - 240, top: 26.4 + 30 * 26.4 - 160 };
    clampedScroll(container, maximum);
    if (reverse) {
      container.scrollLeft = mode === 'rows' ? 0 : maximum.left;
      container.scrollTop = mode === 'columns' ? 0 : maximum.top;
      fireEvent.scroll(container);
    }
    const first = reverse ? (mode === 'rows' ? 'A30' : mode === 'columns' ? 'T1' : 'T30') : 'A1';
    const source = mode === 'rows' ? screen.getByRole('rowheader', { name: reverse ? '30' : '1' })
      : mode === 'columns' ? screen.getByRole('columnheader', { name: reverse ? 'T' : 'A' })
      : activeCell(sheet.name, first);
    pointer(source, 'pointerdown', 50, 40);
    const x = mode === 'rows' ? 10 : reverse ? -10 : 130;
    const y = mode === 'columns' ? 10 : reverse ? -10 : 90;
    pointer(grid, 'pointermove', x, y);
    const beforeTick = state();
    const beforeOffsets = [container.scrollLeft, container.scrollTop];
    raf.run(container, 5);
    // Independent fixture arithmetic: 2x screen scaling, sticky header offsets,
    // fixed 76px columns / 26.4px rows and 18px scrolling per animation frame.
    const expectedAt = () => cellKey({
      columnIndex: mode === 'rows' ? 0 : Math.min(19, Math.max(0, Math.floor((container.scrollLeft + x * 2 - 40) / 76))),
      rowIndex: mode === 'columns' ? 0 : Math.min(29, Math.max(0, Math.floor((container.scrollTop + y * 2 - 26.4) / 26.4))),
    });
    expect(state().extent).toBe(expectedAt());
    expect(state().extent).not.toBe(beforeTick.extent);
    expect(state().anchor).toBe(first);
    if (mode === 'rows') expect(container.scrollLeft).toBe(beforeOffsets[0]);
    if (mode === 'columns') expect(container.scrollTop).toBe(beforeOffsets[1]);
    const initialMounted = new Set(screen.getAllByTestId('sheet-grid-cell').map((cell) => cell.dataset.cellKey));
    raf.run(container, 80);
    const endpoint = reverse ? 'A1' : mode === 'rows' ? 'A30' : mode === 'columns' ? 'T1' : 'T30';
    expect(state()).toMatchObject({ active: endpoint, extent: endpoint, anchor: first, mode });
    expect(state().extent).toBe(expectedAt());
    expect(container.scrollLeft).toBe(mode === 'rows' || reverse ? 0 : maximum.left);
    expect(container.scrollTop).toBe(mode === 'columns' || reverse ? 0 : maximum.top);
    expect(screen.getAllByTestId('sheet-grid-cell').some((cell) => !initialMounted.has(cell.dataset.cellKey))).toBe(true);
    expect(screen.getAllByTestId('sheet-grid-cell').length).toBeLessThan(500);
    raf.run(container, 3);
    expect(state().extent).toBe(endpoint);
    const queued = raf.queued();
    expect(queued.length).toBeGreaterThan(0);
    pointer(grid, mode === 'cells' ? 'pointerup' : 'pointercancel');
    const settled = state();
    const settledOffsets = [container.scrollLeft, container.scrollTop];
    queued.forEach((callback) => act(() => callback(0)));
    pointer(grid, 'pointermove', reverse ? 130 : -10, reverse ? 90 : -10);
    expect(state()).toEqual(settled);
    expect([container.scrollLeft, container.scrollTop]).toEqual(settledOffsets);
    expect(consumed).toHaveBeenCalledTimes(mode === 'cells' ? 1 : 0);
    expect(commands.updateCellContent).not.toHaveBeenCalled();
  });

  it('keeps owned consecutive moves live and focuses release extent for subsequent Shift-arrow reversal', async () => {
    const sheet = sheetDocument({ id: 'owned-rerender', name: 'Owned rerender' });
    render(<SelectionGrid sheet={sheet} />);
    const grid = screen.getByTestId('sheet-grid');
    virtualGridGeometry(grid.parentElement!);
    pointer(activeCell(sheet.name, 'B1'), 'pointerdown', 130, 40);
    pointer(grid, 'pointermove', 210, 40);
    pointer(grid, 'pointermove', 290, 40);
    expect(state()).toMatchObject({ anchor: 'B1', extent: 'D1', active: 'D1' });
    pointer(grid, 'pointerup');
    await waitFor(() => expect(activeCell(sheet.name, 'D1')).toHaveFocus());
    for (const key of ['C1', 'B1', 'A1']) {
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft', shiftKey: true });
      await waitFor(() => expect(activeCell(sheet.name, key)).toHaveFocus());
      expect(state()).toMatchObject({ anchor: 'B1', extent: key, active: key });
    }
  });
});
