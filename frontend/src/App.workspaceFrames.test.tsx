import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { autosaveClient } from './test/apiClients';
import { resizeHandle, workspaceSurface } from './test/appScreen';
import { measuredElementGeometry } from './test/domGeometry';
import { positionedSheet, sparseLargeSheetDocument, workbookWithSheets } from './test/workbookFactories';

const { sheetFrameRenderSpy } = vi.hoisted(() => ({ sheetFrameRenderSpy: vi.fn() }));

vi.mock('./SheetFrame', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./SheetFrame')>();
  return {
    ...actual,
    SheetFrame(props: Parameters<typeof actual.SheetFrame>[0]) {
      sheetFrameRenderSpy(props.frame.id);
      return actual.SheetFrame(props);
    },
  };
});

function measureWorkspace(width = 800, height = 600) {
  return measuredElementGeometry(workspaceSurface(), { height, width });
}

function mountedDomCounts() {
  return {
    cells: screen.queryAllByTestId('sheet-grid-cell').length,
    columnHeaders: document.querySelectorAll('.sheet-grid-column-header').length,
    frames: screen.queryAllByTestId('sheet-frame').length,
    grids: screen.queryAllByTestId('sheet-grid').length,
    headerCorners: document.querySelectorAll('.sheet-grid-corner').length,
    rowHeaders: document.querySelectorAll('.sheet-grid-row-header').length,
  };
}

describe('App workspace and sheet frame composition', () => {
  it('keeps frame, grid, cell, and header DOM bounded when wholly offscreen sheets are added', async () => {
    const visibleLarge = {
      ...sparseLargeSheetDocument({ id: 'sheet-visible', name: 'Visible' }),
      frame: { ...sparseLargeSheetDocument().frame, position: { x: 40, y: 40 }, zIndex: 3 },
    };
    const overlap = {
      ...positionedSheet('sheet-overlap', 'Overlap', { x: 120, y: 100 }),
      frame: { ...positionedSheet('sheet-overlap', 'Overlap', { x: 120, y: 100 }).frame, zIndex: 9 },
    };
    const distant = Array.from({ length: 40 }, (_, index) => ({
      ...positionedSheet(`sheet-distant-${index}`, `Distant ${index}`, {
        x: 2_200 + index * 1_500,
        y: 1_400 + index * 1_000,
      }),
      ...(index === 0 ? { cells: { B2: 'retained' } } : {}),
    }));

    const baseline = render(<App initialWorkbook={workbookWithSheets([visibleLarge, overlap])} />);
    measureWorkspace();
    await waitFor(() => expect(screen.getAllByTestId('sheet-frame')).toHaveLength(2));
    const baselineCounts = mountedDomCounts();
    baseline.unmount();

    sheetFrameRenderSpy.mockClear();
    render(<App initialWorkbook={workbookWithSheets([visibleLarge, overlap, ...distant])} />);
    expect(sheetFrameRenderSpy.mock.calls.flat()).not.toContain('sheet-distant-0');
    measureWorkspace();
    await waitFor(() => expect(screen.getAllByTestId('sheet-frame')).toHaveLength(2));
    expect(mountedDomCounts()).toEqual(baselineCounts);
    expect(baselineCounts.cells).toBeLessThan(1_200);

    const surface = workspaceSurface();
    fireEvent(surface, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }));
    fireEvent(surface, new MouseEvent('pointermove', { bubbles: true, clientX: -2_200, clientY: -1_400 }));
    fireEvent(surface, new MouseEvent('pointerup', { bubbles: true, clientX: -2_200, clientY: -1_400 }));

    await waitFor(() => expect(screen.getAllByTestId('sheet-frame')).toHaveLength(1));
    expect(screen.getByRole('article', { name: 'Sheet Distant 0' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Distant 0 B2 cell' })).toHaveTextContent('retained');
  });

  it('autosaves a committed frame resize through the application boundary', async () => {
    const apiClient = autosaveClient();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          { ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }), revision: 6 },
        ])}
        apiClient={apiClient}
      />,
    );
    const frame = screen.getByTestId('sheet-frame');
    const rightHandle = resizeHandle(frame, 'right');
    fireEvent(rightHandle, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 360, clientY: 120 }));
    fireEvent(rightHandle, new MouseEvent('pointermove', { bubbles: true, clientX: 440, clientY: 120 }));
    fireEvent(rightHandle, new MouseEvent('pointerup', { bubbles: true, clientX: 440, clientY: 120 }));
    expect(apiClient.updateSheetFrameLayout).toHaveBeenCalledWith(
      'sheet-inputs', { x: 120, y: 80 }, { width: 320, height: 160 }, { revision: 6 },
    );
    await waitFor(() => expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saved'));
  });
});
