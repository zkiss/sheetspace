import { createRef, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectGridAxes } from '@grid/gridAxisProjection';
import { SheetGrid } from '@grid/SheetGrid';
import { sparseLargeSheetDocument } from '@test-support/workbookFactories';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import { tabularProjection } from '@workbook/read/queries';
import { virtualGridGeometry } from '@test-support/domGeometry';

afterEach(cleanup);
describe('SheetGrid virtualization', () => {
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
    expect(Number.parseFloat(grid.style.height)).toBe(Math.ceil(26.4 + 10_000 * 26.4));
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
          editingCell={{ target: { sheetId: sheet.id, cell: cellIdentityAt(sheet, 'A1')! }, draft: 'kept draft', sessionId: 1 }}
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
