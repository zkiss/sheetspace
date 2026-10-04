import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { resetWorkspaceViewport } from '@test-support/workspaceActions';
import { persistedWorkbookClient } from '@test-support/apiClients';
import { openSheetContextMenu, workspaceSurface } from '@test-support/appScreen';
import { testRect } from '@test-support/domGeometry';
import { positionedSheet, workbookWithSheets } from '@test-support/workbookFactories';

describe('Phase 2 acceptance workflow', () => {
  it(
    'calculates, isolates errors, navigates, renames, persists, reloads, and recalculates a multi-sheet model',
    async () => {
      const inputs = {
        ...positionedSheet('sheet-inputs', 'Inputs', { x: 1800, y: 1200 }),
        cells: {
          A1: '12',
          B1: 'open', B2: 'closed', B3: 'open',
          C1: '5', C2: '7', C3: '9',
        },
      };
      const outputs = {
        ...positionedSheet('sheet-outputs', 'Outputs', { x: 40, y: 40 }),
        cells: {
          A1: '=SUMIF(sheet-inputs!B1:B3, "open", sheet-inputs!C1:C3)',
          A2: '=sheet-inputs!A1 + 1',
        },
      };
      const errors = {
        ...positionedSheet('sheet-errors', 'Errors', { x: 400, y: 40 }),
        cells: {
          A1: '=SUM(,)',
          C1: '=sheet-inputs!A1 + 1',
        },
      };
      const apiClient = persistedWorkbookClient(workbookWithSheets([inputs, outputs, errors]));

      render(<App apiClient={apiClient} />);

      const outputFrame = await screen.findByRole('article', { name: 'Sheet Outputs' });
      setSurfaceSize(800, 600);
      const errorsFrame = screen.getByRole('article', { name: 'Sheet Errors' });
      expectResults(outputFrame, {
        A1: '14', A2: '13',
      });
      expectResults(errorsFrame, {
        A1: '#PARSE!', C1: '13',
      });

      fireEvent.click(cellAt(outputFrame, 'A1'));
      modifierClick(screen.getByRole('button', { name: 'Inputs!B1:B3, reference' }));
      const inputFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
      expect(cellAt(inputFrame, 'B1')).toHaveFocus();
      expect(cellAt(inputFrame, 'B3')).toHaveAttribute('data-reference-selected', 'true');
      // Outer navigation reveals the physical frame at the shared detailed-entry
      // threshold; the grid scrollport reveals the referenced range internally.
      expect(workspaceSurface()).toHaveAttribute('data-viewport-x', '-1288');

      resetWorkspaceViewport();
      let currentOutputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });
      let editor = openEditor(cellAt(currentOutputFrame, 'A1'));
      expect(editor).toHaveValue('=SUMIF(Inputs!B1:B3, "open", Inputs!C1:C3)');
      fireEvent.keyDown(editor, { key: 'Escape' });

      fireEvent.click(cellAt(currentOutputFrame, 'A1'));
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
      await waitFor(() => expect(apiClient.writeCells).toHaveBeenCalledTimes(1));

      resetWorkspaceViewport();
      currentOutputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });
      const currentErrorsFrame = screen.getByRole('article', { name: 'Sheet Errors' });
      expectResults(currentOutputFrame, { A1: '14', A2: '21' });
      expectResults(currentErrorsFrame, {
        A1: '#PARSE!', C1: '21',
      });

      cleanup();
      render(<App apiClient={apiClient} />);

      const reloadedOutputs = await screen.findByRole('article', { name: 'Sheet Outputs' });
      const reloadedErrors = screen.getByRole('article', { name: 'Sheet Errors' });
      expectResults(reloadedOutputs, {
        A1: '14', A2: '21',
      });
      expectResults(reloadedErrors, {
        A1: '#PARSE!', C1: '21',
      });
      editor = openEditor(cellAt(reloadedOutputs, 'A1'));
      expect(editor).toHaveValue(
        '=SUMIF(\'Sales Data\'!B1:B3, "open", \'Sales Data\'!C1:C3)',
      );
      expect(apiClient.loadWorkbook).toHaveBeenCalledTimes(2);
    },
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
  return screen.getByRole('textbox');
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
