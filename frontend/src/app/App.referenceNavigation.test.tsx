import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { openSheetContextMenu, workspaceSurface } from '@test-support/appScreen';
import { measuredElementGeometry, virtualGridGeometry } from '@test-support/domGeometry';
import { positionedSheet, sheetDocument, sparseLargeSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

function modifierClick(reference: HTMLElement, modifier: 'ctrl' | 'meta' = 'ctrl') {
  fireEvent.click(reference, modifier === 'ctrl' ? { ctrlKey: true } : { metaKey: true });
}

function setSurfaceSize(width: number, height: number) {
  return measuredElementGeometry(workspaceSurface(), { height, width });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('formula reference navigation', () => {
  it('jumps across sheets to a distant range through a measured virtual window', async () => {
    const inputs = sparseLargeSheetDocument({ id: 'sheet-inputs', name: 'Inputs' });
    const outputs = {
      ...positionedSheet('sheet-outputs', 'Outputs', { x: 20, y: 20 }),
      cells: { A1: '=SUM(sheet-inputs!CU9999:CV10000)' },
    };
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    act(() => { setSurfaceSize(800, 600); });
    const inputsFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const body = within(inputsFrame).getByTestId('sheet-frame-body');
    virtualGridGeometry(body, { height: 160, width: 240 });

    fireEvent.click(screen.getByRole('cell', { name: 'Outputs A1 cell' }));
    modifierClick(screen.getByRole('button', { name: 'Inputs!CU9999:CV10000, reference' }));
    expect(within(inputsFrame).getByRole('cell', { name: 'Inputs CU9999 empty cell' }))
      .toHaveAttribute('data-navigation-highlight', 'true');

    await within(inputsFrame).findByRole('cell', { name: 'Inputs CU9999 empty cell' });
    body.scrollTop = 9_998 * 26.4;
    body.scrollLeft = 98 * 76;
    fireEvent.scroll(body);
    expect(within(inputsFrame).getByRole('cell', { name: 'Inputs CV10000 empty cell' })).toHaveAttribute('data-reference-selected', 'true');
    expect(within(inputsFrame).getAllByTestId('sheet-grid-cell').length).toBeLessThan(1_000);
  });

  it('navigates by stable sheet id after a quoted-name rename', async () => {
    const user = userEvent.setup();
    const inputs = { ...positionedSheet('sheet-inputs', 'Sales Q1', { x: 120, y: 80 }), cells: { A1: '7' }, zIndex: 2 };
    const outputs = { ...positionedSheet('sheet-outputs', 'Outputs', { x: 140, y: 100 }), cells: { A1: '=sheet-inputs!A1' }, zIndex: 9 };
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
    const revealedFrame = screen.getByRole('article', { name: 'Sheet Sales 2026' });
    const overlappingFrame = screen.getByRole('article', { name: 'Sheet Outputs' });
    expect(revealedFrame).toHaveAttribute('data-navigation-reveal', 'true');
    expect(revealedFrame).toHaveAttribute('data-z-index', '2');
    expect(revealedFrame).toHaveStyle({ zIndex: '2' });
    expect(overlappingFrame).toHaveStyle({ zIndex: '9' });
  });

  it('reveals an initially culled miniature at detailed scale and releases its navigation pin', async () => {
    const inputs = sheetDocument({
      id: 'sheet-inputs', name: 'Inputs', position: { x: 4_000, y: 3_000 }, visualScale: 0.25,
      cells: { B2: 'target' }, zIndex: 2,
    });
    const outputs = {
      ...positionedSheet('sheet-outputs', 'Outputs', { x: 20, y: 20 }),
      cells: { A1: '=sheet-inputs!B2' },
    };
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    act(() => { setSurfaceSize(800, 600); });
    expect(screen.queryByRole('article', { name: 'Sheet Inputs' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('cell', { name: 'Outputs A1 cell' }));
    modifierClick(screen.getByRole('button', { name: 'Inputs!B2, reference' }));

    const inputsFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    expect(inputsFrame).toHaveAttribute('data-rendering-mode', 'detailed');
    virtualGridGeometry(within(inputsFrame).getByTestId('sheet-frame-body'), { height: 160, width: 240 });
    const target = await within(inputsFrame).findByRole('cell', { name: 'Inputs B2 cell' });
    expect(target).toHaveFocus();
    expect(target).toHaveAttribute('data-navigation-highlight', 'true');
    expect(inputsFrame).toHaveAttribute('data-z-index', '2');

    fireEvent.click(screen.getByRole('button', { name: 'Reset workspace viewport' }));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Sheet Inputs' })).not.toBeInTheDocument());
  });

  it('immediately focuses the anchor of an oversized custom-axis range with reduced motion', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    const inputs = sheetDocument({
      id: 'sheet-inputs', name: 'Inputs', position: { x: 3_000, y: 2_000 }, visualScale: 0.25,
      columnCount: 100, rowCount: 10_000,
      presentation: { columnWidths: { 'sheet-inputs:column:99': 260 }, rowHeights: { 'sheet-inputs:row:9999': 90 } },
    });
    const outputs = {
      ...positionedSheet('sheet-outputs', 'Outputs', { x: 20, y: 20 }),
      cells: { A1: '=SUM(sheet-inputs!CU9999:CV10000)' },
    };
    const archive = sheetDocument({
      id: 'sheet-archive', name: 'Archive', position: { x: 6_000, y: 4_000 }, visualScale: 0.25,
    });
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs, archive])} />);
    act(() => { setSurfaceSize(800, 600); });
    expect(screen.queryByRole('article', { name: 'Sheet Archive' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('cell', { name: 'Outputs A1 cell' }));
    modifierClick(screen.getByRole('button', { name: 'Inputs!CU9999:CV10000, reference' }));

    const inputsFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    expect(screen.getByTestId('workspace-plane')).toHaveAttribute('data-navigation-motion', 'instant');
    expect(inputsFrame).toHaveAttribute('data-rendering-mode', 'detailed');
    const body = within(inputsFrame).getByTestId('sheet-frame-body');
    virtualGridGeometry(body, { height: 160, width: 240 });
    body.scrollTop = 9_998 * 26.4;
    body.scrollLeft = 98 * 76;
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    fireEvent.scroll(body);
    await waitFor(() => expect((focus.mock.instances as unknown as HTMLElement[]).some((element) =>
      element.getAttribute('aria-label') === 'Inputs CU9999 empty cell',
    )).toBe(true));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Sheet Inputs' })).not.toBeInTheDocument());
    expect(screen.queryByRole('article', { name: 'Sheet Archive' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset workspace viewport' }));
  });

  it('reports a broken reference without selecting a similarly named sheet', () => {
    const alias = positionedSheet('sheet-other', 'sheet-deleted', { x: 300, y: 80 });
    const outputs = { ...positionedSheet('sheet-outputs', 'Outputs', { x: 20, y: 20 }), cells: { A1: '=sheet-deleted!A1' } };
    render(<App initialWorkbook={workbookWithSheets([alias, outputs])} />);
    setSurfaceSize(800, 600);

    const formula = screen.getByRole('cell', { name: 'Outputs A1 cell' });
    fireEvent.click(formula);
    modifierClick(screen.getByRole('button', { name: '#REF!A1, broken reference' }));

    expect(formula).toHaveAttribute('data-active-cell', 'true');
    expect(screen.getByText(/cannot navigate: .* broken target/i)).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Sheet sheet-deleted' })).not.toHaveAttribute('data-active-sheet');
  });
});
