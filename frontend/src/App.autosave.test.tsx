import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { autosaveClient, deferred } from '@test/apiClients';
import { openCellEditor } from './test/appScreen';
import { positionedSheet, workbookWithSheets } from '@test/workbookFactories';
import type { SheetRevisionResponse } from '@infrastructure/persistence/workbookApi';

describe('App autosave integration', () => {
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

    expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Save failed - unsaved changes');
    expect(a1).toHaveTextContent('Local value');
    await user.click(retryButton);
    expect(updateCellContent).toHaveBeenNthCalledWith(2, 'sheet-inputs', 'A1', 'Local value', { revision: 0 });
    expect(a1).toHaveTextContent('Local value');

    retrySave.resolve({ sheetId: 'sheet-inputs', revision: 1 });
    await waitFor(() => expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saved'));
    expect(updateCellContent).toHaveBeenCalledTimes(2);
    expect(a1).toHaveTextContent('Local value');
  });

});
