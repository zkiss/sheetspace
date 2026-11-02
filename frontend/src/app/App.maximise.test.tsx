import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { smallSheetDocument, sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { measuredElementGeometry } from '@test-support/domGeometry';
import userEvent from '@testing-library/user-event';
import { autosaveClient, deferred, persistedWorkbookClient } from '@test-support/apiClients';
import type { SheetDocument } from '@workbook/core/model';

afterEach(() => vi.unstubAllGlobals());

it('maximises the existing grid, isolates zoom and restores the unchanged frame', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const sheet = smallSheetDocument({ id: 'inputs', name: 'Inputs', position: { x: 48, y: 96 }, visualScale: 0.8, frameSize: { width: 310, height: 220 }, zIndex: 7 });
  render(<App initialWorkbook={workbookWithSheets([sheet])} />);
  const surface = screen.getByTestId('workspace-surface');
  measuredElementGeometry(surface, { width: 800, height: 600 });
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  const cell = within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' });
  fireEvent.click(cell);
  const grid = within(frame).getByTestId('sheet-grid');
  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  expect(frame).toHaveAttribute('data-presented', 'true');
  expect(within(frame).getByTestId('sheet-grid')).toBe(grid);
  expect(within(frame).getByTestId('sheet-frame-header')).toHaveStyle({ height: '0px' });
  const scale = surface.dataset.viewportScale;
  fireEvent.wheel(grid, { ctrlKey: true, deltaY: 100 });
  expect(surface.dataset.viewportScale).toBe(scale);
  expect(within(frame).getByTestId('sheet-frame-body').style.transform).not.toBe('scale(1)');
  fireEvent.click(screen.getByRole('button', { name: 'Restore to workspace' }));
  expect(frame).not.toHaveAttribute('data-presented');
  expect(within(frame).getByTestId('sheet-grid')).toBe(grid);
  expect(frame).toHaveAttribute('data-position-x', '48');
  expect(frame).toHaveAttribute('data-position-y', '96');
  expect(frame).toHaveAttribute('data-visual-scale', '0.8');
  expect(frame).toHaveAttribute('data-frame-width', '310');
  expect(frame).toHaveAttribute('data-frame-height', '220');
  expect(frame).toHaveAttribute('data-z-index', '7');
});

it.each(['toolbar', 'keyboard', 'palette'] as const)('restores the canvas before creating a sheet via %s while maximised', async (action) => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const user = userEvent.setup();
  const apiClient = persistedWorkbookClient();
  const inputs = smallSheetDocument({ id: 'inputs', name: 'Inputs', position: { x: 48, y: 96 }, visualScale: 0.8, frameSize: { width: 310, height: 220 }, zIndex: 7 });
  render(<App apiClient={apiClient} initialWorkbook={workbookWithSheets([inputs])} />);
  measuredElementGeometry(screen.getByTestId('workspace-surface'), { width: 800, height: 600 });
  const source = screen.getByRole('article', { name: 'Sheet Inputs' });
  await user.click(within(source).getByRole('cell', { name: 'Inputs A1 empty cell' }));
  await user.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  expect(source).toHaveAttribute('data-presented', 'true');

  if (action === 'toolbar') fireEvent.click(screen.getByRole('button', { name: 'New sheet' }));
  else if (action === 'keyboard') fireEvent.keyDown(document.body, { key: 'N', shiftKey: true });
  else {
    fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
    fireEvent.click(screen.getByRole('button', { name: /New sheet…/ }));
  }

  // Creation is a canvas action: the transient presentation ends before the dialog owns input.
  await waitFor(() => expect(source).not.toHaveAttribute('data-presented'));
  expect(screen.queryByRole('button', { name: 'Restore to workspace' })).not.toBeInTheDocument();

  await user.type(await screen.findByLabelText('Sheet name'), 'Budget');
  await user.click(screen.getByRole('button', { name: 'Create' }));

  const created = await screen.findByRole('article', { name: 'Sheet Budget' });
  expect(created).toHaveClass('sheet-frame-active');
  expect(source).not.toHaveClass('sheet-frame-active');
  expect(within(created).getByRole('cell', { name: 'Budget A1 empty cell' })).toHaveAttribute('data-active-cell', 'true');
  expect(source).toHaveAttribute('data-position-x', '48');
  expect(source).toHaveAttribute('data-position-y', '96');
  expect(source).toHaveAttribute('data-visual-scale', '0.8');
  expect(source).toHaveAttribute('data-frame-width', '310');
  expect(source).toHaveAttribute('data-frame-height', '220');
  expect(source).toHaveAttribute('data-z-index', '7');
});

it('leaves the restored canvas in place when maximised creation is cancelled', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const apiClient = persistedWorkbookClient();
  render(<App apiClient={apiClient} initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs', position: { x: 48, y: 96 } })])} />);
  measuredElementGeometry(screen.getByTestId('workspace-surface'), { width: 800, height: 600 });
  const source = screen.getByRole('article', { name: 'Sheet Inputs' });
  fireEvent.click(within(source).getByRole('cell', { name: 'Inputs A1 empty cell' }));
  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  fireEvent.click(screen.getByRole('button', { name: 'New sheet' }));
  await screen.findByLabelText('Sheet name');

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  expect(screen.queryByLabelText('Sheet name')).not.toBeInTheDocument();
  expect(source).not.toHaveAttribute('data-presented');
  expect(source).toHaveClass('sheet-frame-active');
  expect(apiClient.createSheet).not.toHaveBeenCalled();
});

it('keeps the creation dialog open when validation fails on the restored canvas', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  render(<App initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs' })])} />);
  measuredElementGeometry(screen.getByTestId('workspace-surface'), { width: 800, height: 600 });
  const source = screen.getByRole('article', { name: 'Sheet Inputs' });
  fireEvent.click(within(source).getByRole('cell', { name: 'Inputs A1 empty cell' }));
  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  fireEvent.click(screen.getByRole('button', { name: 'New sheet' }));
  await screen.findByLabelText('Sheet name');

  fireEvent.click(screen.getByRole('button', { name: 'Create' }));

  expect(screen.getByRole('alert')).toHaveTextContent(/required/i);
  expect(screen.getByLabelText('Sheet name')).toBeInTheDocument();
  expect(source).not.toHaveAttribute('data-presented');
});

it('retains a created sheet without stealing selection when a presentation action supersedes it', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const create = deferred<SheetDocument>();
  const apiClient = autosaveClient({ createSheet: vi.fn().mockReturnValue(create.promise) });
  render(<App apiClient={apiClient} initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs' })])} />);
  measuredElementGeometry(screen.getByTestId('workspace-surface'), { width: 800, height: 600 });
  const source = screen.getByRole('article', { name: 'Sheet Inputs' });
  fireEvent.click(within(source).getByRole('cell', { name: 'Inputs A1 empty cell' }));
  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  fireEvent.click(screen.getByRole('button', { name: 'New sheet' }));
  await screen.findByLabelText('Sheet name');
  fireEvent.change(screen.getByLabelText('Sheet name'), { target: { value: 'Budget' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));

  // The newer presentation owns the visible editor while the request is in flight.
  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  expect(source).toHaveAttribute('data-presented', 'true');

  await act(async () => {
    create.resolve(sheetDocument({ id: 'budget', name: 'Budget', position: { x: 200, y: 100 }, zIndex: 8 }));
    await create.promise;
  });

  fireEvent.click(screen.getByRole('button', { name: 'Restore to workspace' }));
  const created = await screen.findByRole('article', { name: 'Sheet Budget' });
  expect(created).not.toHaveClass('sheet-frame-active');
  expect(source).toHaveClass('sheet-frame-active');
});

it('retains selection and supports keyboard editing and scrolling through a round trip', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const user = userEvent.setup();
  render(<App initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs', rowCount: 40 })])} />);
  measuredElementGeometry(screen.getByTestId('workspace-surface'), { width: 800, height: 600 });
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  const cell = within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' });
  await user.click(cell);
  await user.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  expect(cell).toHaveAttribute('data-active-cell', 'true');
  await user.click(cell);
  await user.keyboard('hello');
  const editor = screen.getByRole('textbox', { name: 'Inputs A1 editor' });
  expect(editor).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(cell).toHaveTextContent('hello');
  const body = within(frame).getByTestId('sheet-frame-body');
  body.scrollTop = 80;
  fireEvent.scroll(body);
  expect(body.scrollTop).toBe(80);
  await user.click(screen.getByRole('button', { name: 'Restore to workspace' }));
  expect(within(frame).getByTestId('sheet-frame-body')).toBe(body);
  expect(cell).toHaveTextContent('hello');
});

it('preserves a live cell draft when the sheet is maximised and restored', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const user = userEvent.setup();
  render(<App initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs' })])} />);
  measuredElementGeometry(screen.getByTestId('workspace-surface'), { width: 800, height: 600 });
  await user.click(screen.getByRole('cell', { name: 'Inputs A1 empty cell' }));
  await user.keyboard('draft');
  const editor = screen.getByRole('textbox', { name: 'Inputs A1 editor' });
  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  expect(screen.getByRole('textbox', { name: 'Inputs A1 editor' })).toBe(editor);
  expect(editor).toHaveValue('draft');
  fireEvent.click(screen.getByRole('button', { name: 'Restore to workspace' }));
  expect(screen.getByRole('textbox', { name: 'Inputs A1 editor' })).toBe(editor);
  expect(editor).toHaveValue('draft');
});

it('forces an overview sheet into a detailed editor without changing its saved visual scale', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const sheet = smallSheetDocument({ id: 'inputs', name: 'Inputs', visualScale: 0.3 });
  render(<App initialWorkbook={workbookWithSheets([sheet])} />);
  measuredElementGeometry(screen.getByTestId('workspace-surface'), { width: 800, height: 600 });
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  fireEvent.click(within(frame).getByRole('button', { name: 'Select sheet Inputs overview' }));
  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  expect(frame).toHaveAttribute('data-rendering-mode', 'detailed');
  expect(within(frame).getByTestId('sheet-grid')).toBeInTheDocument();
  expect(frame).toHaveAttribute('data-visual-scale', '0.3');
});

it('pins the maximised grid when the workspace becomes too small for ordinary culling', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  render(<App initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs' })])} />);
  const geometry = measuredElementGeometry(screen.getByTestId('workspace-surface'), { width: 800, height: 600 });
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  fireEvent.click(within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' }));
  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  const grid = within(frame).getByTestId('sheet-grid');
  act(() => { geometry.resize({ width: 0, height: 0 }); });
  expect(within(frame).getByTestId('sheet-grid')).toBe(grid);
  act(() => { geometry.resize({ width: 800, height: 600 }); });
  expect(within(frame).getByTestId('sheet-grid')).toBe(grid);
});

it('recovers the workspace when the maximised sheet is deleted', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  render(<App apiClient={autosaveClient()} initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs' })])} />);
  measuredElementGeometry(screen.getByTestId('workspace-surface'), { width: 800, height: 600 });
  fireEvent.click(screen.getByRole('cell', { name: 'Inputs A1 empty cell' }));
  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
  fireEvent.click(screen.getByRole('button', { name: /Delete sheet/ }));
  await waitFor(() => expect(screen.queryByRole('article', { name: 'Sheet Inputs' })).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'Restore to workspace' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'New sheet' })).toBeEnabled();
});

it('routes palette zoom to the maximised grid without moving the workspace', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const sheet = smallSheetDocument({ id: 'inputs', name: 'Inputs' });
  render(<App initialWorkbook={workbookWithSheets([sheet])} />);
  const surface = screen.getByTestId('workspace-surface');
  measuredElementGeometry(surface, { width: 800, height: 600 });
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  fireEvent.click(within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' }));
  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
  fireEvent.click(screen.getByRole('button', { name: /Zoom in/ }));
  expect(within(frame).getByTestId('sheet-frame-body').style.transform).toBe('scale(1.2)');
  expect(surface).toHaveAttribute('data-viewport-scale', '1');
});
