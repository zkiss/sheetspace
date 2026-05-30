import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { deterministicSheetId, persistedWorkbookClient } from './test/apiClients';
import { createSheetFromToolbar, openCellEditor, openSheetContextMenu, workspaceSurface } from './test/appScreen';
import { workspaceRect } from './test/domGeometry';
import { workbookWithSheets } from './test/workbookFactories';

describe('App MVP workflow', () => {
  it(
    'persists and reloads the complete MVP workflow across creation paths, arrangement, rename, formulas, and appended dimensions',
    async () => {
      const user = userEvent.setup();
      const rawSameSheetFormula = '= \n SuM ( B1 , B2 )';
      const rawCrossSheetFormula = '=SUM(Renamed Inputs!B1:B2)';
      const apiClient = persistedWorkbookClient();
      const inputSheetId = deterministicSheetId(1);
      const outputSheetId = deterministicSheetId(2);

      render(<App initialWorkbook={workbookWithSheets([])} apiClient={apiClient} />);

      await createSheetFromToolbar('Inputs');
      await waitFor(() => expect(apiClient.createSheet).toHaveBeenCalledTimes(1));

      workspaceSurface().getBoundingClientRect = workspaceRect;
      fireEvent.contextMenu(workspaceSurface(), { clientX: 440, clientY: 290 });
      await user.type(screen.getByLabelText(/sheet name/i), 'Outputs');
      await user.click(screen.getByRole('button', { name: /^create$/i }));
      await waitFor(() => expect(apiClient.createSheet).toHaveBeenCalledTimes(2));

      let inputFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
      const inputHeader = within(inputFrame).getByTestId('sheet-frame-header');
      fireEvent(inputHeader, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 120 }));
      fireEvent(inputHeader, new MouseEvent('pointermove', { bubbles: true, clientX: 172, clientY: 264 }));
      fireEvent(inputHeader, new MouseEvent('pointerup', { bubbles: true, clientX: 172, clientY: 264 }));
      await waitFor(() =>
        expect(apiClient.updateSheetPosition).toHaveBeenCalledWith(inputSheetId, { x: 72, y: 144 }, { revision: 0 }),
      );

      await user.click(within(openSheetContextMenu(inputFrame)).getByRole('menuitem', { name: 'Rename' }));
      await user.clear(screen.getByLabelText(/sheet name/i));
      await user.type(screen.getByLabelText(/sheet name/i), 'Renamed Inputs');
      await user.click(screen.getByRole('button', { name: /^save$/i }));
      await waitFor(() =>
        expect(apiClient.renameSheet).toHaveBeenCalledWith(inputSheetId, 'Renamed Inputs', { revision: 0 }),
      );

      inputFrame = screen.getByRole('article', { name: 'Sheet Renamed Inputs' });
      const outputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });

      let editor = await openCellEditor(
        user,
        within(inputFrame).getByRole('cell', { name: 'Renamed Inputs B1 empty cell' }),
      );
      await user.type(editor, '10');
      await user.keyboard('{Enter}');

      editor = await openCellEditor(
        user,
        within(inputFrame).getByRole('cell', { name: 'Renamed Inputs B2 empty cell' }),
      );
      await user.type(editor, '5');
      await user.keyboard('{Enter}');

      editor = await openCellEditor(
        user,
        within(inputFrame).getByRole('cell', { name: 'Renamed Inputs C1 empty cell' }),
      );
      fireEvent.change(editor, { target: { value: rawSameSheetFormula } });
      await user.keyboard('{Enter}');

      editor = await openCellEditor(user, within(outputFrame).getByRole('cell', { name: 'Outputs A1 empty cell' }));
      await user.type(editor, rawCrossSheetFormula);
      await user.keyboard('{Enter}');

      await user.click(within(openSheetContextMenu(inputFrame)).getByRole('menuitem', { name: 'Append row' }));
      await user.click(within(openSheetContextMenu(inputFrame)).getByRole('menuitem', { name: 'Append column' }));

      await waitFor(() => expect(apiClient.updateCellContent).toHaveBeenCalledTimes(4));
      await waitFor(() => expect(apiClient.appendRow).toHaveBeenCalledWith(inputSheetId, { revision: 0 }));
      await waitFor(() => expect(apiClient.appendColumn).toHaveBeenCalledWith(inputSheetId, { revision: 0 }));
      expect(within(inputFrame).getByRole('cell', { name: 'Renamed Inputs C1 cell' })).toHaveTextContent('15');
      expect(within(outputFrame).getByRole('cell', { name: 'Outputs A1 cell' })).toHaveTextContent('15');

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
      expect(within(reloadedInputFrame).getByRole('cell', { name: 'Renamed Inputs C1 cell' })).toHaveTextContent(
        '15',
      );
      expect(within(reloadedOutputFrame).getByRole('cell', { name: 'Outputs A1 cell' })).toHaveTextContent('15');

      editor = await openCellEditor(
        user,
        within(reloadedInputFrame).getByRole('cell', { name: 'Renamed Inputs C1 cell' }),
      );
      expect(editor).toHaveValue(rawSameSheetFormula);
      await user.keyboard('{Escape}');

      editor = await openCellEditor(user, within(reloadedOutputFrame).getByRole('cell', { name: 'Outputs A1 cell' }));
      expect(editor).toHaveValue(rawCrossSheetFormula);
      expect(apiClient.loadWorkbook).toHaveBeenCalledTimes(1);
    },
    20_000,
  );
});
