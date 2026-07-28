import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { openSheetContextMenu, workspaceSurface } from './test/appScreen';
import { testRect } from './test/domGeometry';
import { positionedSheet, workbookWithSheets } from './test/workbookFactories';

function modifierClick(reference: HTMLElement, modifier: 'ctrl' | 'meta' = 'ctrl') {
  fireEvent.click(reference, modifier === 'ctrl' ? { ctrlKey: true } : { metaKey: true });
}

function setSurfaceSize(width: number, height: number) {
  const surface = workspaceSurface();
  Object.defineProperties(surface, {
    clientHeight: { configurable: true, value: height },
    clientWidth: { configurable: true, value: width },
  });
  surface.getBoundingClientRect = () => testRect({ height, left: 0, top: 0, width });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('formula reference navigation', () => {
  it('requires a modifier, then focuses a same-sheet cell and keeps keyboard navigation usable', () => {
    const sheet = {
      ...positionedSheet('sheet-data', 'Data', { x: 80, y: 60 }),
      cells: { A1: '=B2', B2: '8' },
    };
    render(<App initialWorkbook={workbookWithSheets([sheet])} />);
    setSurfaceSize(800, 600);

    fireEvent.click(screen.getByRole('cell', { name: 'Data A1 cell' }));
    const reference = screen.getByRole('button', { name: 'B2, reference' });
    fireEvent.click(reference);
    expect(screen.getByRole('cell', { name: 'Data A1 cell' })).toHaveAttribute('data-active-cell');

    modifierClick(reference);
    const target = screen.getByRole('cell', { name: 'Data B2 cell' });
    expect(target).toHaveFocus();
    expect(target).toHaveAttribute('data-active-cell', 'true');
    expect(target).toHaveAttribute('data-navigation-highlight', 'true');

    fireEvent.keyDown(target, { key: 'ArrowRight' });
    expect(screen.getByRole('cell', { name: 'Data C2 empty cell' })).toHaveFocus();
  });

  it('navigates by stable sheet id after a quoted-name rename without changing z-order', async () => {
    const user = userEvent.setup();
    const inputs = {
      ...positionedSheet('sheet-inputs', 'Sales Q1', { x: 120, y: 80 }),
      cells: { A1: '7' },
      zIndex: 2,
    };
    const outputs = {
      ...positionedSheet('sheet-outputs', 'Outputs', { x: 140, y: 100 }),
      cells: { A1: '=sheet-inputs!A1' },
      zIndex: 9,
    };
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    setSurfaceSize(800, 600);

    const inputsFrame = screen.getByRole('article', { name: 'Sheet Sales Q1' });
    await user.click(within(openSheetContextMenu(inputsFrame)).getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByLabelText(/sheet name/i);
    await user.clear(input);
    await user.type(input, 'Sales 2026');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    fireEvent.click(screen.getByRole('cell', { name: 'Outputs A1 cell' }));
    modifierClick(screen.getByRole('button', { name: "'Sales 2026'!A1, reference" }), 'meta');

    expect(screen.getByRole('cell', { name: 'Sales 2026 A1 cell' })).toHaveFocus();
    expect(screen.getByRole('article', { name: 'Sheet Sales 2026' }))
      .toHaveAttribute('data-navigation-reveal', 'true');
    expect(screen.getByRole('article', { name: 'Sheet Sales 2026' }))
      .toHaveAttribute('data-z-index', '2');
    expect(screen.getByRole('article', { name: 'Sheet Outputs' })).toHaveAttribute('data-z-index', '9');
  });

  it('selects and temporarily highlights every cell in an exact rectangular range', () => {
    vi.useFakeTimers();
    const sheet = {
      ...positionedSheet('sheet-data', 'Data', { x: 80, y: 60 }),
      cells: { A1: '=SUM(B2:C3)', B2: '1', C3: '2' },
    };
    render(<App initialWorkbook={workbookWithSheets([sheet])} />);
    setSurfaceSize(800, 600);

    fireEvent.click(screen.getByRole('cell', { name: 'Data A1 cell' }));
    modifierClick(screen.getByRole('button', { name: 'B2:C3, reference' }));

    for (const key of ['B2', 'C2', 'B3', 'C3']) {
      const cell = screen.getByRole('cell', { name: new RegExp(`Data ${key} .*cell`) });
      expect(cell).toHaveAttribute('data-reference-selected', 'true');
      expect(cell).toHaveAttribute('data-navigation-highlight', 'true');
    }
    expect(screen.getByRole('cell', { name: 'Data A2 empty cell' }))
      .not.toHaveAttribute('data-reference-selected');

    act(() => vi.advanceTimersByTime(1200));
    expect(screen.getByRole('cell', { name: 'Data C3 cell' }))
      .toHaveAttribute('data-reference-selected', 'true');
    expect(screen.getByRole('cell', { name: 'Data C3 cell' }))
      .not.toHaveAttribute('data-navigation-highlight');
  });

  it('pans the actual frame onscreen and internally scrolls to an offscreen cell', () => {
    const inputs = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 1800, y: 1200 }),
      cells: { J20: '1' },
    };
    const outputs = {
      ...positionedSheet('sheet-outputs', 'Outputs', { x: 20, y: 20 }),
      cells: { A1: '=sheet-inputs!J20' },
    };
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    setSurfaceSize(800, 600);

    fireEvent.click(screen.getByRole('cell', { name: 'Outputs A1 cell' }));
    modifierClick(screen.getByRole('button', { name: 'Inputs!J20, reference' }));

    expect(workspaceSurface()).toHaveAttribute('data-viewport-scale', '1');
    expect(workspaceSurface()).toHaveAttribute('data-viewport-x', '-1288');
    expect(workspaceSurface()).toHaveAttribute('data-viewport-y', '-808');
    expect(screen.getByRole('cell', { name: 'Inputs J20 cell' })).toHaveFocus();
    const body = within(screen.getByRole('article', { name: 'Sheet Inputs' }))
      .getByTestId('sheet-frame-body');
    expect(body.scrollLeft).toBe(684);
    expect(body.scrollTop).toBe(502);
  });

  it('zooms a large frame only when its full target range stays readable', () => {
    const inputs = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 1800, y: 1200 }),
      frameSize: { width: 900, height: 600 },
      cells: { A1: '1' },
    };
    const outputs = {
      ...positionedSheet('sheet-outputs', 'Outputs', { x: 20, y: 20 }),
      cells: { A1: '=SUM(sheet-inputs!A1:B2)' },
    };
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    setSurfaceSize(800, 600);

    fireEvent.click(screen.getByRole('cell', { name: 'Outputs A1 cell' }));
    modifierClick(screen.getByRole('button', { name: 'Inputs!A1:B2, reference' }));

    const scale = Number(workspaceSurface().dataset.viewportScale);
    const x = Number(workspaceSurface().dataset.viewportX);
    const y = Number(workspaceSurface().dataset.viewportY);
    expect(scale).toBeGreaterThanOrEqual(0.75);
    expect(scale).toBeLessThan(1);
    expect(1800 * scale + x).toBeGreaterThanOrEqual(48);
    expect(2700 * scale + x).toBeLessThanOrEqual(752);
    expect(1200 * scale + y).toBeGreaterThanOrEqual(48);
    expect(1800 * scale + y).toBeLessThanOrEqual(552);
    expect(screen.getByRole('cell', { name: 'Inputs B2 empty cell' }))
      .toHaveAttribute('data-reference-selected', 'true');
  });

  it('keeps readable zoom and reveals top-left for an oversized selected range', () => {
    const inputs = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 1500, y: 900 }),
      columnCount: 15,
      rowCount: 40,
      cells: { A1: '1' },
    };
    const outputs = {
      ...positionedSheet('sheet-outputs', 'Outputs', { x: 20, y: 20 }),
      cells: { A1: '=SUM(sheet-inputs!J20:O40)' },
    };
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    setSurfaceSize(800, 600);

    fireEvent.click(screen.getByRole('cell', { name: 'Outputs A1 cell' }));
    modifierClick(screen.getByRole('button', { name: 'Inputs!J20:O40, reference' }));

    expect(workspaceSurface()).toHaveAttribute('data-viewport-scale', '1');
    expect(screen.getByRole('cell', { name: 'Inputs J20 empty cell' })).toHaveFocus();
    expect(screen.getByRole('cell', { name: 'Inputs O40 empty cell' }))
      .toHaveAttribute('data-reference-selected', 'true');
    const body = within(screen.getByRole('article', { name: 'Sheet Inputs' }))
      .getByTestId('sheet-frame-body');
    expect(body.scrollLeft).toBe(684);
    expect(body.scrollTop).toBe(502);
  });

  it('never follows a broken qualifier to a similarly named sheet and reports feedback', () => {
    const alias = positionedSheet('sheet-other', 'sheet-deleted', { x: 300, y: 80 });
    const outputs = {
      ...positionedSheet('sheet-outputs', 'Outputs', { x: 20, y: 20 }),
      cells: { A1: '=sheet-deleted!A1', A2: '=A1' },
    };
    render(<App initialWorkbook={workbookWithSheets([alias, outputs])} />);
    setSurfaceSize(800, 600);

    const formula = screen.getByRole('cell', { name: 'Outputs A1 cell' });
    fireEvent.click(formula);
    modifierClick(screen.getByRole('button', { name: '#REF!A1, broken reference' }));

    expect(formula).toHaveAttribute('data-active-cell', 'true');
    expect(screen.getByText(/cannot navigate: .* broken target/i)).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Sheet sheet-deleted' }))
      .not.toHaveAttribute('data-active-sheet');

    fireEvent.click(screen.getByRole('cell', { name: 'Outputs A2 cell' }));
    expect(screen.queryByText(/cannot navigate:/i)).not.toBeInTheDocument();
  });

  it('uses instant viewport movement when reduced motion is preferred', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const sheet = {
      ...positionedSheet('sheet-data', 'Data', { x: 1200, y: 800 }),
      cells: { A1: '=B2', B2: '8' },
    };
    render(<App initialWorkbook={workbookWithSheets([sheet])} />);
    setSurfaceSize(800, 600);

    fireEvent.click(screen.getByRole('cell', { name: 'Data A1 cell' }));
    modifierClick(screen.getByRole('button', { name: 'B2, reference' }));

    expect(screen.getByTestId('workspace-plane')).toHaveAttribute('data-navigation-motion', 'instant');
    expect(screen.getByRole('cell', { name: 'Data B2 cell' })).toHaveFocus();
  });
});
