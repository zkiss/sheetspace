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

describe('savedAxisIndexAtOffset', () => {
  it('clamps to saved endpoints and skips projected creation slots', () => {
    const entries = projectGridAxes(
      tabularProjection(sheetDocument({ id: 'axis-targeting', name: 'Axis targeting' })),
      {
        rows: [
          { kind: 'creating', operationId: 'before', boundary: 0 },
          { kind: 'creating', operationId: 'between', boundary: 2 },
          { kind: 'creating', operationId: 'after', boundary: 4 },
        ],
        columns: [],
      },
    ).rows;
    const metrics = createGridAxisMetrics(entries, 20);

    expect(savedAxisIndexAtOffset(entries, metrics, -1)).toBe(1);
    expect(savedAxisIndexAtOffset(entries, metrics, metrics.totalSize)).toBe(
      entries.reduce((lastSaved, entry, index) => entry.kind === 'saved' ? index : lastSaved, -1),
    );
    expect(savedAxisIndexAtOffset(entries, metrics, 0)).toBe(1);
    expect(savedAxisIndexAtOffset(entries, metrics, 65)).toBe(2);
  });

  it('rejects invalid offsets and chooses a deterministic saved neighbour for sparse metrics', () => {
    const projection = tabularProjection(sheetDocument({ id: 'sparse-axis-targeting', name: 'Sparse axis targeting' }));
    const entries = projectGridAxes(projection, {
      rows: [
        { kind: 'creating', operationId: 'before', boundary: 0 },
        { kind: 'creating', operationId: 'middle', boundary: 1 },
      ],
      columns: [],
    }).rows;
    const metrics = createGridAxisMetrics(entries, 20);

    expect(savedAxisIndexAtOffset(entries, metrics, Number.NaN)).toBeUndefined();
    expect(savedAxisIndexAtOffset([], createGridAxisMetrics([], 20), 0)).toBeUndefined();
    // The pending slot between A and B has no durable address. At its midpoint,
    // preserve the earlier saved axis rather than inventing a temporary target.
    expect(savedAxisIndexAtOffset(entries, metrics, 25)).toBe(1);
    expect(savedAxisIndexAtOffset(entries, metrics, 45)).toBe(1);
  });
});

describe('SheetGrid appearance rendering', () => {
  it('composes row, column, and cell appearance overrides without obscuring selection feedback after remount', () => {
    const document = sheetDocument({ id: 'appearance-grid', name: 'Appearance grid', rowCount: 2, columnCount: 2 });
    const [firstRow] = document.content.rows;
    const [firstColumn] = document.content.columns;
    const firstCell = cellIdentityAt(tabularProjection(document), 'A1')!;
    const styledDocument: typeof document = {
      ...document,
      presentation: {
        ...document.presentation,
        formatOverrides: {
          rows: { [firstRow!]: { fontWeight: 'bold', horizontalAlignment: 'left', textColor: '#112233' } },
          columns: { [firstColumn!]: { fillColor: '#445566' } },
          cells: { [cellIdentityKey(firstCell)]: { fontWeight: 'normal', horizontalAlignment: 'right', fillColor: 'none' } },
        },
      },
    };
    const styled = tabularProjection(styledDocument);
    const axisProjection = projectGridAxes(styled, { columns: [], rows: [] });
    const scrollContainerRef = createRef<HTMLDivElement>();
    const renderGrid = () => render(
      <div ref={scrollContainerRef} style={{ overflow: 'auto' }}>
        <SheetGrid activeCellKey="A1" axisProjection={axisProjection}
          cellInteraction={{ clear: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn() }}
          editingCell={null} editorInteraction={{ cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() }}
          formulaResults={{}} keyboardFocusRequest={null} onKeyboardFocusRequestConsumed={vi.fn()}
          navigationHighlightCellKey={null} presentation={styledDocument.presentation} scrollContainerRef={scrollContainerRef} sheet={styled} />
      </div>,
    );

    const view = renderGrid();
    const a1 = screen.getByRole('cell', { name: 'Appearance grid A1 empty cell' });
    const b1 = screen.getByRole('cell', { name: 'Appearance grid B1 empty cell' });
    const a2 = screen.getByRole('cell', { name: 'Appearance grid A2 empty cell' });
    expect(a1).toHaveAttribute('aria-selected', 'true');
    expect(a1).toHaveStyle({ backgroundColor: '#ffffff', color: '#112233', fontWeight: 'normal', textAlign: 'right' });
    expect(b1).toHaveStyle({ color: '#112233', fontWeight: 'bold', textAlign: 'left' });
    expect(a2).toHaveStyle({ backgroundColor: '#445566' });

    view.unmount();
    renderGrid();
    expect(screen.getByRole('cell', { name: 'Appearance grid A1 empty cell' }))
      .toHaveStyle({ backgroundColor: '#ffffff', color: '#112233', fontWeight: 'normal', textAlign: 'right' });
  });
});

describe('SheetGrid clipboard routing', () => {
  function renderClipboardGrid(clipboardInteraction?: ComponentProps<typeof SheetGrid>['clipboardInteraction']) {
    const sheet = tabularProjection(sheetDocument({ id: 'clipboard-routing', name: 'Clipboard routing' }));
    const axisProjection = projectGridAxes(sheet, { columns: [], rows: [] });
    const scrollContainerRef = createRef<HTMLDivElement>();
    render(
      <div ref={scrollContainerRef} style={{ overflow: 'auto' }}>
        <SheetGrid activeCellKey="A1" axisProjection={axisProjection}
          cellInteraction={{ clear: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn() }}
          clipboardInteraction={clipboardInteraction}
          editingCell={null} editorInteraction={{ cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() }}
          formulaResults={{}} keyboardFocusRequest={null} onKeyboardFocusRequestConsumed={vi.fn()}
          navigationHighlightCellKey={null} scrollContainerRef={scrollContainerRef} sheet={sheet} />
      </div>,
    );
    return screen.getByTestId('sheet-grid');
  }

  function clipboardData(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial));
    return {
      getData: (type: string) => values.get(type) ?? '',
      setData: (type: string, value: string) => { values.set(type, value); },
      get types() { return [...values.keys()]; },
    };
  }

  it('writes both clipboard representations and routes an empty plain-text payload', () => {
    const copy = vi.fn(() => ({ text: 'A\tB', marker: 'sheetspace:marker' }));
    const paste = vi.fn();
    const grid = renderClipboardGrid({ copy, paste });
    const copied = clipboardData();

    expect(fireEvent.copy(grid, { clipboardData: copied })).toBe(false);
    expect(copied.getData('text/plain')).toBe('A\tB');
    expect(copied.getData('application/x-sheetspace-clipboard')).toBe('sheetspace:marker');

    expect(fireEvent.paste(grid, { clipboardData: clipboardData({ 'text/plain': '' }) })).toBe(false);
    expect(paste).toHaveBeenCalledWith({ text: '', marker: undefined });
  });

  it('leaves unsupported clipboard data and unavailable copy operations browser-native', () => {
    const paste = vi.fn();
    const grid = renderClipboardGrid({ copy: () => undefined, paste });

    expect(fireEvent.copy(grid, { clipboardData: clipboardData() })).toBe(true);
    expect(fireEvent.paste(grid, { clipboardData: clipboardData() })).toBe(true);
    expect(paste).not.toHaveBeenCalled();
  });

  it('routes cuts and cancels a pending cut with Escape outside an editor', () => {
    const cut = vi.fn(() => ({ text: 'A', marker: 'sheetspace:cut' }));
    const cancelCut = vi.fn();
    const grid = renderClipboardGrid({ cut, copy: vi.fn(), paste: vi.fn(), cancelCut });
    const copied = clipboardData();

    expect(fireEvent.cut(grid, { clipboardData: copied })).toBe(false);
    expect(copied.getData('text/plain')).toBe('A');
    expect(copied.getData('application/x-sheetspace-clipboard')).toBe('sheetspace:cut');
    fireEvent.keyDown(grid, { key: 'Escape' });
    expect(cancelCut).toHaveBeenCalledOnce();
  });

  it('leaves cut and Escape in a live editor browser-native', () => {
    const cut = vi.fn(() => ({ text: 'A', marker: 'sheetspace:cut' }));
    const cancelCut = vi.fn();
    const grid = renderClipboardGrid({ cut, copy: vi.fn(), paste: vi.fn(), cancelCut });
    const editor = document.createElement('textarea');
    grid.append(editor);

    expect(fireEvent.cut(editor, { clipboardData: clipboardData() })).toBe(true);
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(cut).not.toHaveBeenCalled();
    expect(cancelCut).not.toHaveBeenCalled();
  });

  it('keeps input and every editable contenteditable form browser-native', () => {
    const cut = vi.fn(() => ({ text: 'A', marker: 'sheetspace:cut' }));
    const paste = vi.fn();
    const cancelCut = vi.fn();
    const grid = renderClipboardGrid({ cut, copy: vi.fn(), paste, cancelCut });
    const input = document.createElement('input');
    const bareEditable = document.createElement('div');
    bareEditable.setAttribute('contenteditable', '');
    const plaintextEditable = document.createElement('div');
    plaintextEditable.setAttribute('contenteditable', 'plaintext-only');
    grid.append(input, bareEditable, plaintextEditable);

    expect(fireEvent.cut(input, { clipboardData: clipboardData() })).toBe(true);
    expect(fireEvent.copy(bareEditable, { clipboardData: clipboardData() })).toBe(true);
    expect(fireEvent.paste(plaintextEditable, { clipboardData: clipboardData({ 'text/plain': 'native' }) })).toBe(true);
    fireEvent.keyDown(plaintextEditable, { key: 'Escape' });
    expect(cut).not.toHaveBeenCalled();
    expect(paste).not.toHaveBeenCalled();
    expect(cancelCut).not.toHaveBeenCalled();
  });

  it('leaves an unavailable cut operation browser-native', () => {
    const grid = renderClipboardGrid({ copy: vi.fn(), paste: vi.fn() });
    expect(fireEvent.cut(grid, { clipboardData: clipboardData() })).toBe(true);
  });
});

function firePointer(
  element: Element,
  type: string,
  { pointerId = 1, ...init }: MouseEventInit & { pointerId?: number } = {},
) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  fireEvent(element, event);
}

