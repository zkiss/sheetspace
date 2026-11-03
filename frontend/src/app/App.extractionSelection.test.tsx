import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { deferred, persistedWorkbookClient } from '@test-support/apiClients';
import { measuredElementGeometry } from '@test-support/domGeometry';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import * as workbookController from '@application/react/useWorkbookController';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['palette', 'menu'] as const)('transfers the whole reversed rectangle through the %s action', async (surfaceName) => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const workbook = workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs' })]);
  render(<App initialWorkbook={workbook} apiClient={persistedWorkbookClient(workbook)} />);
  const surface = screen.getByTestId('workspace-surface');
  measuredElementGeometry(surface, { width: 800, height: 600 });
  const source = screen.getByRole('article', { name: 'Sheet Inputs' });
  fireEvent.click(within(source).getByRole('cell', { name: 'Inputs B2 empty cell' }));
  fireEvent.click(within(source).getByRole('cell', { name: 'Inputs A1 empty cell' }), { shiftKey: true });
  if (surfaceName === 'palette') {
    fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
  } else {
    fireEvent.contextMenu(source);
  }
  const action = screen.getByRole(surfaceName === 'menu' ? 'menuitem' : 'button', { name: /Extract to new sheet/ });
  surface.style.visibility = 'hidden';
  fireEvent.click(action);
  let target!: HTMLElement;
  await waitFor(() => { target = surface.querySelector<HTMLElement>('article[aria-label="Sheet Sheet 1"]')!; expect(target).toBeTruthy(); });
  surface.style.visibility = '';
  await waitFor(() => {
    for (const address of ['A1', 'A2', 'B1', 'B2']) expect(within(target).getByRole('cell', { name: `Sheet 1 ${address} empty cell` })).toHaveAttribute('aria-selected', 'true');
  });
  await waitFor(() => expect(within(target).getByRole('cell', { name: 'Sheet 1 A1 empty cell' })).toHaveFocus());
});

it('disables extraction in another sheet menu instead of extracting the selected sheet', () => {
  const workbook = workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs' }), smallSheetDocument({ id: 'other', name: 'Other' })]);
  render(<App initialWorkbook={workbook} />);
  fireEvent.click(screen.getByRole('cell', { name: 'Inputs A1 empty cell' }));
  fireEvent.contextMenu(screen.getByRole('article', { name: 'Sheet Other' }));
  expect(screen.getByRole('menuitem', { name: 'Extract to new sheet' })).toBeDisabled();
});

it.each([['row', ['A1', 'B1']], ['column', ['A1', 'A2']]] as const)('transfers the entire extracted %s selection after source axes are removed', async (axis, addresses) => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const workbook = workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs' })]);
  render(<App initialWorkbook={workbook} apiClient={persistedWorkbookClient(workbook)} />);
  const surface = screen.getByTestId('workspace-surface');
  measuredElementGeometry(surface, { width: 800, height: 600 });
  fireEvent.click(screen.getByRole('cell', { name: 'Inputs B2 empty cell' }));
  fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
  fireEvent.click(screen.getByRole('button', { name: `Select ${axis}` }));
  fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
  const action = screen.getByRole('button', { name: /Extract to new sheet/ });
  surface.style.visibility = 'hidden';
  fireEvent.click(action);
  let target!: HTMLElement;
  await waitFor(() => { target = surface.querySelector<HTMLElement>('article[aria-label="Sheet Sheet 1"]')!; expect(target).toBeTruthy(); });
  surface.style.visibility = '';
  await waitFor(() => {
    for (const address of addresses) expect(within(target).getByRole('cell', { name: `Sheet 1 ${address} empty cell` })).toHaveAttribute('aria-selected', 'true');
  });
});

it.each(['selection', 'focus'] as const)('does not reclaim %s after user ownership changes while persistence is pending', async (change) => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const gate = deferred<void>();
  const useController = workbookController.useWorkbookController;
  vi.spyOn(workbookController, 'useWorkbookController').mockImplementation((options) => {
    const controller = useController(options);
    return { ...controller, commands: { ...controller.commands, extractSelection: (request) => {
      const submission = controller.commands.extractSelection(request);
      return { ...submission, completion: submission.completion.then(async (result) => { await gate.promise; return result; }) };
    } } };
  });
  const workbook = workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs' }), smallSheetDocument({ id: 'other', name: 'Other' })]);
  render(<App initialWorkbook={workbook} apiClient={persistedWorkbookClient(workbook)} />);
  const surface = screen.getByTestId('workspace-surface');
  measuredElementGeometry(surface, { width: 800, height: 600 });
  const source = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
  fireEvent.click(source);
  fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
  const action = screen.getByRole('button', { name: /Extract to new sheet/ });
  surface.style.visibility = 'hidden';
  fireEvent.click(action);
  await waitFor(() => expect(surface.querySelector('article[aria-label="Sheet Sheet 1"]')).toBeTruthy());
  surface.style.visibility = '';
  if (change === 'selection') {
    fireEvent.click(screen.getByRole('cell', { name: 'Other A1 empty cell' }));
    fireEvent.click(source);
  } else {
    screen.getByRole('button', { name: 'Data models' }).focus();
  }
  await act(async () => { gate.resolve(); await gate.promise; });
  expect(source).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('cell', { name: 'Sheet 1 A1 empty cell' })).not.toHaveAttribute('aria-selected', 'true');
  if (change === 'focus') expect(screen.getByRole('button', { name: 'Data models' })).toHaveFocus();
});
