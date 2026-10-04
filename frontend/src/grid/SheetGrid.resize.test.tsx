import { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CellSelection } from './cellInteractionContracts';
import { sheetDocument } from '@test-support/workbookFactories';
import { testRect, virtualGridGeometry } from '@test-support/domGeometry';
import { tabularProjection } from '@workbook/read/queries';
import { projectGridAxes } from './gridAxisProjection';
import { SheetGrid } from './SheetGrid';

const sheet = sheetDocument({ id: 'sizes', name: 'Sizes', rowCount: 10, columnCount: 10 });
const virtualizedSheet = sheetDocument({ id: 'virtual-sizes', name: 'Virtual sizes', rowCount: 1000, columnCount: 100 });
const commit = vi.fn(), select = vi.fn();
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function pointer(element: Element, type: string, x = 0, y = 0, id = 7) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: id });
  fireEvent(element, event);
}
function Grid({ document = sheet, selection, owner, activeSheetId = document.id, resizable = true, presentation = document.presentation }: {
  document?: typeof sheet; selection?: CellSelection; owner?: symbol; activeSheetId?: string; resizable?: boolean; presentation?: typeof sheet.presentation;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tabular = tabularProjection(document);
  return <div ref={ref}><SheetGrid sheet={tabular} axisProjection={projectGridAxes(tabular)} presentation={presentation}
    activeCellKey={null} activeSheetId={activeSheetId} logicalSelection={selection} selectionOwner={owner}
    cellInteraction={{ clear: vi.fn(), navigate: vi.fn(), select, startEditing: vi.fn() }}
    editingCell={null} editorInteraction={{ cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() }}
    formulaResults={{}} keyboardFocusRequest={null} onKeyboardFocusRequestConsumed={vi.fn()}
    navigationHighlightCellKey={null} scrollContainerRef={ref} onWriteAxisSizes={resizable ? commit : undefined} /></div>;
}
function handle(axis: 'row' | 'column', label: string) { return screen.getByRole('separator', { name: `Resize ${axis} ${label}` }); }
function selection(mode: 'rows' | 'columns' | 'cells', end = 90, document = sheet): CellSelection {
  return { mode, anchor: { sheetId: document.id, cell: { rowId: document.content.rows[0], columnId: document.content.columns[0] } },
    extent: { sheetId: document.id, cell: { rowId: document.content.rows[end], columnId: document.content.columns[end] } } };
}

describe('axis resizing', () => {
  it.each([16, 26.4, 80])('uses the projected %spx row height for cell text during preview and after restoration', (height) => {
    const view = render(<Grid />);
    const cell = screen.getByRole('cell', { name: 'Sizes A1 empty cell' });
    const boundary = handle('row', '1');
    const grid = screen.getByTestId('sheet-grid');
    const header = screen.getByTestId('sheet-grid-header-row');
    function expectTextHeight(expected: number) {
      expect(cell).toHaveStyle({ height: `${expected}px`, lineHeight: `${expected}px` });
      expect(grid.style.getPropertyValue('--grid-cell-height')).toBe('1.65rem');
      expect(header.style.getPropertyValue('--grid-cell-height')).toBe('');
    }
    pointer(boundary, 'pointerdown'); pointer(boundary, 'pointermove', 0, height - 26.4);
    expectTextHeight(height);
    pointer(boundary, 'pointercancel');
    expectTextHeight(26.4);
    expect(commit).not.toHaveBeenCalled();
    view.rerender(<Grid presentation={{ rowHeights: { [sheet.content.rows[0]]: height }, columnWidths: {} }} />);
    expectTextHeight(height);
  });
  it('wires scaled column pointer previews to cells and headers, then commits once without selecting', () => {
    render(<Grid />);
    const boundary = handle('column', 'A');
    boundary.parentElement!.getBoundingClientRect = () => testRect({ left: 0, top: 0, width: 38, height: 26.4 });
    pointer(boundary, 'pointerdown', 10);
    pointer(boundary, 'pointermove', 30);
    expect(boundary.parentElement).toHaveStyle({ width: '116px' });
    expect(screen.getByRole('cell', { name: 'Sizes A1 empty cell' })).toHaveStyle({ width: '116px' });
    expect(screen.getByRole('cell', { name: 'Sizes B1 empty cell' })).toHaveStyle({ left: '156px' });
    expect(commit).not.toHaveBeenCalled();
    pointer(boundary, 'pointerup', 30);
    pointer(boundary, 'pointerup', 30);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith([{ axis: 'column', axisId: sheet.content.columns[0], size: 116 }]);
    expect(select).not.toHaveBeenCalled();
  });
  it.each(['rows', 'columns'] as const)('retains the later selected %s capture owner through growing previews and scrolling', (mode) => {
    const view = render(<Grid document={virtualizedSheet} selection={selection(mode, 90, virtualizedSheet)} />);
    const grid = screen.getByTestId('sheet-grid'), viewport = grid.parentElement!;
    act(() => { virtualGridGeometry(viewport, { width: 600, height: 160 }); });
    const axis = mode === 'rows' ? 'row' : 'column';
    const boundary = handle(axis, mode === 'rows' ? '6' : 'F');
    expect(screen.queryByRole('separator', { name: `Resize ${axis} ${mode === 'rows' ? '91' : 'CM'}` })).toBeNull();
    expect(screen.getByRole('cell', { name: 'Virtual sizes A1 empty cell' })).toBeInTheDocument();
    const capture = vi.fn();
    boundary.setPointerCapture = capture;
    pointer(boundary, 'pointerdown');
    expect(capture).toHaveBeenCalledWith(7);
    pointer(boundary, 'pointermove', 1000, 1000);
    // Earlier selected axes push the originating header outside the normal window.
    expect(boundary.isConnected).toBe(true);
    expect(handle(axis, mode === 'rows' ? '6' : 'F')).toBe(boundary);
    expect(mode === 'rows' ? boundary.closest('[role="row"]') : boundary.parentElement)
      .toHaveStyle(mode === 'rows' ? { top: '5026.4px' } : { left: '5420px' });
    act(() => {
      viewport.scrollLeft = 7000;
      viewport.scrollTop = 12000;
      fireEvent.scroll(viewport);
    });
    expect(boundary.isConnected).toBe(true);
    expect(view.container.querySelectorAll('[role="cell"]').length).toBeLessThan(500);
    expect(screen.queryByRole('cell', { name: 'Virtual sizes A1 empty cell' })).toBeNull();
    pointer(boundary, 'pointerup', 1000, 1000);
    pointer(boundary, 'pointerup', 1000, 1000);
    expect(commit).toHaveBeenCalledTimes(1);
    const ids = mode === 'rows' ? virtualizedSheet.content.rows : virtualizedSheet.content.columns;
    expect(commit).toHaveBeenCalledWith(ids.slice(0, 91).map((axisId) => ({ axis, axisId, size: mode === 'rows' ? 1000 : 1076 })));
  });
  it.each(['rows', 'columns'] as const)('discards a later selected %s preview when its retained owner loses capture', (mode) => {
    render(<Grid document={virtualizedSheet} selection={selection(mode, 5, virtualizedSheet)} />);
    const grid = screen.getByTestId('sheet-grid');
    act(() => { virtualGridGeometry(grid.parentElement!, { width: 600, height: 160 }); });
    const axis = mode === 'rows' ? 'row' : 'column';
    const boundary = handle(axis, mode === 'rows' ? '6' : 'F');
    pointer(boundary, 'pointerdown'); pointer(boundary, 'pointermove', 1000, 1000);
    pointer(boundary, 'lostpointercapture'); pointer(boundary, 'pointerup', 1000, 1000);
    expect(commit).not.toHaveBeenCalled();
    expect(grid).toHaveStyle({ width: '7640px' });
    expect(parseFloat(grid.style.height)).toBe(Math.ceil(26426.4));
    const next = handle(axis, mode === 'rows' ? '1' : 'A');
    pointer(next, 'pointerdown'); pointer(next, 'pointerup', 20, 20);
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it('discards preview when its capture handle is removed while the grid remains mounted', () => {
    const selected = selection('columns', 5, virtualizedSheet);
    const view = render(<Grid document={virtualizedSheet} selection={selected} />);
    const grid = screen.getByTestId('sheet-grid'), boundary = handle('column', 'F');
    const release = vi.fn();
    boundary.hasPointerCapture = () => true;
    boundary.releasePointerCapture = release;
    pointer(boundary, 'pointerdown'); pointer(boundary, 'pointermove', 1000);
    view.rerender(<Grid document={virtualizedSheet} selection={selected} resizable={false} />);
    expect(boundary.isConnected).toBe(false);
    expect(release).toHaveBeenCalledWith(7);
    expect(grid).toHaveStyle({ width: '7640px' });
    pointer(boundary, 'pointerup', 1000);
    expect(commit).not.toHaveBeenCalled();
    view.rerender(<Grid document={virtualizedSheet} selection={selected} />);
    const next = handle('column', 'A');
    pointer(next, 'pointerdown'); pointer(next, 'pointerup', 20);
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it('updates measured virtual windows and extents while keeping mounted cells bounded', () => {
    const view = render(<Grid document={virtualizedSheet} />);
    virtualGridGeometry(screen.getByTestId('sheet-grid').parentElement!, { width: 240, height: 160 });
    const boundary = handle('column', 'A');
    expect(screen.getByRole('cell', { name: 'Virtual sizes A1 empty cell' })).toBeInTheDocument();
    pointer(boundary, 'pointerdown'); pointer(boundary, 'pointermove', 500);
    expect(screen.getByTestId('sheet-grid')).toHaveStyle({ width: `${40 + 100 * 76 + 500}px` });
    expect(view.container.querySelectorAll('[role="cell"]').length).toBeLessThan(500);
    pointer(boundary, 'pointercancel');
    expect(screen.getByRole('cell', { name: 'Virtual sizes A1 empty cell' })).toBeInTheDocument();
  });
});
