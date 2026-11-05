import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormulaEditorPanel } from '@application/react/FormulaEditorPanel';
import { projectGridAxes } from './gridAxisProjection';
import { SheetGrid } from './SheetGrid';
import { workbookWithSheets, smallSheetDocument } from '@test-support/workbookFactories';
import { tabularProjection } from '@workbook/read/queries';
import { testRect, virtualGridGeometry } from '@test-support/domGeometry';
import { gatherAxis } from '@workbook/mutations/reorderAxis';
import { cellTargetAt } from './cellInteraction';

function pointer(element: Element, type: string, x: number, y: number, pointerId = 1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  fireEvent(element, event);
}
function setup(axis: 'rows' | 'columns' = 'rows', allowColumnGather = true) {
  const sheet = tabularProjection(smallSheetDocument({ id: 'gather', name: 'Gather' }));
  const ref = createRef<HTMLDivElement>();
  const gather = vi.fn(); const select = vi.fn(); const activity = vi.fn();
  const anchor = cellTargetAt(sheet, 'A1')!;
  const selection = { mode: axis, anchor, extent: anchor, members: axis === 'rows' ? [sheet.rows[0], sheet.rows[2]] : [sheet.columns[0], sheet.columns[2]] };
  render(<div ref={ref}><SheetGrid activeCellKey="A1" activeSheetId={sheet.id} axisProjection={projectGridAxes(sheet)}
    cellInteraction={{ clear: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn() }}
    editingCell={null} editorInteraction={{ FormulaEditor: FormulaEditorPanel, cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() }}
    formulaResults={{}} keyboardFocusRequest={null} onKeyboardFocusRequestConsumed={vi.fn()} navigationHighlightCellKey={null}
    logicalSelection={selection} onSelectAxis={select} onGatherAxis={gather} allowColumnGather={allowColumnGather}
    onPointerInteractionChange={activity} scrollContainerRef={ref} sheet={sheet} /></div>);
  virtualGridGeometry(ref.current!, { width: 400, height: 160 });
  return { sheet, gather, select, activity, container: ref.current!, grid: screen.getByTestId('sheet-grid') };
}
afterEach(cleanup);
describe('header gather controls', () => {
  it('gathers scattered selected rows at the original gap without selecting again', () => {
    const { sheet, gather, select, activity, grid } = setup();
    pointer(screen.getByRole('button', { name: 'Drag row 1' }), 'pointerdown', 20, 30);
    expect(activity).toHaveBeenLastCalledWith(sheet.id, true);
    pointer(grid, 'pointermove', 20, 100);
    expect(screen.getByTestId('axis-gather-preview')).toHaveStyle({ height: '52.8px' });
    expect(gather).not.toHaveBeenCalled();
    pointer(grid, 'pointerup', 20, 100);
    expect(gather).toHaveBeenCalledWith('row', [sheet.rows[0], sheet.rows[2]], 3);
    expect(select).not.toHaveBeenCalled();
  });
  it('uses the column control and does not commit below the threshold', () => {
    const { sheet, gather, grid } = setup('columns');
    const button = screen.getByRole('button', { name: 'Drag column A' });
    pointer(button, 'pointerdown', 50, 10); pointer(grid, 'pointerup', 53, 10);
    expect(gather).not.toHaveBeenCalled();
    pointer(button, 'pointerdown', 50, 10); pointer(grid, 'pointermove', 230, 10); pointer(grid, 'pointerup', 230, 10);
    expect(gather).toHaveBeenCalledWith('column', [sheet.columns[0], sheet.columns[2]], 3);
  });
  it('ignores foreign pointers and cancels on escape', () => {
    const { gather, grid } = setup();
    pointer(screen.getByRole('button', { name: 'Drag row 1' }), 'pointerdown', 20, 30);
    pointer(grid, 'pointerup', 20, 100, 2);
    pointer(grid, 'pointermove', 20, 100);
    fireEvent.keyDown(window, { key: 'Escape' });
    pointer(grid, 'pointerup', 20, 100);
    expect(gather).not.toHaveBeenCalled();
    expect(screen.queryByTestId('axis-gather-preview')).not.toBeInTheDocument();
  });
  it('selects an unselected source and dispatches only that identity', () => {
    const { sheet, gather, select, grid } = setup();
    pointer(screen.getByRole('button', { name: 'Drag row 2' }), 'pointerdown', 20, 60);
    expect(select).toHaveBeenCalledWith('rows', expect.objectContaining({ cell: expect.objectContaining({ rowId: sheet.rows[1] }) }), false, expect.objectContaining({ start: true }));
    pointer(grid, 'pointermove', 20, 100); pointer(grid, 'pointerup', 20, 100);
    expect(gather).toHaveBeenCalledWith('row', [sheet.rows[1]], 3);
  });
  it('rejects invalid destinations and pointer cancellation', () => {
    const { gather, grid } = setup();
    const button = screen.getByRole('button', { name: 'Drag row 1' });
    pointer(button, 'pointerdown', 20, 30); pointer(grid, 'pointermove', 100, 100); pointer(grid, 'pointerup', 100, 100);
    expect(gather).not.toHaveBeenCalled();
    pointer(button, 'pointerdown', 20, 30); pointer(grid, 'pointermove', 20, 100); pointer(grid, 'pointercancel', 20, 100);
    pointer(grid, 'pointerup', 20, 100);
    expect(gather).not.toHaveBeenCalled();
  });
  it('passes the original gap to the real gather mutation', () => {
    const { sheet, gather, grid } = setup();
    pointer(screen.getByRole('button', { name: 'Drag row 1' }), 'pointerdown', 20, 30);
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
    pointer(screen.getByRole('button', { name: 'Drag row 1' }), 'pointerdown', 20, 28);
    pointer(grid, 'pointermove', 20, 47);
    expect(screen.getByTestId('axis-gather-preview')).toHaveStyle({ top: '52.8px', height: '52.8px' });
    pointer(grid, 'pointerup', 20, 47);
    expect(gather).toHaveBeenCalledWith('row', [sheet.rows[0], sheet.rows[2]], 3);
  });
  it('cancels on lost capture or window blur and starts a fresh gesture', () => {
    const { gather, grid } = setup();
    const button = screen.getByRole('button', { name: 'Drag row 1' });
    pointer(button, 'pointerdown', 20, 30); pointer(grid, 'pointermove', 20, 100);
    pointer(grid, 'lostpointercapture', 20, 100); pointer(grid, 'pointerup', 20, 100);
    pointer(button, 'pointerdown', 20, 30); fireEvent.blur(window); pointer(grid, 'pointerup', 20, 100);
    expect(gather).not.toHaveBeenCalled();
    pointer(button, 'pointerdown', 20, 30); pointer(grid, 'pointerup', 20, 100);
    expect(gather).toHaveBeenCalledTimes(1);
  });
  it('does not offer model-owned column controls', () => {
    setup('columns', false);
    expect(screen.queryByRole('button', { name: 'Drag column A' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drag row 1' })).toBeInTheDocument();
  });
});
