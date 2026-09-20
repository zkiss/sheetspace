import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { createSheetFromToolbar, openCellEditor, resizeHandle, workspaceSurface } from '@test-support/appScreen';
import { workspaceRect } from '@test-support/domGeometry';
import { positionedSheet, sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import type { SheetDocument } from '@workbook/core/model';
import { persistedWorkbookClient } from '@test-support/apiClients';
import userEvent from '@testing-library/user-event';

describe('viewport-aware sheet creation', () => {
  it('retains the toolbar viewport scale through the dialog and replaces an equal pending frame without a scale save', async () => {
    const create = deferred<SheetDocument>();
    const updateSheetVisualScale = vi.fn();
    const apiClient = autosaveClient({
      createSheet: vi.fn().mockReturnValue(create.promise),
      updateSheetVisualScale,
    });
    render(<App apiClient={apiClient} initialWorkbook={workbookWithSheets([
      { ...positionedSheet('existing', 'Existing', { x: 0, y: 0 }), frame: { ...positionedSheet('existing', 'Existing', { x: 0, y: 0 }).frame, zIndex: 9 } },
    ])} />);
    workspaceSurface().getBoundingClientRect = workspaceRect;

    fireEvent.click(screen.getByRole('button', { name: 'Zoom workspace in' }));
    fireEvent.click(screen.getByRole('button', { name: /new sheet/i }));
    // The dialog owns the scale captured at the create intent, not the scale at submit time.
    fireEvent.click(screen.getByRole('button', { name: 'Zoom workspace in' }));
    fireEvent.change(screen.getByLabelText(/sheet name/i), { target: { value: 'Inputs' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    const expectedScale = 1 / 1.2;
    expect(apiClient.createSheet).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Inputs', visualScale: expectedScale, zIndex: 10,
    }));
    const pending = screen.getByTestId('creating-sheet-frame');
    expect(pending).toHaveStyle({ transform: `scale(${expectedScale})`, zIndex: '10' });

    await act(async () => {
      create.resolve(sheetDocument({
        id: 'inputs', name: 'Inputs', position: { x: 500, y: 400 }, visualScale: expectedScale, zIndex: 10,
      }));
      await create.promise;
    });

    const saved = await screen.findByRole('article', { name: 'Sheet Inputs' });
    expect(saved).toHaveAttribute('data-visual-scale', String(expectedScale));
    expect(saved).toHaveAttribute('data-z-index', '10');
    expect(updateSheetVisualScale).not.toHaveBeenCalled();
  });

  it('uses the context-menu zoom captured before the dialog and removes a rejected pending frame', async () => {
    const updateSheetVisualScale = vi.fn();
    const apiClient = autosaveClient({
      createSheet: vi.fn().mockRejectedValue(new Error('create failed')),
      updateSheetVisualScale,
    });
    render(<App apiClient={apiClient} initialWorkbook={workbookWithSheets([])} />);
    workspaceSurface().getBoundingClientRect = workspaceRect;

    fireEvent.click(screen.getByRole('button', { name: 'Zoom workspace out' }));
    fireEvent.contextMenu(workspaceSurface(), { clientX: 420, clientY: 330 });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom workspace in' }));
    fireEvent.change(screen.getByLabelText(/sheet name/i), { target: { value: 'Outputs' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(apiClient.createSheet).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Outputs', position: { x: 380, y: 280 }, visualScale: 1.2, zIndex: 1,
    }));
    await waitFor(() => expect(screen.queryByTestId('creating-sheet-frame')).not.toBeInTheDocument());
    expect(screen.queryByRole('article', { name: 'Sheet Outputs' })).not.toBeInTheDocument();
    expect(updateSheetVisualScale).not.toHaveBeenCalled();
  });

  it('keeps independently created scales while editing, arranging, navigating, and reloading a multiscale workbook', async () => {
    const user = userEvent.setup();
    const apiClient = persistedWorkbookClient();
    render(<App apiClient={apiClient} initialWorkbook={workbookWithSheets([])} />);
    workspaceSurface().getBoundingClientRect = workspaceRect;

    fireEvent.click(screen.getByRole('button', { name: 'Zoom workspace in' }));
    await createSheetFromToolbar('Inputs');
    await waitFor(() => expect(apiClient.createSheet).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Reset workspace viewport' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom workspace out' }));
    fireEvent.contextMenu(workspaceSurface(), { clientX: 620, clientY: 430 });
    fireEvent.change(screen.getByLabelText(/sheet name/i), { target: { value: 'Outputs' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(apiClient.createSheet).toHaveBeenCalledTimes(2));

    let inputs = await screen.findByRole('article', { name: 'Sheet Inputs' });
    const outputs = screen.getByRole('article', { name: 'Sheet Outputs' });
    expect(inputs).toHaveAttribute('data-visual-scale', String(1 / 1.2));
    expect(outputs).toHaveAttribute('data-visual-scale', '1.2');

    let editor = await openCellEditor(user, cellAt(inputs, 'B1'));
    await user.type(editor, '10');
    fireEvent.keyDown(editor, { key: 'Enter' });
    editor = await openCellEditor(user, cellAt(outputs, 'A1'));
    await user.type(editor, '=Inputs!B1');
    fireEvent.keyDown(editor, { key: 'Enter' });
    await waitFor(() => expect(cellAt(outputs, 'A1')).toHaveTextContent('10'));

    fireEvent.click(cellAt(inputs, 'A1'));
    const scaleInput = screen.getByRole('spinbutton', { name: 'Scale sheet Inputs percentage' });
    await user.clear(scaleInput);
    await user.type(scaleInput, '50');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(apiClient.updateSheetVisualScale).toHaveBeenCalled());
    inputs = screen.getByRole('article', { name: 'Sheet Inputs' });
    const header = inputs.querySelector<HTMLElement>('[data-testid="sheet-frame-header"]')!;
    fireEvent(header, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 120 }));
    fireEvent(header, new MouseEvent('pointermove', { bubbles: true, clientX: 160, clientY: 180 }));
    fireEvent(header, new MouseEvent('pointerup', { bubbles: true, clientX: 160, clientY: 180 }));
    const right = resizeHandle(inputs, 'right');
    fireEvent(right, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 360, clientY: 120 }));
    fireEvent(right, new MouseEvent('pointermove', { bubbles: true, clientX: 440, clientY: 120 }));
    fireEvent(right, new MouseEvent('pointerup', { bubbles: true, clientX: 440, clientY: 120 }));
    await waitFor(() => expect(apiClient.updateSheetFrameLayout).toHaveBeenCalled());

    fireEvent.click(cellAt(outputs, 'A1'));
    fireEvent.click(screen.getByRole('button', { name: 'Inputs!B1, reference' }), { ctrlKey: true });
    expect(cellAt(inputs, 'B1')).toHaveFocus();
    cleanupAndReload(apiClient);

    const reloadedInputs = await screen.findByRole('article', { name: 'Sheet Inputs' });
    const reloadedOutputs = screen.getByRole('article', { name: 'Sheet Outputs' });
    expect(reloadedInputs).toHaveAttribute('data-visual-scale', '0.5');
    expect(reloadedInputs).toHaveAttribute('data-frame-width', '432');
    expect(reloadedOutputs).toHaveAttribute('data-visual-scale', '1.2');
    expect(cellAt(reloadedInputs, 'B1')).toHaveTextContent('10');
    expect(cellAt(reloadedOutputs, 'A1')).toHaveTextContent('10');
  });
});

function cellAt(frame: HTMLElement, cellKey: string) {
  const cell = frame.querySelector<HTMLElement>(`[data-cell-key="${cellKey}"]`);
  if (!cell) throw new Error(`Missing cell ${cellKey}`);
  return cell;
}

function cleanupAndReload(apiClient: ReturnType<typeof persistedWorkbookClient>) {
  // Render through the startup boundary so this assertion exercises persisted, not local, frame state.
  cleanup();
  render(<App apiClient={apiClient} />);
}
