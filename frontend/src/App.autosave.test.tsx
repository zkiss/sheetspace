import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { autosaveClient, deferred } from './test/apiClients';
import { openCellEditor } from './test/appScreen';
import { positionedSheet, workbookWithSheets } from './test/workbookFactories';
import type { Workbook } from './workbook';

describe('App autosave integration', () => {
  it('autosaves committed sheet creation and reports app-level save status', async () => {
    const savedWorkbook = workbookWithSheets([positionedSheet('sheet-1', 'Inputs', { x: 0, y: 0 })]);
    const createSave = deferred<Workbook>();
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
    expect(screen.queryByRole('article', { name: 'Sheet Inputs' })).not.toBeInTheDocument();

    createSave.resolve(savedWorkbook);

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

  it('keeps the workbook editable and shows failed unsaved state after autosave failure', async () => {
    const user = userEvent.setup();
    const failedSave = deferred<Workbook>();
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
});
