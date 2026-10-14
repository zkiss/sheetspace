// @ts-nocheck
import { createRef, useState, type ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectGridAxes } from '@grid/gridAxisProjection';
import { createGridAxisMetrics } from './gridAxisMetrics';
import { savedAxisIndexAtOffset, SheetGrid } from '@grid/SheetGrid';
import { sheetDocument, sparseLargeSheetDocument } from '@test-support/workbookFactories';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import { tabularProjection } from '@workbook/read/queries';
import { testRect, virtualGridGeometry } from '@test-support/domGeometry';

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


describe('SheetGrid creating axis slots', () => {
  it('focuses the final drag extent without collapsing its selection', () => {
    const sheet = tabularProjection(sheetDocument({ id: 'sheet-focus-drag', name: 'Focus drag' }));
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
    const a1 = screen.getByRole('cell', { name: 'Focus drag A1 empty cell' });
    firePointer(a1, 'pointerdown', { button: 0, clientX: 50, clientY: 40, pointerId: 13 });
    firePointer(grid, 'pointermove', { clientX: 130, clientY: 40, pointerId: 13 });
    firePointer(grid, 'pointerup', { clientX: 130, clientY: 40, pointerId: 13 });

    expect(cellInteraction.focusSelection).toHaveBeenCalledWith(expect.objectContaining({
      cell: cellIdentityAt(sheet, 'B1'), sheetId: sheet.id,
    }));
    expect(cellInteraction.select).toHaveBeenCalledTimes(1);
  });

  it('ends a mounted grid drag when logical selection moves to another sheet', () => {
    const sheet = tabularProjection(sheetDocument({ id: 'sheet-a', name: 'Sheet A' }));
    const axisProjection = projectGridAxes(sheet, { columns: [], rows: [] });
    const scrollContainerRef = createRef<HTMLDivElement>();
    const cellInteraction = {
      clear: vi.fn(), extend: vi.fn(), focusSelection: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn(),
    };
    const grid = (activeSheetId: string) => (
      <div ref={scrollContainerRef} style={{ overflow: 'auto' }}>
        <SheetGrid
          activeCellKey={activeSheetId === sheet.id ? 'A1' : null}
          activeSheetId={activeSheetId}
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
      </div>
    );

    const view = render(grid(sheet.id));
    const scrollContainer = scrollContainerRef.current!;
    virtualGridGeometry(scrollContainer);
    const sheetGrid = screen.getByTestId('sheet-grid');
    const a1 = screen.getByRole('cell', { name: 'Sheet A A1 empty cell' });
    firePointer(a1, 'pointerdown', { button: 0, clientX: 50, clientY: 40, pointerId: 14 });

    // Sheet A stays mounted, as it does in the workspace, but Sheet B now owns
    // the shared selection. Neither pointer nor release callbacks may reclaim it.
    view.rerender(grid('sheet-b'));
    firePointer(sheetGrid, 'pointermove', { clientX: 130, clientY: 40, pointerId: 14 });
    firePointer(sheetGrid, 'pointerup', { clientX: 130, clientY: 40, pointerId: 14 });

    expect(cellInteraction.extend).not.toHaveBeenCalled();
    expect(cellInteraction.focusSelection).not.toHaveBeenCalled();
  });

  it('uses loading-only, non-addressable row and column placeholders', () => {
    const sheet = tabularProjection(sheetDocument({ id: 'sheet-inputs', name: 'Inputs' }));
    const axisProjection = projectGridAxes(sheet, {
      rows: [{ kind: 'creating', operationId: 'row-request', boundary: 1 }],
      columns: [{ kind: 'creating', operationId: 'column-request', boundary: 1 }],
    });

    render(
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
        scrollContainerRef={createRef<HTMLElement>()}
        sheet={sheet}
      />,
    );

    const creatingColumn = document.querySelector('.sheet-grid-column-header.sheet-grid-axis-creating');
    const creatingRow = document.querySelector('.sheet-grid-row:has(.sheet-grid-row-header.sheet-grid-axis-creating)');
    const creatingCells = [...document.querySelectorAll<HTMLElement>('.sheet-grid-cell-creating')];
    expect(creatingColumn).toHaveTextContent('Creating…');
    expect(creatingColumn).toHaveAttribute('aria-hidden', 'true');
    expect(creatingRow).toHaveAttribute('aria-hidden', 'true');
    expect(creatingCells).not.toHaveLength(0);
    expect(creatingCells.every((cell) => cell.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(screen.queryByRole('columnheader', { name: 'Creating column' })).not.toBeInTheDocument();
    expect(screen.queryByRole('rowheader', { name: 'Creating row' })).not.toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: 'Creating cell' })).not.toBeInTheDocument();
    expect(document.querySelector('[aria-label="Creating cell"][data-cell-key]')).toBeNull();
  });

  it('keeps ARIA column positions logical around projected creating columns', () => {
    const sheet = tabularProjection(sheetDocument({
      id: 'sheet-inputs',
      name: 'Inputs',
      cells: { A1: 'First', B1: 'Second' },
    }));
    const axisProjection = projectGridAxes(sheet, {
      rows: [],
      columns: [
        { kind: 'creating', operationId: 'before-a', boundary: 0 },
        { kind: 'creating', operationId: 'between-a-b', boundary: 1 },
      ],
    });

    render(
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
        scrollContainerRef={createRef<HTMLElement>()}
        sheet={sheet}
      />,
    );

    expect(screen.getByTestId('sheet-grid')).toHaveAttribute('aria-colcount', '11');
    expect(screen.getByRole('columnheader', { name: 'Grid corner' })).toHaveAttribute('aria-colindex', '1');
    expect(screen.getByRole('columnheader', { name: 'A' })).toHaveAttribute('aria-colindex', '2');
    expect(screen.getByRole('columnheader', { name: 'B' })).toHaveAttribute('aria-colindex', '3');
    expect(screen.getByRole('cell', { name: 'Inputs A1 cell' })).toHaveAttribute('aria-colindex', '2');
    expect(screen.getByRole('cell', { name: 'Inputs B1 cell' })).toHaveAttribute('aria-colindex', '3');
    const placeholders = document.querySelectorAll('.sheet-grid-column-header.sheet-grid-axis-creating');
    expect(placeholders).toHaveLength(2);
    for (const placeholder of placeholders) expect(placeholder).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps ARIA row positions logical around projected creating rows', () => {
    const sheet = tabularProjection(sheetDocument({
      id: 'sheet-inputs',
      name: 'Inputs',
      cells: { A1: 'First', A2: 'Second' },
    }));
    const axisProjection = projectGridAxes(sheet, {
      rows: [
        { kind: 'creating', operationId: 'before-row-one', boundary: 0 },
        { kind: 'creating', operationId: 'between-row-one-two', boundary: 1 },
      ],
      columns: [],
    });

    render(
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
        scrollContainerRef={createRef<HTMLElement>()}
        sheet={sheet}
      />,
    );

    expect(screen.getByTestId('sheet-grid')).toHaveAttribute('aria-rowcount', '21');
    const rowsByHeader = Object.fromEntries(
      screen.getAllByRole('rowheader').map((header) => [header.textContent, header.closest('[role="row"]')]),
    );
    expect(rowsByHeader['1']).toHaveAttribute('aria-rowindex', '2');
    expect(rowsByHeader['2']).toHaveAttribute('aria-rowindex', '3');
    const placeholders = document.querySelectorAll('.sheet-grid-row[aria-hidden="true"]');
    expect(placeholders).toHaveLength(2);
    for (const placeholder of placeholders) expect(placeholder).not.toHaveAttribute('aria-rowindex');
  });

  it('keeps editing, formulas, selection, and navigation on durable cells only', () => {
    const sheet = tabularProjection(sheetDocument({
      id: 'sheet-inputs',
      name: 'Inputs',
      cells: { A1: '=1+1', B1: 'Original' },
    }));
    const axisProjection = projectGridAxes(sheet, {
      rows: [{ kind: 'creating', operationId: 'row-request', boundary: Number.MAX_SAFE_INTEGER }],
      columns: [{ kind: 'creating', operationId: 'column-request', boundary: Number.MAX_SAFE_INTEGER }],
    });
    const cellInteraction = {
      clear: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn(),
    };
    const editorInteraction = {
      cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn(),
    };

    render(
      <SheetGrid
        activeCellKey="B1"
        axisProjection={axisProjection}
        cellInteraction={cellInteraction}
        editingCell={{
          target: { sheetId: sheet.id, cell: cellIdentityAt(sheet, 'B1')! },
          draft: 'Edited while appending',
        }}
        editorInteraction={editorInteraction}
        formulaResults={{
          [sheet.id]: { A1: { kind: 'number', value: 2, display: '2' } },
        }}
        keyboardFocusRequest={{ id: 1, targetKey: 'B1' }}
        onKeyboardFocusRequestConsumed={vi.fn()}
        navigationHighlightCellKey="A1"
        navigationHighlightRange={undefined}
        scrollContainerRef={createRef<HTMLElement>()}
        selectedRange={{
          start: { rowIndex: 0, columnIndex: 0 },
          end: { rowIndex: 0, columnIndex: 1 },
        }}
        sheet={sheet}
      />,
    );

    const formulaCell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    expect(formulaCell).toHaveTextContent('2');
    expect(formulaCell).toHaveAttribute('data-navigation-highlight', 'true');
    expect(formulaCell).toHaveAttribute('data-reference-selected', 'true');
    formulaCell.focus();
    expect(formulaCell).toHaveFocus();
    expect(getComputedStyle(formulaCell).position).toBe('absolute');
    cellInteraction.select.mockClear();

    const editedCell = screen.getByRole('cell', { name: 'Inputs B1 cell' });
    expect(editedCell).toHaveAttribute('data-cell-key', 'B1');
    expect(editedCell).toHaveAttribute('data-editing-cell', 'true');
    expect(editedCell).toHaveAttribute('data-reference-selected', 'true');
    expect(getComputedStyle(editedCell).position).toBe('absolute');
    const editor = screen.getByRole('textbox', { name: 'Inputs B1 editor' });
    expect(editor).toHaveValue('Edited while appending');
    fireEvent.change(editor, { target: { value: 'Committed independently' } });
    expect(editorInteraction.updateValue).toHaveBeenCalledWith('Committed independently');

    const creatingCells = [...document.querySelectorAll<HTMLElement>('.sheet-grid-cell-creating')];
    expect(creatingCells).not.toHaveLength(0);
    for (const creatingCell of creatingCells) {
      expect(creatingCell).toHaveAttribute('aria-hidden', 'true');
      expect(creatingCell).not.toHaveAttribute('data-cell-key');
      expect(creatingCell).not.toHaveAttribute('data-active-cell');
      expect(creatingCell).not.toHaveAttribute('data-editing-cell');
      expect(creatingCell).not.toHaveAttribute('data-navigation-highlight');
      expect(creatingCell).not.toHaveAttribute('data-reference-selected');
      fireEvent.click(creatingCell);
      fireEvent.doubleClick(creatingCell);
      fireEvent.keyDown(creatingCell, { key: 'ArrowRight' });
    }
    expect(cellInteraction.select).not.toHaveBeenCalled();
    expect(cellInteraction.startEditing).not.toHaveBeenCalled();
    expect(cellInteraction.navigate).not.toHaveBeenCalled();
  });
});
