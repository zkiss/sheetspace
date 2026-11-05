import { FormulaEditorPanel } from '@application/react/FormulaEditorPanel';
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
import { createModelEntryDraft } from '@application/core/modelEntryDraft';
import { keymap } from '@shared/keyboard/keymap';
import type { DataModel } from '@workbook/core/model';
import type { CellSelection } from './cellInteractionContracts';
import { pruneAxisSelection } from '@workbook/read/selection';

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

const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
const consumed = vi.fn();
function SelectionGrid({ sheet, replacement, replacementKey = 'C1', entryModel, logicalSelection, creating = false, activeKey, live = false }: {
  sheet: ReturnType<typeof sheetDocument>;
  entryModel?: DataModel;
  replacement?: 'cell' | 'range' | 'edit';
  replacementKey?: string;
  logicalSelection?: CellSelection | null;
  creating?: boolean;
  activeKey?: string;
  live?: boolean;
}) {
  const workbook = useMemo(() => workbookWithSheets([sheet]), [sheet]);
  const interaction = useCellEditing({ commands, workbook });
  const interactionRef = useRef(interaction);
  interactionRef.current = interaction;
  const projection = tabularProjection(sheet);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!replacement) return;
    const target = cellTargetAt(sheet, replacementKey)!;
    if (replacement === 'edit') interactionRef.current.startEditingCell(target, 'retained draft');
    else interactionRef.current.selectReferenceTarget(replacement === 'cell'
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
    {live && <button onClick={() => interaction.activeCell && interaction.clearCellContent(interaction.activeCell)}>Clear selection</button>}
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
        entryRow={entryModel && { model: entryModel, session: { draft: createModelEntryDraft(entryModel), pending: false }, commands: { change: vi.fn(), leave: vi.fn(), dismiss: vi.fn(), submit: vi.fn().mockResolvedValue({}) } }}
        activeCellKey={activeKey ?? cellKeyForTarget(sheet, interaction.activeCell)}
        activeSheetId={activeKey ? sheet.id : interaction.activeCell?.sheetId ?? null}
        selectionOwner={interaction.selectionOwner}
        axisProjection={projectGridAxes(projection, creating ? { columns: [{ kind: 'creating', operationId: 'c', boundary: 1 }], rows: [{ kind: 'creating', operationId: 'r', boundary: 1 }] } : { columns: [], rows: [] })}
        cellInteraction={{ clear: interaction.clearCellContent, select: interaction.selectCell, extend: interaction.extendSelection,
          focusSelection: interaction.focusSelection, focusCurrentSelection: interaction.focusCurrentSelection, settleSelectionGesture: interaction.settleSelectionGesture, navigate: interaction.navigateCell, startEditing: interaction.startEditingCell }}
        editingCell={interaction.editingCell}
        editorInteraction={{ FormulaEditor: FormulaEditorPanel, cancel: interaction.cancelActiveEdit, commit: interaction.commitActiveEdit,
          commitAndNavigate: interaction.commitEditAndNavigate, updateValue: interaction.updateEditingCellValue,
          updateView: interaction.updateEditingCellView }}
        formulaResults={{}}
        keyboardFocusRequest={interaction.keyboardFocusRequest && {
          id: interaction.keyboardFocusRequest.id, targetKey: cellKeyForTarget(sheet, interaction.keyboardFocusRequest.target),
        }}
        onKeyboardFocusRequestConsumed={(id) => { consumed(id); interaction.acknowledgeKeyboardFocusRequest(id); }}
        navigationHighlightCellKey={null}
        scrollContainerRef={scrollContainerRef}
        selectedRange={selectedRange}
        logicalSelection={live ? range : logicalSelection}
        selectionMode={range?.mode}
        onSelectAxis={interaction.selectAxis}
        sheet={projection}
      />
    </div>
  </>;
}
function state() { return JSON.parse(screen.getByTestId('selection-state').textContent!); }
function activeCell(name: string, key: string) { return screen.getByRole('cell', { name: `${name} ${key} empty cell` }); }

describe('exact selection presentation', () => {
  it.each(['rows', 'columns'] as const)('connects modifier pointer selection to exact %s highlights', (mode) => {
    commands.writeCells.mockClear();
    const sheet = sheetDocument({ id: 'live', name: 'Live', rowCount: 4, columnCount: 4, cells: { A1: 'a', A2: 'b', A3: 'c', B1: 'd', C1: 'e' } });
    render(<SelectionGrid sheet={sheet} live />);
    const grid = screen.getByTestId('sheet-grid');
    const role = mode === 'rows' ? 'rowheader' : 'columnheader';
    const first = screen.getByRole(role, { name: mode === 'rows' ? '1' : 'A' });
    const third = screen.getByRole(role, { name: mode === 'rows' ? '3' : 'C' });
    pointer(first, 'pointerdown');
    pointer(grid, 'pointerup');
    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
    Object.defineProperty(event, 'pointerId', { value: 22 });
    fireEvent(third, event);
    pointer(grid, 'pointermove', 210, 110);
    pointer(grid, 'pointerup', 210, 110);
    expect(screen.getByTestId('sheet-grid').querySelector('[data-cell-key="A1"]')).toHaveClass('sheet-grid-cell-range-selected');
    expect(screen.getByTestId('sheet-grid').querySelector(`[data-cell-key="${mode === 'rows' ? 'A2' : 'B1'}"]`)).not.toHaveClass('sheet-grid-cell-range-selected');
    expect(screen.getByTestId('sheet-grid').querySelector(`[data-cell-key="${mode === 'rows' ? 'A3' : 'C1'}"]`)).toHaveClass('sheet-grid-cell-range-selected');
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    const writes = commands.writeCells.mock.calls[0]![0] as { rowId: string; columnId: string }[];
    const axis = sheet.content[mode];
    expect(writes.some((write) => (mode === 'rows' ? write.rowId : write.columnId) === axis[2])).toBe(true);
    expect(writes.every((write) => (mode === 'rows' ? write.rowId : write.columnId) !== axis[1])).toBe(true);
  });
  it.each(['rows', 'columns'] as const)('renders reconciled %s after deletion with valid run borders', (mode) => {
    const sheet = sheetDocument({ id: 'delete', name: 'Delete', rowCount: 4, columnCount: 4 });
    const target = (i: number) => ({ sheetId: sheet.id, cell: { rowId: sheet.content.rows[mode === 'rows' ? i : 0]!, columnId: sheet.content.columns[mode === 'columns' ? i : 0]! } });
    const selection = { mode, anchor: target(0), extent: target(2), members: [sheet.content[mode][0]!, sheet.content[mode][2]!] };
    const next = { ...sheet, content: { ...sheet.content, [mode]: sheet.content[mode].slice(1) } };
    const reconciled = pruneAxisSelection(next, selection)!;
    render(<SelectionGrid sheet={next} logicalSelection={reconciled} activeKey={mode === 'rows' ? 'A2' : 'B1'} />);
    const gap = activeCell('Delete', 'A1');
    const selected = activeCell('Delete', mode === 'rows' ? 'A2' : 'B1');
    expect(gap).not.toHaveClass('sheet-grid-cell-range-selected');
    expect(selected).toHaveClass('sheet-grid-cell-range-selected', mode === 'rows' ? 'sheet-grid-selection-top' : 'sheet-grid-selection-left', mode === 'rows' ? 'sheet-grid-selection-bottom' : 'sheet-grid-selection-right');
  });

  it.each(['rows', 'columns'] as const)('keeps creating slots unselected within virtualized exact %s', (mode) => {
    const sheet = sheetDocument({ id: 'pending', name: 'Pending', rowCount: 30, columnCount: 20 });
    const target = (row: number, column: number) => ({ sheetId: sheet.id, cell: { rowId: sheet.content.rows[row]!, columnId: sheet.content.columns[column]! } });
    const selection: CellSelection = { mode, anchor: target(0, 0), extent: mode === 'rows' ? target(2, 0) : target(0, 2), members: [sheet.content[mode][0]!, sheet.content[mode][2]!] };
    render(<SelectionGrid sheet={sheet} logicalSelection={selection} creating />);
    expect(activeCell('Pending', 'A1')).toHaveClass('sheet-grid-cell-range-selected');
    expect(activeCell('Pending', mode === 'rows' ? 'A2' : 'B1')).not.toHaveClass('sheet-grid-cell-range-selected');
    expect(activeCell('Pending', mode === 'rows' ? 'A3' : 'C1')).toHaveClass('sheet-grid-cell-range-selected');
    const placeholders = document.querySelectorAll('.sheet-grid-cell-creating, .sheet-grid-axis-creating');
    expect(placeholders.length).toBeGreaterThan(0);
    placeholders.forEach((element) => expect(element).not.toHaveClass('sheet-grid-cell-range-selected', 'sheet-grid-axis-selected'));
    expect(screen.getAllByTestId('sheet-grid-cell').length).toBeLessThan(600);
  });
  it.each(['rows', 'columns'] as const)('updates %s membership with unchanged endpoints and reprojects a shift', (mode) => {
    const sheet = sheetDocument({ id: 'update', name: 'Update', rowCount: 5, columnCount: 5 });
    const target = (index: number) => ({ sheetId: sheet.id, cell: { rowId: sheet.content.rows[mode === 'rows' ? index : 0]!, columnId: sheet.content.columns[mode === 'columns' ? index : 0]! } });
    const ids = sheet.content[mode];
    const selection: CellSelection = { mode, anchor: target(0), extent: target(4), members: [ids[0]!, ids[2]!, ids[4]!] };
    const view = render(<SelectionGrid sheet={sheet} logicalSelection={selection} />);
    const cell = (i: number) => activeCell('Update', mode === 'rows' ? `A${i + 1}` : `${String.fromCharCode(65 + i)}1`);
    expect(cell(2)).toHaveClass('sheet-grid-cell-range-selected');
    view.rerender(<SelectionGrid sheet={sheet} logicalSelection={{ ...selection, members: [ids[0]!, ids[3]!, ids[4]!] }} />);
    expect(cell(2)).not.toHaveClass('sheet-grid-cell-range-selected');
    expect(cell(3)).toHaveClass('sheet-grid-cell-range-selected');
    expect(cell(3)).not.toHaveClass(mode === 'rows' ? 'sheet-grid-selection-bottom' : 'sheet-grid-selection-right');
    expect(cell(4)).not.toHaveClass(mode === 'rows' ? 'sheet-grid-selection-top' : 'sheet-grid-selection-left');
    const order = [ids[1]!, ids[0]!, ids[3]!, ids[2]!, ids[4]!];
    view.rerender(<SelectionGrid sheet={{ ...sheet, content: { ...sheet.content, [mode]: order } }} logicalSelection={selection} />);
    expect(cell(0)).not.toHaveClass('sheet-grid-cell-range-selected');
    expect(cell(1)).toHaveClass('sheet-grid-cell-range-selected');
    expect(cell(2)).not.toHaveClass('sheet-grid-cell-range-selected');
    expect(cell(3)).toHaveClass('sheet-grid-cell-range-selected');
    expect(cell(4)).toHaveClass('sheet-grid-cell-range-selected');
  });

  it('paints an ordinary cell rectangle with shared interior edges', () => {
    const sheet = sheetDocument({ id: 'rectangle', name: 'Rectangle', rowCount: 4, columnCount: 4 });
    const target = (row: number, column: number) => ({ sheetId: sheet.id, cell: { rowId: sheet.content.rows[row]!, columnId: sheet.content.columns[column]! } });
    render(<SelectionGrid sheet={sheet} logicalSelection={{ mode: 'cells', anchor: target(0, 0), extent: target(1, 1) }} />);
    expect(activeCell('Rectangle', 'A1')).not.toHaveClass('sheet-grid-selection-bottom', 'sheet-grid-selection-right');
    expect(activeCell('Rectangle', 'B2')).not.toHaveClass('sheet-grid-selection-top', 'sheet-grid-selection-left');
    expect(activeCell('Rectangle', 'B2')).toHaveClass('sheet-grid-selection-bottom', 'sheet-grid-selection-right');
    expect(activeCell('Rectangle', 'C2')).not.toHaveClass('sheet-grid-cell-range-selected');
  });
  it.each(['rows', 'columns'] as const)('paints separated %s and their independent edges after reorder', (mode) => {
    const sheet = sheetDocument({ id: 'exact', name: 'Exact', rowCount: 4, columnCount: 4 });
    const target = (row: number, column: number) => ({ sheetId: sheet.id, cell: { rowId: sheet.content.rows[row]!, columnId: sheet.content.columns[column]! } });
    const selection: CellSelection = { mode, anchor: target(0, 0), extent: mode === 'rows' ? target(2, 0) : target(0, 2), members: mode === 'rows' ? [sheet.content.rows[0]!, sheet.content.rows[2]!] : [sheet.content.columns[0]!, sheet.content.columns[2]!] };
    const view = render(<SelectionGrid sheet={sheet} logicalSelection={selection} />);
    const first = activeCell('Exact', 'A1');
    const gap = activeCell('Exact', mode === 'rows' ? 'A2' : 'B1');
    const second = activeCell('Exact', mode === 'rows' ? 'A3' : 'C1');
    expect(first).toHaveClass(mode === 'rows' ? 'sheet-grid-selection-bottom' : 'sheet-grid-selection-right');
    expect(second).toHaveClass(mode === 'rows' ? 'sheet-grid-selection-top' : 'sheet-grid-selection-left');
    expect(first).toHaveClass('sheet-grid-cell-range-selected');
    expect(second).toHaveClass('sheet-grid-cell-range-selected');
    expect(gap).not.toHaveClass('sheet-grid-cell-range-selected');
    const headers = screen.getAllByRole(mode === 'rows' ? 'rowheader' : 'columnheader').filter((header) => header.hasAttribute('data-axis-durable-index'));
    expect(headers[0]).toHaveClass('sheet-grid-axis-selected');
    expect(headers[1]).not.toHaveClass('sheet-grid-axis-selected');
    expect(headers[2]).toHaveClass('sheet-grid-axis-selected');
    const content = { ...sheet.content, [mode]: [...sheet.content[mode]] };
    [content[mode][1], content[mode][2]] = [content[mode][2]!, content[mode][1]!];
    view.rerender(<SelectionGrid sheet={{ ...sheet, content }} logicalSelection={selection} />);
    expect(activeCell('Exact', 'A1')).not.toHaveClass(mode === 'rows' ? 'sheet-grid-selection-bottom' : 'sheet-grid-selection-right');
    expect(activeCell('Exact', mode === 'rows' ? 'A2' : 'B1')).not.toHaveClass(mode === 'rows' ? 'sheet-grid-selection-top' : 'sheet-grid-selection-left');
  });

  it.each(['rows', 'columns'] as const)('retains the active identity through %s reorder and reversal', async (axis) => {
    const sheet = sheetDocument({ id: 'reorder-focus', name: 'Reorder focus', rowCount: 4, columnCount: 4 });
    const view = render(<SelectionGrid sheet={sheet} live />);
    const grid = screen.getByTestId('sheet-grid');
    virtualGridGeometry(grid.parentElement!);
    pointer(activeCell(sheet.name, 'B2'), 'pointerdown', 130, 66);
    pointer(grid, 'pointerup', 130, 66);
    await waitFor(() => expect(activeCell(sheet.name, 'B2')).toHaveFocus());

    const content = { ...sheet.content, [axis]: [...sheet.content[axis]] };
    [content[axis][1], content[axis][2]] = [content[axis][2]!, content[axis][1]!];
    view.rerender(<SelectionGrid sheet={{ ...sheet, content }} live />);
    const moved = axis === 'rows' ? 'B3' : 'C2';
    await waitFor(() => expect(state()).toMatchObject({ active: moved, anchor: moved, extent: moved }));
    expect(activeCell(sheet.name, moved)).toHaveFocus();

    view.rerender(<SelectionGrid sheet={sheet} live />);
    await waitFor(() => expect(state()).toMatchObject({ active: 'B2', anchor: 'B2', extent: 'B2' }));
    expect(activeCell(sheet.name, 'B2')).toHaveFocus();
  });

  it('keeps a newer selection when an earlier order is restored', async () => {
    const sheet = sheetDocument({ id: 'reorder-history', name: 'Reorder history', rowCount: 4, columnCount: 4 });
    const content = { ...sheet.content, rows: [...sheet.content.rows] };
    [content.rows[1], content.rows[2]] = [content.rows[2]!, content.rows[1]!];
    const view = render(<SelectionGrid sheet={{ ...sheet, content }} live />);
    const grid = screen.getByTestId('sheet-grid');
    virtualGridGeometry(grid.parentElement!);
    pointer(activeCell(sheet.name, 'C3'), 'pointerdown', 210, 92);
    pointer(grid, 'pointerup', 210, 92);
    await waitFor(() => expect(activeCell(sheet.name, 'C3')).toHaveFocus());

    view.rerender(<SelectionGrid sheet={sheet} live />);
    await waitFor(() => expect(state()).toMatchObject({ active: 'C2', anchor: 'C2', extent: 'C2' }));
    expect(activeCell(sheet.name, 'C2')).toHaveFocus();
  });
});

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


it('enters the model row using the rebound down action only from the active bottom cell', () => {
  const original = keymap['grid-down'];
  Object.assign(keymap, { 'grid-down': [{ key: 'F8' }] });
  try {
    const sheet = sheetDocument({ id: 'entry', name: 'Entry', rowCount: 1, columnCount: 1 });
    const model: DataModel = { id: 'model', name: 'Model', columns: [{ id: 'value', name: 'Value', kind: 'manual', type: 'int' }] };
    render(<SelectionGrid sheet={sheet} entryModel={model} />);
    const cell = activeCell('Entry', 'A1');
    pointer(cell, 'pointerdown');
    cell.focus();
    fireEvent.keyDown(cell, { key: 'ArrowDown' });
    expect(cell).toHaveFocus();
    fireEvent.keyDown(cell, { key: 'F8', ctrlKey: true });
    expect(cell).toHaveFocus();
    fireEvent.keyDown(cell, { key: 'F8' });
    expect(screen.getByRole('cell', { name: 'Value new record' })).toHaveFocus();
  } finally { Object.assign(keymap, { 'grid-down': original }); }
});
