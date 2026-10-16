import { createRef, useState, type ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectGridAxes } from '@grid/gridAxisProjection';
import { createGridAxisMetrics } from './gridAxisMetrics';
import { SheetGrid } from '@grid/SheetGrid';
import { sheetDocument, sparseLargeSheetDocument } from '@test-support/workbookFactories';
import { tabularProjection } from '@workbook/read/queries';
import { testRect, virtualGridGeometry } from '@test-support/domGeometry';

afterEach(cleanup);
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


describe('SheetGrid virtualization', () => {
  it('measures two-axis windows at edges, retains overlapping identities, and reacts to resize', async () => {
    const { body, geometry } = renderMeasuredSparseGrid();
    await waitFor(() => expect(mountedCellKeys()).toContain('A1'));
    const initial = mountedCellKeys();
    const grid = screen.getByTestId('sheet-grid');

    act(() => geometry.resize({ height: 320, width: 480 }));
    await waitFor(() => expect(mountedCellKeys().length).toBeGreaterThan(initial.length));
    expect(Number.parseFloat(grid.style.height)).toBe(Math.ceil(264026.4));
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
    expect(screen.getByTestId('sheet-grid')).toHaveStyle({ height: '707px', width: '650px' });
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

  it.each([
    { effectiveScale: 0.4, name: 'combined miniature scale' },
    { effectiveScale: 1.5, name: 'combined enlarged scale' },
  ])('converts sticky-header focus corrections to logical offsets at $name', async ({ effectiveScale }) => {
    const sheet = tabularProjection(sparseLargeSheetDocument());
    const axisProjection = projectGridAxes(sheet, { columns: [], rows: [] });
    const scrollContainerRef = createRef<HTMLDivElement>();
    const onConsumed = vi.fn();

    function FocusHarness() {
      const [request, setRequest] = useState<{ id: number; targetKey: string | null } | null>(null);
      return (
        <>
          <button onClick={() => setRequest({ id: 1, targetKey: 'N40' })} type="button">Focus scaled cell</button>
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

    render(<FocusHarness />);
    const body = scrollContainerRef.current!;
    virtualGridGeometry(body);
    body.scrollTop = 1_000;
    body.scrollLeft = 1_000;
    fireEvent.scroll(body);
    const target = await screen.findByRole('cell', { name: 'Sparse large sheet N40 empty cell' });
    expect(screen.queryByRole('rowheader', { name: '1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'A' })).not.toBeInTheDocument();

    const containerTop = 30;
    const containerLeft = 20;
    const headerHeight = 26.4 * effectiveScale;
    const headerWidth = 40 * effectiveScale;
    body.getBoundingClientRect = () => testRect({
      height: 160 * effectiveScale, left: containerLeft, top: containerTop, width: 240 * effectiveScale,
    });
    // The target is hidden by eight rendered pixels vertically and seven horizontally.
    target.getBoundingClientRect = () => testRect({
      height: 20,
      left: containerLeft + headerWidth - 7 - (body.scrollLeft - 1_000) * effectiveScale,
      top: containerTop + headerHeight - 8 - (body.scrollTop - 1_000) * effectiveScale,
      width: 40,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Focus scaled cell' }));

    await waitFor(() => expect(onConsumed).toHaveBeenCalledWith(1));
    expect(body.scrollTop).toBeCloseTo(1_000 - 8 / effectiveScale);
    expect(body.scrollLeft).toBeCloseTo(1_000 - 7 / effectiveScale);
    expect(target).toHaveFocus();
    expect(target.getBoundingClientRect().top).toBeCloseTo(containerTop + headerHeight);
    expect(target.getBoundingClientRect().left).toBeCloseTo(containerLeft + headerWidth);
  });

});
