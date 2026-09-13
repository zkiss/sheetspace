import { useRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CellSelection } from './cellInteractionContracts';
import { sheetDocument } from '@test-support/workbookFactories';
import { testRect, virtualGridGeometry } from '@test-support/domGeometry';
import { tabularProjection } from '@workbook/read/queries';
import { projectGridAxes } from './gridAxisProjection';
import { SheetGrid } from './SheetGrid';

const sheet = sheetDocument({ id: 'sizes', name: 'Sizes', rowCount: 1000, columnCount: 100 });
const commit = vi.fn(), select = vi.fn();
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function pointer(element: Element, type: string, x = 0, y = 0, id = 7) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: id });
  fireEvent(element, event);
}
function Grid({ selection, owner, activeSheetId = sheet.id }: { selection?: CellSelection; owner?: symbol; activeSheetId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const tabular = tabularProjection(sheet);
  return <div ref={ref}><SheetGrid sheet={tabular} axisProjection={projectGridAxes(tabular)} presentation={sheet.presentation}
    activeCellKey={null} activeSheetId={activeSheetId} logicalSelection={selection} selectionOwner={owner}
    cellInteraction={{ clear: vi.fn(), navigate: vi.fn(), select, startEditing: vi.fn() }}
    editingCell={null} editorInteraction={{ cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() }}
    formulaResults={{}} keyboardFocusRequest={null} onKeyboardFocusRequestConsumed={vi.fn()}
    navigationHighlightCellKey={null} scrollContainerRef={ref} onWriteAxisSizes={commit} /></div>;
}
function handle(axis: 'row' | 'column', label: string) { return screen.getByRole('separator', { name: `Resize ${axis} ${label}` }); }
function selection(mode: 'rows' | 'columns' | 'cells', end = 90): CellSelection {
  return { mode, anchor: { sheetId: sheet.id, cell: { rowId: sheet.content.rows[0], columnId: sheet.content.columns[0] } },
    extent: { sheetId: sheet.id, cell: { rowId: sheet.content.rows[end], columnId: sheet.content.columns[end] } } };
}

describe('axis resizing', () => {
  it.each([0.5, 1, 2])('previews logical column dimensions at scale %s and commits once without selecting', (scale) => {
    render(<Grid />);
    const boundary = handle('column', 'A');
    boundary.parentElement!.getBoundingClientRect = () => testRect({ left: 0, top: 0, width: 76 * scale, height: 26.4 * scale });
    pointer(boundary, 'pointerdown', 10);
    pointer(boundary, 'pointermove', 10 + 40 * scale);
    expect(boundary.parentElement).toHaveStyle({ width: '116px' });
    expect(screen.getByRole('cell', { name: 'Sizes A1 empty cell' })).toHaveStyle({ width: '116px' });
    expect(screen.getByRole('cell', { name: 'Sizes B1 empty cell' })).toHaveStyle({ left: '156px' });
    expect(commit).not.toHaveBeenCalled();
    pointer(boundary, 'pointerup', 10 + 40 * scale);
    pointer(boundary, 'pointerup', 10 + 40 * scale);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith([{ axis: 'column', axisId: sheet.content.columns[0], size: 116 }]);
    expect(select).not.toHaveBeenCalled();
  });
  it.each([0.5, 2])('converts row pointer deltas at scale %s', (scale) => {
    render(<Grid />); const boundary = handle('row', '1');
    boundary.parentElement!.getBoundingClientRect = () => testRect({ left: 0, top: 0, width: 40 * scale, height: 26.4 * scale });
    pointer(boundary, 'pointerdown', 0, 10); pointer(boundary, 'pointerup', 0, 10 + 20 * scale);
    expect(commit).toHaveBeenCalledWith([{ axis: 'row', axisId: sheet.content.rows[0], size: 46.4 }]);
  });
  it.each([['row', '1', -100, 16], ['row', '1', 5000, 1000], ['column', 'A', -100, 24], ['column', 'A', 5000, 2000]] as const)(
    'clamps %s deltas %s %s to %s', (axis, label, delta, size) => {
      render(<Grid />); const boundary = handle(axis, label);
      pointer(boundary, 'pointerdown'); pointer(boundary, 'pointermove', delta, delta); pointer(boundary, 'pointerup', delta, delta);
      expect(commit.mock.calls[0][0][0].size).toBe(size);
    });
  it.each(['rows', 'columns'] as const)('previews and commits all selected %s including offscreen stable IDs', (mode) => {
    render(<Grid selection={selection(mode)} />);
    const boundary = handle(mode === 'rows' ? 'row' : 'column', mode === 'rows' ? '1' : 'A');
    expect(screen.queryByRole('separator', { name: mode === 'rows' ? 'Resize row 91' : 'Resize column CM' })).toBeNull();
    pointer(boundary, 'pointerdown'); pointer(boundary, 'pointermove', 20, 20);
    const second = handle(mode === 'rows' ? 'row' : 'column', mode === 'rows' ? '2' : 'B');
    expect(second.parentElement).toHaveStyle(mode === 'rows' ? { height: '46.4px' } : { width: '96px' });
    pointer(boundary, 'pointerup', 20, 20);
    expect(commit.mock.calls[0][0]).toHaveLength(91);
    expect(new Set(commit.mock.calls[0][0].map((write: { size: number }) => write.size)).size).toBe(1);
  });
  it.each(['cells', 'rows'] as const)('targets only a column with %s selection', (mode) => {
    render(<Grid selection={selection(mode)} />); const boundary = handle('column', 'A');
    pointer(boundary, 'pointerdown'); pointer(boundary, 'pointerup', 20);
    expect(commit.mock.calls[0][0]).toHaveLength(1);
  });
  it('targets only an unselected axis', () => {
    render(<Grid selection={selection('columns', 0)} />); const boundary = handle('column', 'B');
    pointer(boundary, 'pointerdown'); pointer(boundary, 'pointerup', 20);
    expect(commit.mock.calls[0][0]).toEqual([{ axis: 'column', axisId: sheet.content.columns[1], size: 96 }]);
  });
  it.each(['pointercancel', 'lostpointercapture', 'escape', 'blur', 'unmount'])( 'discards preview on %s', (interruption) => {
    const view = render(<Grid />); const boundary = handle('row', '1');
    pointer(boundary, 'pointerdown'); pointer(boundary, 'pointermove', 0, 50);
    expect(boundary.parentElement).toHaveStyle({ height: '76.4px' });
    if (interruption === 'escape') fireEvent.keyDown(window, { key: 'Escape' });
    else if (interruption === 'blur') fireEvent.blur(window);
    else if (interruption === 'unmount') view.unmount();
    else pointer(boundary, interruption);
    pointer(boundary, 'pointerup', 0, 50);
    expect(commit).not.toHaveBeenCalled();
    if (interruption !== 'unmount') expect(boundary.parentElement).toHaveStyle({ height: '26.4px' });
  });
  it.each(['selection', 'owner', 'sheet'] as const)('rejects stale release after replacing %s', (replacement) => {
    const selected = selection('columns'), owner = Symbol();
    const view = render(<Grid selection={selected} owner={owner} />); const boundary = handle('column', 'A');
    pointer(boundary, 'pointerdown'); pointer(boundary, 'pointermove', 50);
    view.rerender(<Grid selection={replacement === 'selection' ? selection('rows') : selected}
      owner={replacement === 'owner' ? Symbol() : owner} activeSheetId={replacement === 'sheet' ? 'elsewhere' : sheet.id} />);
    pointer(boundary, 'pointerup', 50);
    expect(commit).not.toHaveBeenCalled();
  });
  it('updates measured virtual windows and extents while keeping mounted cells bounded', () => {
    const view = render(<Grid />);
    virtualGridGeometry(screen.getByTestId('sheet-grid').parentElement!, { width: 240, height: 160 });
    const boundary = handle('column', 'A');
    pointer(boundary, 'pointerdown'); pointer(boundary, 'pointermove', 500);
    expect(screen.getByTestId('sheet-grid')).toHaveStyle({ width: `${40 + 100 * 76 + 500}px` });
    expect(view.container.querySelectorAll('[role="cell"]').length).toBeLessThan(500);
    pointer(boundary, 'pointercancel');
  });
});
