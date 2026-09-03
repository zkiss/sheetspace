import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { openSheetContextMenu, workspaceSurface } from './test/appScreen';
import { measuredElementGeometry, virtualGridGeometry } from './test/domGeometry';
import { positionedSheet, sparseLargeSheetDocument, workbookWithSheets } from '@test/workbookFactories';

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

    await within(inputsFrame).findByRole('cell', { name: 'Inputs CU9999 empty cell' });
    body.scrollTop = 9_998 * 26.4;
    body.scrollLeft = 98 * 76;
    fireEvent.scroll(body);
    const target = await within(inputsFrame).findByRole('cell', { name: 'Inputs CU9999 empty cell' });
    expect(target).toHaveFocus();
    expect(target).toHaveAttribute('data-navigation-highlight', 'true');
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
    expect(screen.getByRole('article', { name: 'Sheet Sales 2026' })).toHaveAttribute('data-navigation-reveal', 'true');
    expect(screen.getByRole('article', { name: 'Sheet Sales 2026' })).toHaveAttribute('data-z-index', '2');
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
