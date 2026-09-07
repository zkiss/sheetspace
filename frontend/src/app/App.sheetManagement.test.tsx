import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { persistedWorkbookClient } from '@test-support/apiClients';
import { openSheetContextMenu, workspaceSurface } from '@test-support/appScreen';
import { workspaceRect } from '@test-support/domGeometry';
import { positionedSheet, workbookWithSheets } from '@test-support/workbookFactories';

describe('App sheet management integration', () => {
  it('wires the workspace context menu create dialog to a sheet at the clicked coordinate', async () => {
    const user = userEvent.setup();
    render(<App initialWorkbook={workbookWithSheets([])} apiClient={persistedWorkbookClient()} />);

    workspaceSurface().getBoundingClientRect = workspaceRect;
    await user.click(screen.getByRole('button', { name: 'Zoom workspace in' }));
    fireEvent.contextMenu(workspaceSurface(), { clientX: 240, clientY: 330 });
    expect(screen.getByRole('form', { name: /create sheet/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/sheet name/i), 'Assumptions');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    const frame = screen.getByTestId('sheet-frame');
    expect(within(frame).getByRole('heading', { name: 'Assumptions' })).toBeInTheDocument();
    expect(frame).toHaveStyle({ left: '183px', top: '250px' });
  });

  it('wires the rename dialog to the selected workbook sheet', async () => {
    const user = userEvent.setup();
    const sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 });
    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    await user.click(within(openSheetContextMenu(frame)).getByRole('menuitem', { name: 'Rename' }));
    await user.clear(screen.getByLabelText(/sheet name/i));
    await user.type(screen.getByLabelText(/sheet name/i), 'Renamed Inputs');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(screen.getByRole('article', { name: 'Sheet Renamed Inputs' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Sheet Inputs' })).not.toBeInTheDocument();
  });

  it('wires context-menu deletion through persistence and reload', async () => {
    const user = userEvent.setup();
    const inputs = positionedSheet('sheet-inputs', 'Inputs', { x: 48, y: 96 });
    const outputs = positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 260 });
    const apiClient = persistedWorkbookClient(workbookWithSheets([inputs, outputs]));
    const { unmount } = render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} apiClient={apiClient} />);

    await user.click(within(openSheetContextMenu(screen.getByRole('article', { name: 'Sheet Inputs' }))).getByRole('menuitem', { name: 'Delete' }));
    expect(screen.queryByRole('article', { name: 'Sheet Inputs' })).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Sheet Outputs' })).toBeInTheDocument();

    unmount();
    render(<App apiClient={apiClient} />);
    expect(await screen.findByRole('article', { name: 'Sheet Outputs' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Sheet Inputs' })).not.toBeInTheDocument();
  });
});
