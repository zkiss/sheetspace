import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { deterministicSheetId, persistedWorkbookClient } from './test/apiClients';
import { openSheetContextMenu, workspaceSurface } from './test/appScreen';
import { workspaceRect } from './test/domGeometry';
import { workbookWithSheets } from './test/workbookFactories';

describe('App MVP workflow', () => {
  it(
    'persists and reloads the complete MVP workflow across creation paths, arrangement, rename, formulas, and appended dimensions',
    async () => {
      const rawSameSheetFormula = '= \n SuM ( B1 , B2 )';
      const rawCrossSheetFormula = '=SUM(Renamed Inputs!B1:B2)';
      const apiClient = persistedWorkbookClient();
      const inputSheetId = deterministicSheetId(1);
      const outputSheetId = deterministicSheetId(2);

      render(<App initialWorkbook={workbookWithSheets([])} apiClient={apiClient} />);

      fireEvent.click(screen.getByRole('button', { name: /new sheet/i }));
      fireEvent.change(screen.getByLabelText(/sheet name/i), { target: { value: 'Inputs' } });
      fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
      await waitFor(() => expect(apiClient.createSheet).toHaveBeenCalledTimes(1));

      workspaceSurface().getBoundingClientRect = workspaceRect;
      fireEvent.contextMenu(workspaceSurface(), { clientX: 440, clientY: 290 });
      fireEvent.change(screen.getByLabelText(/sheet name/i), { target: { value: 'Outputs' } });
      fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
      await waitFor(() => expect(apiClient.createSheet).toHaveBeenCalledTimes(2));

      let inputFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
      const inputHeader = within(inputFrame).getByTestId('sheet-frame-header');
      fireEvent(inputHeader, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 120 }));
      fireEvent(inputHeader, new MouseEvent('pointermove', { bubbles: true, clientX: 172, clientY: 264 }));
      fireEvent(inputHeader, new MouseEvent('pointerup', { bubbles: true, clientX: 172, clientY: 264 }));
      await waitFor(() =>
        expect(apiClient.updateSheetPosition).toHaveBeenCalledWith(inputSheetId, { x: 72, y: 144 }, { revision: 0 }),
      );

      fireEvent.click(within(openSheetContextMenu(inputFrame)).getByRole('menuitem', { name: 'Rename' }));
      fireEvent.change(screen.getByLabelText(/sheet name/i), { target: { value: 'Renamed Inputs' } });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      await waitFor(() =>
        expect(apiClient.renameSheet).toHaveBeenCalledWith(inputSheetId, 'Renamed Inputs', { revision: 0 }),
      );
      inputFrame = screen.getByRole('article', { name: 'Sheet Renamed Inputs' });
      const outputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });

      let editor = openSmokeCellEditor(cellAt(inputFrame, 'B1'));
      fireEvent.change(editor, { target: { value: '10' } });
      fireEvent.keyDown(editor, { key: 'Enter' });

      editor = openSmokeCellEditor(cellAt(inputFrame, 'B2'));
      fireEvent.change(editor, { target: { value: '5' } });
      fireEvent.keyDown(editor, { key: 'Enter' });

      editor = openSmokeCellEditor(cellAt(inputFrame, 'C1'));
      fireEvent.change(editor, { target: { value: rawSameSheetFormula } });
      fireEvent.keyDown(editor, { key: 'Enter' });

      editor = openSmokeCellEditor(cellAt(outputFrame, 'A1'));
      fireEvent.change(editor, { target: { value: rawCrossSheetFormula } });
      fireEvent.keyDown(editor, { key: 'Enter' });

      fireEvent.click(within(openSheetContextMenu(inputFrame)).getByRole('menuitem', { name: 'Append row' }));
      fireEvent.click(within(openSheetContextMenu(inputFrame)).getByRole('menuitem', { name: 'Append column' }));

      await waitFor(() => expect(apiClient.updateCellContent).toHaveBeenCalledTimes(4));
      await waitFor(() => expect(apiClient.appendRow).toHaveBeenCalledWith(inputSheetId, { revision: 0 }));
      await waitFor(() => expect(apiClient.appendColumn).toHaveBeenCalledWith(inputSheetId, { revision: 0 }));
      expect(cellAt(inputFrame, 'C1')).toHaveTextContent('15');
      expect(cellAt(outputFrame, 'A1')).toHaveTextContent('15');
      cleanup();
      render(<App apiClient={apiClient} />);

      const reloadedInputFrame = await screen.findByRole('article', { name: 'Sheet Renamed Inputs' });
      const reloadedOutputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });

      expect(reloadedInputFrame).toHaveAttribute('data-sheet-id', inputSheetId);
      expect(reloadedInputFrame).toHaveAttribute('data-position-x', '72');
      expect(reloadedInputFrame).toHaveAttribute('data-position-y', '144');
      expect(reloadedInputFrame).toHaveAttribute('data-row-count', '21');
      expect(reloadedInputFrame).toHaveAttribute('data-column-count', '11');
      expect(reloadedOutputFrame).toHaveAttribute('data-sheet-id', outputSheetId);
      expect(reloadedOutputFrame).toHaveAttribute('data-position-x', '420');
      expect(reloadedOutputFrame).toHaveAttribute('data-position-y', '260');
      expect(cellAt(reloadedInputFrame, 'C1')).toHaveTextContent('15');
      expect(cellAt(reloadedOutputFrame, 'A1')).toHaveTextContent('15');

      editor = openSmokeCellEditor(cellAt(reloadedInputFrame, 'C1'));
      expect(editor).toHaveValue(rawSameSheetFormula);
      fireEvent.keyDown(editor, { key: 'Escape' });

      editor = openSmokeCellEditor(cellAt(reloadedOutputFrame, 'A1'));
      expect(editor).toHaveValue("=SUM('Renamed Inputs'!B1:B2)");
      expect(apiClient.loadWorkbook).toHaveBeenCalledTimes(1);
    },
    8_000,
  );
});

function openSmokeCellEditor(cell: HTMLElement) {
  // Focused interaction suites cover browser-like event sequences. This broad smoke test emits
  // one semantic event per action so parallel coverage load measures product work, not event expansion.
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
