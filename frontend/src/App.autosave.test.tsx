import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { autosaveClient, deferred, persistedWorkbookClient } from './test/apiClients';
import { openCellEditor, openSheetContextMenu } from './test/appScreen';
import { positionedSheet, workbookWithSheets } from './test/workbookFactories';
import type { SheetDocument } from './workbook';
import type { SheetRevisionResponse } from './workbookApi';

describe('App autosave integration', () => {
  it('autosaves committed sheet creation and reports app-level save status', async () => {
    const savedSheet = positionedSheet('sheet-1', 'Inputs', { x: 0, y: 0 });
    const createSave = deferred<SheetDocument>();
    const apiClient = autosaveClient({
      createSheet: vi.fn().mockReturnValue(createSave.promise),
    });
    const user = userEvent.setup();

    render(<App initialWorkbook={workbookWithSheets([])} apiClient={apiClient} />);

    await user.click(screen.getByRole('button', { name: /new sheet/i }));
    await user.type(screen.getByLabelText(/sheet name/i), 'Inputs');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    expect(apiClient.createSheet).toHaveBeenCalledWith({
      name: 'Inputs',
      position: { x: 0, y: 0 },
    });
    expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saving...');
    const creatingFrame = screen.getByRole('article', { name: 'Creating sheet Inputs' });
    expect(creatingFrame).not.toHaveAttribute('data-sheet-id');
    expect(within(creatingFrame).queryByRole('grid')).not.toBeInTheDocument();

    createSave.resolve(savedSheet);

    await waitFor(() => expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saved'));
    expect(screen.getByRole('article', { name: 'Sheet Inputs' })).toHaveAttribute('data-sheet-id', 'sheet-1');
  });

  it('autosaves committed cell edits while ignoring transient in-progress edits', async () => {
    const user = userEvent.setup();
    const apiClient = autosaveClient();

    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
        apiClient={apiClient}
      />,
    );

    const cell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    const editor = await openCellEditor(user, cell);
    await user.type(editor, 'Draft');

    expect(apiClient.updateCellContent).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');

    expect(apiClient.updateCellContent).toHaveBeenCalledWith('sheet-inputs', 'A1', 'Draft', { revision: 0 });
  });

  it('persists canonical formulas and reopens only current A1 names after reload', async () => {
    const user = userEvent.setup();
    const apiClient = persistedWorkbookClient(workbookWithSheets([
      positionedSheet('sheet-inputs', 'Sales Q1', { x: 120, y: 80 }),
      positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 80 }),
    ]));
    const first = render(<App apiClient={apiClient} />);
    const output = await screen.findByRole('cell', { name: 'Outputs A1 empty cell' });

    await user.type(
      await openCellEditor(user, output),
      "=SUM('Sales Q1'!$A1:B$2, A2)",
    );
    await user.keyboard('{Enter}');

    const canonical = "=SUM('sheet-inputs'!@[$sheet-inputs:column:1,sheet-inputs:row:1]:@[sheet-inputs:column:2,$sheet-inputs:row:2], @[sheet-outputs:column:1,sheet-outputs:row:2])";
    expect(apiClient.updateCellContent).toHaveBeenCalledWith(
      'sheet-outputs',
      'A1',
      canonical,
      { revision: 0 },
    );
    await waitFor(() => expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saved'));

    first.unmount();
    await apiClient.renameSheet('sheet-inputs', 'Owner\'s Plan');
    render(<App apiClient={apiClient} />);

    const reloaded = await screen.findByRole('cell', { name: 'Outputs A1 cell' });
    const editor = await openCellEditor(user, reloaded);
    expect(editor).toHaveValue("=SUM('Owner''s Plan'!$A1:B$2, A2)");
    expect((editor as HTMLTextAreaElement).value).not.toContain('sheet-inputs');
  });

  it('autosaves optimistic sheet deletion and reports app-level save status', async () => {
    const user = userEvent.setup();
    const sheet = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }), revision: 2 };
    const deleteSave = deferred<void>();
    const apiClient = autosaveClient({
      deleteSheet: vi.fn().mockReturnValue(deleteSave.promise),
    });

    render(<App initialWorkbook={workbookWithSheets([sheet])} apiClient={apiClient} />);

    await user.click(within(openSheetContextMenu(screen.getByRole('article', { name: 'Sheet Inputs' }))).getByRole('menuitem', { name: 'Delete' }));

    expect(screen.queryByRole('article', { name: 'Sheet Inputs' })).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saving...');
    expect(apiClient.deleteSheet).toHaveBeenCalledWith('sheet-inputs', { revision: 2 });

    deleteSave.resolve();

    await waitFor(() => expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saved'));
  });

  it('keeps the workbook editable and shows failed unsaved state after autosave failure', async () => {
    const user = userEvent.setup();
    const failedSave = deferred<SheetRevisionResponse>();
    const apiClient = autosaveClient({
      updateCellContent: vi.fn().mockReturnValue(failedSave.promise),
    });

    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
        apiClient={apiClient}
      />,
    );

    const a1 = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    const a1Editor = await openCellEditor(user, a1);
    await user.type(a1Editor, 'Local value');
    await user.keyboard('{Enter}');

    failedSave.reject(new Error('backend unavailable'));

    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Save failed - unsaved changes'),
    );
    expect(a1).toHaveTextContent('Local value');

    const b1 = screen.getByRole('cell', { name: 'Inputs B1 empty cell' });
    const b1Editor = await openCellEditor(user, b1);
    await user.type(b1Editor, 'Still editable');
    await user.keyboard('{Enter}');

    expect(b1).toHaveTextContent('Still editable');
  });

  it('retries a retained failed save from the toolbar without applying the edit twice', async () => {
    const user = userEvent.setup();
    const retrySave = deferred<SheetRevisionResponse>();
    const updateCellContent = vi.fn()
      .mockRejectedValueOnce(new Error('backend unavailable'))
      .mockReturnValueOnce(retrySave.promise);
    const apiClient = autosaveClient({ updateCellContent });

    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
        apiClient={apiClient}
      />,
    );

    const a1 = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    await user.type(await openCellEditor(user, a1), 'Local value');
    await user.keyboard('{Enter}');
    const retryButton = await screen.findByRole('button', { name: 'Retry failed saves' });

    expect(a1).toHaveTextContent('Local value');
    await user.click(retryButton);
    expect(updateCellContent).toHaveBeenNthCalledWith(2, 'sheet-inputs', 'A1', 'Local value', { revision: 0 });
    expect(a1).toHaveTextContent('Local value');

    retrySave.resolve({ sheetId: 'sheet-inputs', revision: 1 });
    await waitFor(() => expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saved'));
    expect(updateCellContent).toHaveBeenCalledTimes(2);
    expect(a1).toHaveTextContent('Local value');
  });

  it('disables retained-save retry for a non-replayable creation-only failure', async () => {
    const user = userEvent.setup();
    const apiClient = autosaveClient({ createSheet: vi.fn().mockRejectedValue(new Error('create failed')) });
    render(<App initialWorkbook={workbookWithSheets([])} apiClient={apiClient} />);

    await user.click(screen.getByRole('button', { name: /new sheet/i }));
    await user.type(screen.getByLabelText(/sheet name/i), 'Inputs');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByRole('button', { name: 'Retry failed saves' })).toBeDisabled();
  });
});
