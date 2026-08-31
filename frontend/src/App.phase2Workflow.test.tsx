import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { persistedWorkbookClient } from './test/apiClients';
import { openSheetContextMenu, workspaceSurface } from './test/appScreen';
import { testRect } from './test/domGeometry';
import { positionedSheet, workbookWithSheets } from './test/workbookFactories';

describe('Phase 2 acceptance workflow', () => {
  it(
    'calculates, isolates errors, navigates, renames, persists, reloads, and recalculates a multi-sheet model',
    async () => {
      const inputs = {
        ...positionedSheet('sheet-inputs', 'Inputs', { x: 1800, y: 1200 }),
        cells: {
          A1: '12', A2: '8', A3: '-2',
          B1: 'open', B2: 'closed', B3: 'open',
          C1: '5', C2: '7', C3: '9',
          F1: '=A1 + 1',
        },
      };
      const outputs = {
        ...positionedSheet('sheet-outputs', 'Outputs', { x: 40, y: 40 }),
        cells: {
          A1: '=-(sheet-inputs!A1 + 2) * sheet-inputs!C1 / 7',
          A2: '=sheet-inputs!A1 >= 10',
          A3: '=IF(A2, "high", "low")',
          A4: '=AND(sheet-inputs!A1 >= 10, NOT(FALSE), OR(FALSE, TRUE))',
          A5: '=AVERAGE(sheet-inputs!C1:C3)',
          A6: '=SUMIF(sheet-inputs!B1:B3, "open", sheet-inputs!C1:C3)',
          A7: '=COUNTIF(sheet-inputs!B1:B3, "open")',
          A8: '=sheet-inputs!F1 * 2',
        },
      };
      const errors = {
        ...positionedSheet('sheet-errors', 'Errors', { x: 400, y: 40 }),
        cells: {
          A1: '=SUM(,)',
          A2: '=sheet-missing!A1',
          A3: '=1 / 0',
          A4: '=COUNTIF(sheet-inputs!B1:B3, ">")',
          A5: '=B5',
          B5: '=A5',
          C1: '=sheet-inputs!A1 + 1',
        },
      };
      const apiClient = persistedWorkbookClient(workbookWithSheets([inputs, outputs, errors]));

      render(<App apiClient={apiClient} />);

      const outputFrame = await screen.findByRole('article', { name: 'Sheet Outputs' });
      setSurfaceSize(800, 600);
      const errorsFrame = screen.getByRole('article', { name: 'Sheet Errors' });
      expectResults(outputFrame, {
        A1: '-10', A2: 'TRUE', A3: 'high', A4: 'TRUE',
        A5: '7', A6: '14', A7: '2', A8: '26',
      });
      expectResults(errorsFrame, {
        A1: '#PARSE!', A2: '#REF!', A3: '#DIV/0!', A4: '#VALUE!',
        A5: '#CYCLE!', B5: '#CYCLE!', C1: '13',
      });

      fireEvent.click(cellAt(outputFrame, 'A3'));
      modifierClick(screen.getByRole('button', { name: 'A2, reference' }));
      expect(cellAt(outputFrame, 'A2')).toHaveFocus();
      expect(cellAt(outputFrame, 'A2')).toHaveAttribute('data-navigation-highlight', 'true');

      fireEvent.click(cellAt(outputFrame, 'A6'));
      modifierClick(screen.getByRole('button', { name: 'Inputs!B1:B3, reference' }));
      const inputFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
      expect(cellAt(inputFrame, 'B1')).toHaveFocus();
      expect(cellAt(inputFrame, 'B3')).toHaveAttribute('data-reference-selected', 'true');
      expect(workspaceSurface()).toHaveAttribute('data-viewport-x', '-1288');

      fireEvent.click(screen.getByRole('button', { name: 'Reset workspace viewport' }));
      let currentOutputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });
      let editor = openEditor(cellAt(currentOutputFrame, 'A6'));
      expect(editor).toHaveValue('=SUMIF(Inputs!B1:B3, "open", Inputs!C1:C3)');
      fireEvent.keyDown(editor, { key: 'Escape' });

      fireEvent.click(cellAt(currentOutputFrame, 'A6'));
      modifierClick(screen.getByRole('button', { name: 'Inputs!B1:B3, reference' }));
      const currentInputFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
      fireEvent.click(within(openSheetContextMenu(currentInputFrame)).getByRole('menuitem', { name: 'Rename' }));
      fireEvent.change(screen.getByLabelText(/sheet name/i), { target: { value: 'Sales Data' } });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      await waitFor(() => expect(apiClient.renameSheet).toHaveBeenCalledWith(
        'sheet-inputs', 'Sales Data', { revision: 0 },
      ));

      const renamedInputFrame = screen.getByRole('article', { name: 'Sheet Sales Data' });
      editor = openEditor(cellAt(renamedInputFrame, 'A1'));
      fireEvent.change(editor, { target: { value: '20' } });
      fireEvent.keyDown(editor, { key: 'Enter' });
      await waitFor(() => expect(apiClient.updateCellContent).toHaveBeenCalledWith(
        'sheet-inputs', 'A1', '20', { revision: 0 },
      ));

      fireEvent.click(screen.getByRole('button', { name: 'Reset workspace viewport' }));
      currentOutputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });
      const currentErrorsFrame = screen.getByRole('article', { name: 'Sheet Errors' });
      expectResults(currentOutputFrame, { A1: '-15.714285714285714', A2: 'TRUE', A3: 'high', A8: '42' });
      expectResults(currentErrorsFrame, {
        A1: '#PARSE!', A2: '#REF!', A3: '#DIV/0!', A4: '#VALUE!',
        A5: '#CYCLE!', B5: '#CYCLE!', C1: '21',
      });

      cleanup();
      render(<App apiClient={apiClient} />);

      const reloadedOutputs = await screen.findByRole('article', { name: 'Sheet Outputs' });
      const reloadedErrors = screen.getByRole('article', { name: 'Sheet Errors' });
      expectResults(reloadedOutputs, {
        A1: '-15.714285714285714', A2: 'TRUE', A3: 'high', A4: 'TRUE',
        A5: '7', A6: '14', A7: '2', A8: '42',
      });
      expectResults(reloadedErrors, {
        A1: '#PARSE!', A2: '#REF!', A3: '#DIV/0!', A4: '#VALUE!',
        A5: '#CYCLE!', B5: '#CYCLE!', C1: '21',
      });
      editor = openEditor(cellAt(reloadedOutputs, 'A6'));
      expect(editor).toHaveValue(
        '=SUMIF(\'Sales Data\'!B1:B3, "open", \'Sales Data\'!C1:C3)',
      );
      expect(apiClient.loadWorkbook).toHaveBeenCalledTimes(2);
    },
    8_000,
  );
});

function setSurfaceSize(width: number, height: number) {
  const surface = workspaceSurface();
  Object.defineProperties(surface, {
    clientHeight: { configurable: true, value: height },
    clientWidth: { configurable: true, value: width },
  });
  surface.getBoundingClientRect = () => testRect({ height, left: 0, top: 0, width });
}

function modifierClick(reference: HTMLElement) {
  fireEvent.click(reference, { ctrlKey: true });
}

function openEditor(cell: HTMLElement) {
  fireEvent.doubleClick(cell);
  const editor = cell.querySelector('textarea');
  if (!editor) throw new Error(`Missing editor for cell ${cell.dataset.cellKey}`);
  return editor;
}

function cellAt(frame: HTMLElement, cellKey: string) {
  const cell = frame.querySelector<HTMLElement>(`[data-cell-key="${cellKey}"]`);
  if (!cell) throw new Error(`Missing cell ${cellKey}`);
  return cell;
}

function expectResults(frame: HTMLElement, expected: Readonly<Record<string, string>>) {
  for (const [cellKey, display] of Object.entries(expected)) {
    expect(cellAt(frame, cellKey)).toHaveTextContent(new RegExp(`^${escapeRegex(display)}$`));
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
