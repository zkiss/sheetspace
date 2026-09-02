import { createRef, useState, type ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectGridAxes } from './gridAxisProjection';
import { createGridAxisMetrics } from './gridAxisMetrics';
import { SheetGrid } from './SheetGrid';
import { sheetDocument, sparseLargeSheetDocument } from './test/workbookFactories';
import { cellIdentityAt } from './workbook/core/cellIdentity';
import { tabularProjection } from './workbook/read/queries';
import { virtualGridGeometry } from './test/domGeometry';

afterEach(cleanup);

describe('SheetGrid creating axis slots', () => {
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

describe('SheetGrid virtualization', () => {
  function renderMeasuredSparseGrid(options: { activeCellKey?: string | null; editingCell?: ComponentProps<typeof SheetGrid>['editingCell']; keyboardFocusRequest?: { id: number; targetKey: string | null } | null } = {}) {
    const sheet = tabularProjection(sparseLargeSheetDocument());
    const scrollContainerRef = createRef<HTMLDivElement>();
    const cellInteraction = { clear: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn() };
    const editorInteraction = { cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() };
    const view = render(
      <div ref={scrollContainerRef} style={{ overflow: 'auto' }}>
        <SheetGrid
          activeCellKey={options.activeCellKey ?? null}
          axisProjection={projectGridAxes(sheet, { columns: [], rows: [] })}
          cellInteraction={cellInteraction}
          editingCell={options.editingCell ?? null}
          editorInteraction={editorInteraction}
          formulaResults={{}}
          keyboardFocusRequest={options.keyboardFocusRequest ?? null}
          onKeyboardFocusRequestConsumed={vi.fn()}
          navigationHighlightCellKey={null}
          scrollContainerRef={scrollContainerRef}
          sheet={sheet}
        />
      </div>,
    );
    const body = scrollContainerRef.current!;
    return { ...view, body, cellInteraction, editorInteraction, geometry: virtualGridGeometry(body), sheet };
  }

  function mountedCellKeys() {
    return screen.getAllByTestId('sheet-grid-cell').map((cell) => cell.dataset.cellKey!);
  }

  it('measures two-axis windows at edges, retains overlapping identities, and reacts to resize', async () => {
    const { body, geometry } = renderMeasuredSparseGrid();
    await waitFor(() => expect(mountedCellKeys()).toContain('A1'));
    const initial = mountedCellKeys();
    const grid = screen.getByTestId('sheet-grid');

    act(() => geometry.resize({ height: 320, width: 480 }));
    await waitFor(() => expect(mountedCellKeys().length).toBeGreaterThan(initial.length));
    expect(Number.parseFloat(grid.style.height)).toBeCloseTo(264026.4, 3);
    expect(grid).toHaveStyle({ width: '7640px' });

    body.scrollTop = 264_000;
    body.scrollLeft = 7_300;
    fireEvent.scroll(body);
    await waitFor(() => expect(mountedCellKeys()).toContain('CV10000'));
    const edge = mountedCellKeys();
    expect(edge.length).toBeLessThan(1_000);
    expect(screen.getByRole('rowheader', { name: '10000' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'CV' })).toHaveAttribute('aria-colindex', '101');
    expect(screen.getAllByRole('rowheader').map((header) => header.textContent)).not.toContain('1');

    body.scrollTop = 0;
    body.scrollLeft = 0;
    fireEvent.scroll(body);
    await waitFor(() => expect(mountedCellKeys()).toContain('A1'));
    expect(mountedCellKeys().filter((key) => initial.includes(key))).not.toHaveLength(0);
  });

  it('recomputes rendered windows and geometry from non-uniform axis metrics', async () => {
    const sheet = tabularProjection(sheetDocument({
      id: 'sheet-variable-metrics',
      name: 'Variable metrics',
      columnCount: 10,
      rowCount: 20,
    }));
    const axisProjection = projectGridAxes(sheet, { columns: [], rows: [] });
    const scrollContainerRef = createRef<HTMLDivElement>();
    const fixedMetrics = {
      columns: createGridAxisMetrics(axisProjection.columns, 40),
      rows: createGridAxisMetrics(axisProjection.rows, 20),
    };
    const variableMetrics = {
      columns: createGridAxisMetrics(axisProjection.columns, [250, ...Array(9).fill(40)]),
      rows: createGridAxisMetrics(axisProjection.rows, [300, ...Array(19).fill(20)]),
    };
    const grid = (axisMetrics: typeof fixedMetrics) => (
      <div ref={scrollContainerRef} style={{ overflow: 'auto' }}>
        <SheetGrid
          activeCellKey={null}
          axisMetrics={axisMetrics}
          axisProjection={axisProjection}
          cellInteraction={{ clear: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn() }}
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

    const view = render(grid(fixedMetrics));
    const body = scrollContainerRef.current!;
    virtualGridGeometry(body, { height: 60, width: 100 });
    body.scrollTop = 300;
    body.scrollLeft = 250;
    fireEvent.scroll(body);
    await waitFor(() => expect(screen.queryByRole('cell', { name: 'Variable metrics A1 empty cell' })).not.toBeInTheDocument());

    view.rerender(grid(variableMetrics));

    const a1 = await screen.findByRole('cell', { name: 'Variable metrics A1 empty cell' });
    const b1 = screen.getByRole('cell', { name: 'Variable metrics B1 empty cell' });
    const bHeader = screen.getByRole('columnheader', { name: 'B' });
    const secondRow = screen.getByRole('rowheader', { name: '2' }).closest('[role="row"]');
    expect(a1).toHaveStyle({ height: '300px', left: '40px', width: '250px' });
    expect(b1).toHaveStyle({ left: '290px', width: '40px' });
    expect(getComputedStyle(b1).minWidth).toBe('40px');
    expect(getComputedStyle(b1).width).toBe('40px');
    expect(getComputedStyle(bHeader).minWidth).toBe('40px');
    expect(getComputedStyle(bHeader).width).toBe('40px');
    expect(secondRow).toHaveStyle({ height: '20px', top: '326.4px' });
    expect(screen.getByTestId('sheet-grid')).toHaveStyle({ height: '706.4px', width: '650px' });
  });

  it('allows an ordinary active cell to unmount and remount while preserving logical selection and grid entry', async () => {
    const { body, geometry } = renderMeasuredSparseGrid({ activeCellKey: 'A1' });
    await waitFor(() => expect(screen.getByRole('cell', { name: 'Sparse large sheet A1 empty cell' })).toBeInTheDocument());

    body.scrollTop = 20_000;
    body.scrollLeft = 2_000;
    fireEvent.scroll(body);
    await waitFor(() => expect(screen.queryByRole('cell', { name: 'Sparse large sheet A1 empty cell' })).not.toBeInTheDocument());
    const grid = screen.getByTestId('sheet-grid');
    expect(grid).toHaveAttribute('tabindex', '0');
    expect(screen.getAllByTestId('sheet-grid-cell').filter((cell) => cell.tabIndex === 0)).toHaveLength(0);

    body.scrollTop = 0;
    body.scrollLeft = 0;
    fireEvent.scroll(body);
    await waitFor(() => expect(screen.getByRole('cell', { name: 'Sparse large sheet A1 empty cell' })).toHaveAttribute('data-active-cell', 'true'));
    expect(screen.getAllByTestId('sheet-grid-cell').filter((cell) => cell.tabIndex === 0)).toHaveLength(1);
    act(() => geometry.resize({ height: 160, width: 240 }));
  });

  it('transfers focus to an off-window active cell when keyboard entry scrolls it into view', async () => {
    const { body, cellInteraction } = renderMeasuredSparseGrid({ activeCellKey: 'A1' });
    await waitFor(() => expect(screen.getByRole('cell', { name: 'Sparse large sheet A1 empty cell' })).toBeInTheDocument());

    body.scrollTop = 20_000;
    body.scrollLeft = 2_000;
    fireEvent.scroll(body);
    await waitFor(() => expect(screen.queryByRole('cell', { name: 'Sparse large sheet A1 empty cell' })).not.toBeInTheDocument());

    const grid = screen.getByTestId('sheet-grid');
    grid.focus();
    // Pending focus pins A1 back into the projection, but it must not take focus
    // until the native virtual window receives the browser scroll update.
    await screen.findByRole('cell', { name: 'Sparse large sheet A1 empty cell' });
    expect(document.activeElement).toBe(grid);
    // scrollToIndex changes the native scroll position; dispatch the corresponding
    // browser scroll notification so the test virtualizer projects that new window.
    body.scrollTop = 0;
    body.scrollLeft = 0;
    fireEvent.scroll(body);

    const activeCell = await screen.findByRole('cell', { name: 'Sparse large sheet A1 empty cell' });
    await waitFor(() => expect(document.activeElement).toBe(activeCell));
    fireEvent.keyDown(activeCell, { key: 'ArrowRight' });
    expect(cellInteraction.navigate).toHaveBeenCalledWith(expect.anything(), 'right');

    // A later entry to the same logical target is a fresh request, not a replay of
    // the completed transfer above.
    body.scrollTop = 20_000;
    body.scrollLeft = 2_000;
    fireEvent.scroll(body);
    await waitFor(() => expect(screen.queryByRole('cell', { name: 'Sparse large sheet A1 empty cell' })).not.toBeInTheDocument());
    grid.focus();
    await screen.findByRole('cell', { name: 'Sparse large sheet A1 empty cell' });
    expect(document.activeElement).toBe(grid);
    body.scrollTop = 0;
    body.scrollLeft = 0;
    fireEvent.scroll(body);
    const reenteredCell = await screen.findByRole('cell', { name: 'Sparse large sheet A1 empty cell' });
    await waitFor(() => expect(document.activeElement).toBe(reenteredCell));
  });

  it('makes a replaced programmatic focus request inert before its native window mounts', async () => {
    const sheet = tabularProjection(sparseLargeSheetDocument());
    const axisProjection = projectGridAxes(sheet, { columns: [], rows: [] });
    const scrollContainerRef = createRef<HTMLDivElement>();
    const onConsumed = vi.fn();

    function FocusRequestHarness() {
      const [request, setRequest] = useState({ id: 1, targetKey: 'A500' });
      return (
        <>
          <button onClick={() => setRequest({ id: 2, targetKey: 'CV10000' })} type="button">Replace request</button>
          <div ref={scrollContainerRef} style={{ overflow: 'auto' }}>
            <SheetGrid
              activeCellKey={null}
              axisProjection={axisProjection}
              cellInteraction={{ clear: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn() }}
              editingCell={null}
              editorInteraction={{ cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() }}
              formulaResults={{}}
              keyboardFocusRequest={request}
              onKeyboardFocusRequestConsumed={onConsumed}
              navigationHighlightCellKey={null}
              scrollContainerRef={scrollContainerRef}
              sheet={sheet}
            />
          </div>
        </>
      );
    }

    render(<FocusRequestHarness />);
    const body = scrollContainerRef.current!;
    virtualGridGeometry(body);
    const grid = screen.getByTestId('sheet-grid');
    await screen.findByRole('cell', { name: 'Sparse large sheet A500 empty cell' });
    expect(grid).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Replace request' }));
    await screen.findByRole('cell', { name: 'Sparse large sheet CV10000 empty cell' });

    // R1's row can now be natively visible, but it no longer owns the intent.
    body.scrollTop = 13_150;
    body.scrollLeft = 0;
    fireEvent.scroll(body);
    const staleTarget = await screen.findByRole('cell', { name: 'Sparse large sheet A500 empty cell' });
    expect(staleTarget).not.toHaveFocus();
    expect(onConsumed).not.toHaveBeenCalled();

    body.scrollTop = 264_000;
    body.scrollLeft = 7_300;
    fireEvent.scroll(body);
    const currentTarget = await screen.findByRole('cell', { name: 'Sparse large sheet CV10000 empty cell' });
    await waitFor(() => expect(currentTarget).toHaveFocus());
    expect(onConsumed).toHaveBeenCalledTimes(1);
    expect(onConsumed).toHaveBeenCalledWith(2);
  });

  it('acknowledges each application focus request once across completion-effect rerenders', async () => {
    const sheet = tabularProjection(sheetDocument({ id: 'sheet-focus', name: 'Focus' }));
    const axisProjection = projectGridAxes(sheet, { columns: [], rows: [] });
    const scrollContainerRef = createRef<HTMLDivElement>();
    const onConsumed = vi.fn();

    function FocusRequestRerenderHarness() {
      const [request, setRequest] = useState({ id: 1, targetKey: 'A1' });
      const [, setRenderVersion] = useState(0);
      return (
        <>
          <button onClick={() => setRenderVersion((version) => version + 1)} type="button">Rerender</button>
          <button onClick={() => setRequest({ id: 2, targetKey: 'B1' })} type="button">Next request</button>
          <div ref={scrollContainerRef} style={{ overflow: 'auto' }}>
            <SheetGrid
              activeCellKey={null}
              axisProjection={axisProjection}
              cellInteraction={{ clear: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn() }}
              editingCell={null}
              editorInteraction={{ cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() }}
              formulaResults={{}}
              keyboardFocusRequest={request}
              onKeyboardFocusRequestConsumed={(requestId) => onConsumed(requestId)}
              navigationHighlightCellKey={null}
              scrollContainerRef={scrollContainerRef}
              sheet={sheet}
            />
          </div>
        </>
      );
    }

    render(<FocusRequestRerenderHarness />);
    virtualGridGeometry(scrollContainerRef.current!);
    await waitFor(() => expect(onConsumed).toHaveBeenCalledTimes(1));
    expect(onConsumed).toHaveBeenLastCalledWith(1);

    fireEvent.click(screen.getByRole('button', { name: 'Rerender' }));
    await waitFor(() => expect(screen.getByRole('cell', { name: 'Focus A1 empty cell' })).toHaveFocus());
    expect(onConsumed).toHaveBeenCalledTimes(1);
    expect(onConsumed).toHaveBeenLastCalledWith(1);

    fireEvent.click(screen.getByRole('button', { name: 'Next request' }));
    await waitFor(() => expect(onConsumed).toHaveBeenCalledTimes(2));
    expect(onConsumed).toHaveBeenLastCalledWith(2);

    fireEvent.click(screen.getByRole('button', { name: 'Rerender' }));
    await waitFor(() => expect(screen.getByRole('cell', { name: 'Focus B1 empty cell' })).toHaveFocus());
    expect(onConsumed).toHaveBeenCalledTimes(2);
  });

  it('permanently invalidates a grid-entry request superseded by an application request', async () => {
    const sheet = tabularProjection(sparseLargeSheetDocument());
    const axisProjection = projectGridAxes(sheet, { columns: [], rows: [] });
    const scrollContainerRef = createRef<HTMLDivElement>();
    const onConsumed = vi.fn();

    function EntrySupersessionHarness() {
      const [request, setRequest] = useState<{ id: number; targetKey: string | null } | null>(null);
      return (
        <>
          <button onClick={() => setRequest({ id: 2, targetKey: 'CV10000' })} type="button">Replace entry</button>
          <div ref={scrollContainerRef} style={{ overflow: 'auto' }}>
            <SheetGrid
              activeCellKey="A1"
              axisProjection={axisProjection}
              cellInteraction={{ clear: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn() }}
              editingCell={null}
              editorInteraction={{ cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() }}
              formulaResults={{}}
              keyboardFocusRequest={request}
              onKeyboardFocusRequestConsumed={(requestId) => {
                onConsumed(requestId);
                setRequest(null);
              }}
              navigationHighlightCellKey={null}
              scrollContainerRef={scrollContainerRef}
              sheet={sheet}
            />
          </div>
        </>
      );
    }

    render(<EntrySupersessionHarness />);
    const body = scrollContainerRef.current!;
    virtualGridGeometry(body);
    const grid = screen.getByTestId('sheet-grid');

    body.scrollTop = 20_000;
    body.scrollLeft = 2_000;
    fireEvent.scroll(body);
    await waitFor(() => expect(screen.queryByRole('cell', { name: 'Sparse large sheet A1 empty cell' })).not.toBeInTheDocument());
    grid.focus();
    await screen.findByRole('cell', { name: 'Sparse large sheet A1 empty cell' });
    expect(grid).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Replace entry' }));
    await screen.findByRole('cell', { name: 'Sparse large sheet CV10000 empty cell' });
    body.scrollTop = 264_000;
    body.scrollLeft = 7_300;
    fireEvent.scroll(body);
    const currentTarget = await screen.findByRole('cell', { name: 'Sparse large sheet CV10000 empty cell' });
    await waitFor(() => expect(currentTarget).toHaveFocus());
    expect(onConsumed).toHaveBeenCalledWith(2);

    // Clearing R2 must leave the earlier entry inert: it cannot scroll or take
    // focus when A1 later becomes native again.
    body.scrollTop = 0;
    body.scrollLeft = 0;
    fireEvent.scroll(body);
    const staleEntryTarget = await screen.findByRole('cell', { name: 'Sparse large sheet A1 empty cell' });
    expect(staleEntryTarget).not.toHaveFocus();
    expect(document.activeElement).not.toBe(staleEntryTarget);
  });

  it('bounds mounted intersections for a sparse 10,000 by 100 sheet and keeps virtual headers sticky', () => {
    const sheet = tabularProjection(sparseLargeSheetDocument());
    const axisProjection = projectGridAxes(sheet, { columns: [], rows: [] });
    const scrollContainerRef = createRef<HTMLDivElement>();

    render(
      <div ref={scrollContainerRef} style={{ height: 200, overflow: 'auto', width: 300 }}>
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
          scrollContainerRef={scrollContainerRef}
          sheet={sheet}
        />
      </div>,
    );

    const grid = screen.getByTestId('sheet-grid');
    const dataCells = screen.getAllByRole('cell');
    const rowHeaders = screen.getAllByRole('rowheader');
    const columnHeaders = screen.getAllByRole('columnheader').filter((header) => header.getAttribute('aria-label') !== 'Grid corner');

    expect(grid).toHaveAttribute('aria-rowcount', '10001');
    expect(grid).toHaveAttribute('aria-colcount', '101');
    const headerRow = screen.getByTestId('sheet-grid-header-row');
    expect(headerRow).toHaveAttribute('role', 'row');
    expect(headerRow).toHaveStyle({ position: 'sticky', top: '0px' });
    expect(rowHeaders.length).toBeGreaterThan(0);
    expect(rowHeaders.length).toBeLessThanOrEqual(30);
    expect(columnHeaders.length).toBeGreaterThan(0);
    expect(columnHeaders.length).toBeLessThanOrEqual(30);
    expect(dataCells).toHaveLength(rowHeaders.length * columnHeaders.length);
    expect(dataCells.length).toBeLessThan(1_000);
    expect(Number.parseFloat(grid.style.height)).toBeCloseTo(26.4 + 10_000 * 26.4, 3);
    expect(grid).toHaveStyle({ width: '7640px' });
    expect(columnHeaders[0]).toHaveStyle({ left: dataCells[0].style.left });
    expect(columnHeaders[0]).toHaveStyle({ position: 'absolute', top: '0px' });
    expect(columnHeaders[0]).toHaveAttribute('aria-colindex', '2');
    expect(dataCells[0]).toHaveAttribute('aria-colindex', '2');

    // These sticky offsets keep the virtual axes visible in their respective scroll directions.
    scrollContainerRef.current!.scrollTop = 2_000;
    scrollContainerRef.current!.scrollLeft = 2_000;
    fireEvent.scroll(scrollContainerRef.current!);
    const corner = screen.getByRole('columnheader', { name: 'Grid corner' });
    expect(corner).toHaveStyle({ position: 'sticky', top: '0px', left: '0px' });
    expect(headerRow).toHaveStyle({ position: 'sticky', top: '0px' });
    expect(rowHeaders[0]).toHaveStyle({ position: 'sticky', left: '0px' });
  });

  it('keeps the logical active and editing intersection mounted with one roving tab stop after scrolling', () => {
    const sheet = tabularProjection(sparseLargeSheetDocument());
    const axisProjection = projectGridAxes(sheet, { columns: [], rows: [] });
    const scrollContainerRef = createRef<HTMLDivElement>();
    const editorInteraction = { cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() };

    render(
      <div ref={scrollContainerRef} style={{ height: 200, overflow: 'auto', width: 300 }}>
        <SheetGrid
          activeCellKey="A1"
          axisProjection={axisProjection}
          cellInteraction={{ clear: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn() }}
          editingCell={{ target: { sheetId: sheet.id, cell: cellIdentityAt(sheet, 'A1')! }, draft: 'kept draft' }}
          editorInteraction={editorInteraction}
          formulaResults={{}}
          keyboardFocusRequest={{ id: 1, targetKey: 'A1' }}
          onKeyboardFocusRequestConsumed={vi.fn()}
          navigationHighlightCellKey={null}
          scrollContainerRef={scrollContainerRef}
          sheet={sheet}
        />
      </div>,
    );

    const scrollContainer = scrollContainerRef.current!;
    scrollContainer.scrollTop = 200_000;
    scrollContainer.scrollLeft = 7_000;
    fireEvent.scroll(scrollContainer);

    const a1 = screen.getByRole('cell', { name: 'Sparse large sheet A1 empty cell' });
    expect(a1).toHaveAttribute('data-active-cell', 'true');
    expect(a1).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('textbox', { name: 'Sparse large sheet A1 editor' })).toHaveValue('kept draft');
    expect(screen.getAllByTestId('sheet-grid-cell').filter((cell) => cell.tabIndex === 0)).toHaveLength(1);
  });
});
