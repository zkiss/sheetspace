import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectGridAxes } from '@grid/gridAxisProjection';
import { SheetGrid } from '@grid/SheetGrid';
import { sheetDocument } from '@test-support/workbookFactories';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import { tabularProjection } from '@workbook/read/queries';
import { virtualGridGeometry } from '@test-support/domGeometry';

afterEach(cleanup);
function firePointer(
  element: Element,
  type: string,
  { pointerId = 1, ...init }: MouseEventInit & { pointerId?: number } = {},
) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  fireEvent(element, event);
}


describe('SheetGrid pointer selection', () => {
  it('does not start a selection from controls, non-primary pointers, or cells without a durable target', () => {
    const sheet = tabularProjection(sheetDocument({ id: 'sheet-pointer-guards', name: 'Pointer guards' }));
    const axisProjection = projectGridAxes(sheet, { columns: [], rows: [] });
    const scrollContainerRef = createRef<HTMLDivElement>();
    const cellInteraction = { clear: vi.fn(), extend: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn() };

    render(
      <div ref={scrollContainerRef} style={{ overflow: 'auto' }}>
        <button type="button">Outside control</button>
        <SheetGrid activeCellKey={null} axisProjection={axisProjection} cellInteraction={cellInteraction}
          editingCell={null} editorInteraction={{ cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() }}
          formulaResults={{}} keyboardFocusRequest={null} onKeyboardFocusRequestConsumed={vi.fn()}
          navigationHighlightCellKey={null} scrollContainerRef={scrollContainerRef} sheet={sheet} />
      </div>,
    );

    const grid = screen.getByTestId('sheet-grid');
    const a1 = screen.getByRole('cell', { name: 'Pointer guards A1 empty cell' });
    firePointer(a1, 'pointerdown', { button: 2, pointerId: 41 });
    firePointer(grid, 'pointerdown', { button: 0, pointerId: 42 });
    firePointer(screen.getByRole('button', { name: 'Outside control' }), 'pointerdown', { button: 0, pointerId: 43 });

    expect(cellInteraction.select).not.toHaveBeenCalled();
    expect(cellInteraction.extend).not.toHaveBeenCalled();
  });

  it('keeps invalid focus and navigation keys inert instead of acknowledging a phantom cell', async () => {
    const sheet = tabularProjection(sheetDocument({ id: 'sheet-invalid-focus', name: 'Invalid focus' }));
    const axisProjection = projectGridAxes(sheet, { columns: [], rows: [] });
    const scrollContainerRef = createRef<HTMLDivElement>();
    const consumed = vi.fn();

    render(
      <div ref={scrollContainerRef} style={{ overflow: 'auto' }}>
        <SheetGrid activeCellKey="ZZ999" axisProjection={axisProjection}
          cellInteraction={{ clear: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn() }}
          editingCell={null} editorInteraction={{ cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() }}
          formulaResults={{}} keyboardFocusRequest={{ id: 9, targetKey: 'ZZ999' }} onKeyboardFocusRequestConsumed={consumed}
          navigationHighlightCellKey="ZZ999" scrollContainerRef={scrollContainerRef} sheet={sheet} />
      </div>,
    );

    await act(async () => {});
    expect(consumed).not.toHaveBeenCalled();
    expect(screen.getByTestId('sheet-grid')).toHaveAttribute('tabindex', '0');
  });

  it('preserves a cell drag extent after the browser click following pointer release', () => {
    const sheet = tabularProjection(sheetDocument({ id: 'sheet-drag', name: 'Drag' }));
    const axisProjection = projectGridAxes(sheet, { columns: [], rows: [] });
    const scrollContainerRef = createRef<HTMLDivElement>();
    const cellInteraction = {
      clear: vi.fn(), extend: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn(),
    };

    render(
      <div ref={scrollContainerRef} style={{ overflow: 'auto' }}>
        <SheetGrid
          activeCellKey={null}
          axisProjection={axisProjection}
          cellInteraction={cellInteraction}
          editingCell={null}
          editorInteraction={{ cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() }}
          formulaResults={{}}
          keyboardFocusRequest={null}
          onKeyboardFocusRequestConsumed={vi.fn()}
          navigationHighlightCellKey={null}
          scrollContainerRef={scrollContainerRef}
          sheet={sheet}
        />
      </div>,
    );

    const scrollContainer = scrollContainerRef.current!;
    virtualGridGeometry(scrollContainer);
    const grid = screen.getByTestId('sheet-grid');
    const a1 = screen.getByRole('cell', { name: 'Drag A1 empty cell' });
    firePointer(a1, 'pointerdown', { button: 0, clientX: 50, clientY: 40, pointerId: 7 });
    firePointer(grid, 'pointermove', { clientX: 130, clientY: 40, pointerId: 7 });
    firePointer(grid, 'pointerup', { clientX: 130, clientY: 40, pointerId: 7 });
    fireEvent.click(a1, { detail: 1 });

    expect(cellInteraction.select).toHaveBeenCalledTimes(1);
    expect(cellInteraction.extend).toHaveBeenCalledWith(expect.objectContaining({
      sheetId: sheet.id,
      cell: cellIdentityAt(sheet, 'B1'),
    }), expect.objectContaining({ owner: expect.any(Symbol) }));
  });

  it('reports a live selection drag so its frame can retain the detailed grid', () => {
    const sheet = tabularProjection(sheetDocument({ id: 'sheet-pinned-drag', name: 'Pinned drag' }));
    const axisProjection = projectGridAxes(sheet, { columns: [], rows: [] });
    const scrollContainerRef = createRef<HTMLDivElement>();
    const onPointerInteractionChange = vi.fn();

    render(
      <div ref={scrollContainerRef} style={{ overflow: 'auto' }}>
        <SheetGrid
          activeCellKey={null}
          axisProjection={axisProjection}
          cellInteraction={{ clear: vi.fn(), extend: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn() }}
          editingCell={null}
          editorInteraction={{ cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() }}
          formulaResults={{}}
          keyboardFocusRequest={null}
          onKeyboardFocusRequestConsumed={vi.fn()}
          onPointerInteractionChange={onPointerInteractionChange}
          navigationHighlightCellKey={null}
          scrollContainerRef={scrollContainerRef}
          sheet={sheet}
        />
      </div>,
    );

    const grid = screen.getByTestId('sheet-grid');
    firePointer(screen.getByRole('cell', { name: 'Pinned drag A1 empty cell' }), 'pointerdown', {
      button: 0, clientX: 50, clientY: 40, pointerId: 31,
    });
    expect(onPointerInteractionChange).toHaveBeenLastCalledWith(sheet.id, true);

    firePointer(grid, 'pointerup', { clientX: 50, clientY: 40, pointerId: 31 });
    expect(onPointerInteractionChange).toHaveBeenLastCalledWith(sheet.id, false);
  });

  it('extends row and column header drags in their whole-axis modes', () => {
    const sheet = tabularProjection(sheetDocument({ id: 'sheet-axis-drag', name: 'Axis drag' }));
    const axisProjection = projectGridAxes(sheet, { columns: [], rows: [] });
    const scrollContainerRef = createRef<HTMLDivElement>();
    const onSelectAxis = vi.fn();

    render(
      <div ref={scrollContainerRef} style={{ overflow: 'auto' }}>
        <SheetGrid
          activeCellKey={null}
          axisProjection={axisProjection}
          cellInteraction={{ clear: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn() }}
          editingCell={null}
          editorInteraction={{ cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() }}
          formulaResults={{}}
          keyboardFocusRequest={null}
          onKeyboardFocusRequestConsumed={vi.fn()}
          navigationHighlightCellKey={null}
          onSelectAxis={onSelectAxis}
          scrollContainerRef={scrollContainerRef}
          sheet={sheet}
        />
      </div>,
    );

    const scrollContainer = scrollContainerRef.current!;
    virtualGridGeometry(scrollContainer);
    const grid = screen.getByTestId('sheet-grid');
    firePointer(screen.getByRole('columnheader', { name: 'A' }), 'pointerdown', {
      button: 0, clientX: 50, clientY: 10, pointerId: 8,
    });
    firePointer(grid, 'pointermove', { clientX: 210, clientY: 10, pointerId: 8 });
    firePointer(grid, 'pointerup', { pointerId: 8 });
    firePointer(screen.getByRole('rowheader', { name: '1' }), 'pointerdown', {
      button: 0, clientX: 10, clientY: 40, pointerId: 9,
    });
    firePointer(grid, 'pointermove', { clientX: 10, clientY: 110, pointerId: 9 });

    expect(onSelectAxis).toHaveBeenCalledWith('columns', expect.objectContaining({
      cell: cellIdentityAt(sheet, 'C1'), sheetId: sheet.id,
    }), true, expect.objectContaining({ owner: expect.any(Symbol) }));
    expect(onSelectAxis).toHaveBeenCalledWith('rows', expect.objectContaining({
      cell: cellIdentityAt(sheet, 'A1'), sheetId: sheet.id,
    }), false, expect.objectContaining({ owner: expect.any(Symbol) }));
    expect(onSelectAxis).toHaveBeenCalledWith('rows', expect.objectContaining({
      cell: cellIdentityAt(sheet, 'A4'), sheetId: sheet.id,
    }), true, expect.objectContaining({ owner: expect.any(Symbol) }));
  });

  it('rejects a competing pointer before it can replace the active drag selection', () => {
    const sheet = tabularProjection(sheetDocument({ id: 'sheet-competing-pointer', name: 'Competing pointer' }));
    const axisProjection = projectGridAxes(sheet, { columns: [], rows: [] });
    const scrollContainerRef = createRef<HTMLDivElement>();
    const cellInteraction = {
      clear: vi.fn(), extend: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn(),
    };

    render(
      <div ref={scrollContainerRef} style={{ overflow: 'auto' }}>
        <SheetGrid activeCellKey={null} axisProjection={axisProjection} cellInteraction={cellInteraction}
          editingCell={null} editorInteraction={{ cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() }}
          formulaResults={{}} keyboardFocusRequest={null} onKeyboardFocusRequestConsumed={vi.fn()}
          navigationHighlightCellKey={null} scrollContainerRef={scrollContainerRef} sheet={sheet} />
      </div>,
    );

    const grid = screen.getByTestId('sheet-grid');
    const a1 = screen.getByRole('cell', { name: 'Competing pointer A1 empty cell' });
    const b1 = screen.getByRole('cell', { name: 'Competing pointer B1 empty cell' });
    firePointer(a1, 'pointerdown', { button: 0, clientX: 50, clientY: 40, pointerId: 1 });
    firePointer(b1, 'pointerdown', { button: 0, clientX: 130, clientY: 40, pointerId: 2 });
    firePointer(grid, 'pointermove', { clientX: 210, clientY: 40, pointerId: 1 });

    expect(cellInteraction.select).toHaveBeenCalledTimes(1);
    expect(cellInteraction.select).toHaveBeenLastCalledWith(expect.objectContaining({ cell: cellIdentityAt(sheet, 'A1') }), expect.objectContaining({ owner: expect.any(Symbol) }));
    expect(cellInteraction.extend).toHaveBeenCalledWith(expect.objectContaining({ cell: cellIdentityAt(sheet, 'C1') }), expect.objectContaining({ owner: expect.any(Symbol) }));
  });

  it('cancels a mounted grid drag when selection ownership moves to another sheet', () => {
    const sheet = tabularProjection(sheetDocument({ id: 'sheet-stale-drag', name: 'Stale drag' }));
    const axisProjection = projectGridAxes(sheet, { columns: [], rows: [] });
    const scrollContainerRef = createRef<HTMLDivElement>();
    const cellInteraction = {
      clear: vi.fn(), extend: vi.fn(), focusSelection: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn(),
    };

    const view = render(
      <div ref={scrollContainerRef} style={{ overflow: 'auto' }}>
        <SheetGrid activeCellKey={null} activeSheetId={sheet.id} axisProjection={axisProjection} cellInteraction={cellInteraction}
          editingCell={null} editorInteraction={{ cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() }}
          formulaResults={{}} keyboardFocusRequest={null} onKeyboardFocusRequestConsumed={vi.fn()}
          navigationHighlightCellKey={null} scrollContainerRef={scrollContainerRef} sheet={sheet} />
      </div>,
    );
    const grid = screen.getByTestId('sheet-grid');
    const a1 = screen.getByRole('cell', { name: 'Stale drag A1 empty cell' });
    firePointer(a1, 'pointerdown', { button: 0, clientX: 50, clientY: 40, pointerId: 22 });

    view.rerender(
      <div ref={scrollContainerRef} style={{ overflow: 'auto' }}>
        <SheetGrid activeCellKey={null} activeSheetId="other-sheet" axisProjection={axisProjection} cellInteraction={cellInteraction}
          editingCell={null} editorInteraction={{ cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() }}
          formulaResults={{}} keyboardFocusRequest={null} onKeyboardFocusRequestConsumed={vi.fn()}
          navigationHighlightCellKey={null} scrollContainerRef={scrollContainerRef} sheet={sheet} />
      </div>,
    );
    firePointer(grid, 'pointermove', { clientX: 130, clientY: 40, pointerId: 22 });
    firePointer(grid, 'pointerup', { clientX: 130, clientY: 40, pointerId: 22 });

    expect(cellInteraction.select).toHaveBeenCalledTimes(1);
    expect(cellInteraction.extend).not.toHaveBeenCalled();
    expect(cellInteraction.focusSelection).not.toHaveBeenCalled();
  });

  it.each([
    ['Escape', (grid: HTMLElement) => fireEvent.keyDown(grid, { key: 'Escape' })],
    ['window focus loss', () => fireEvent(window, new Event('blur'))],
  ])('cancels a cell drag on %s and ignores its later movement', (_name, cancel) => {
    const sheet = tabularProjection(sheetDocument({ id: 'sheet-cancel-drag', name: 'Cancel drag' }));
    const axisProjection = projectGridAxes(sheet, { columns: [], rows: [] });
    const scrollContainerRef = createRef<HTMLDivElement>();
    const cellInteraction = {
      clear: vi.fn(), extend: vi.fn(), focusSelection: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn(),
    };

    render(
      <div ref={scrollContainerRef} style={{ overflow: 'auto' }}>
        <SheetGrid
          activeCellKey={null}
          axisProjection={axisProjection}
          cellInteraction={cellInteraction}
          editingCell={null}
          editorInteraction={{ cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() }}
          formulaResults={{}}
          keyboardFocusRequest={null}
          onKeyboardFocusRequestConsumed={vi.fn()}
          navigationHighlightCellKey={null}
          scrollContainerRef={scrollContainerRef}
          sheet={sheet}
        />
      </div>,
    );

    const scrollContainer = scrollContainerRef.current!;
    virtualGridGeometry(scrollContainer);
    const grid = screen.getByTestId('sheet-grid');
    const a1 = screen.getByRole('cell', { name: 'Cancel drag A1 empty cell' });
    firePointer(a1, 'pointerdown', { button: 0, clientX: 50, clientY: 40, pointerId: 12 });
    cancel(grid);
    firePointer(grid, 'pointermove', { clientX: 130, clientY: 40, pointerId: 12 });
    firePointer(grid, 'pointerup', { clientX: 130, clientY: 40, pointerId: 12 });

    expect(cellInteraction.extend).not.toHaveBeenCalled();
    expect(cellInteraction.focusSelection).not.toHaveBeenCalled();
  });

  it('cancels a cell drag on pointer cancellation without requesting final focus', () => {
    const sheet = tabularProjection(sheetDocument({ id: 'sheet-pointer-cancel', name: 'Pointer cancel' }));
    const axisProjection = projectGridAxes(sheet, { columns: [], rows: [] });
    const scrollContainerRef = createRef<HTMLDivElement>();
    const cellInteraction = {
      clear: vi.fn(), extend: vi.fn(), focusSelection: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn(),
    };

    render(
      <div ref={scrollContainerRef} style={{ overflow: 'auto' }}>
        <SheetGrid
          activeCellKey={null}
          axisProjection={axisProjection}
          cellInteraction={cellInteraction}
          editingCell={null}
          editorInteraction={{ cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() }}
          formulaResults={{}}
          keyboardFocusRequest={null}
          onKeyboardFocusRequestConsumed={vi.fn()}
          navigationHighlightCellKey={null}
          scrollContainerRef={scrollContainerRef}
          sheet={sheet}
        />
      </div>,
    );

    const scrollContainer = scrollContainerRef.current!;
    virtualGridGeometry(scrollContainer);
    const grid = screen.getByTestId('sheet-grid');
    const a1 = screen.getByRole('cell', { name: 'Pointer cancel A1 empty cell' });
    firePointer(a1, 'pointerdown', { button: 0, clientX: 50, clientY: 40, pointerId: 15 });
    firePointer(grid, 'pointermove', { clientX: 130, clientY: 40, pointerId: 15 });
    firePointer(grid, 'pointercancel', { clientX: 130, clientY: 40, pointerId: 15 });
    firePointer(grid, 'pointermove', { clientX: 210, clientY: 40, pointerId: 15 });

    expect(cellInteraction.extend).toHaveBeenCalledWith(expect.objectContaining({
      cell: cellIdentityAt(sheet, 'B1'), sheetId: sheet.id,
    }), expect.objectContaining({ owner: expect.any(Symbol) }));
    expect(cellInteraction.focusSelection).not.toHaveBeenCalled();
    expect(cellInteraction.extend).toHaveBeenCalledTimes(1);
  });

});
