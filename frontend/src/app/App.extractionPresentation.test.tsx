import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { persistedWorkbookClient } from '@test-support/apiClients';
import { measuredElementGeometry, testRect } from '@test-support/domGeometry';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

afterEach(() => vi.unstubAllGlobals());

it.each([false, true])('presents the extracted target while its source is maximised: %s', async (maximised) => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const workbook = workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs', visualScale: 0.8 })]);
  render(<App initialWorkbook={workbook} apiClient={persistedWorkbookClient(workbook)} />);
  const surface = screen.getByTestId('workspace-surface');
  measuredElementGeometry(surface, { width: 800, height: 600 });
  const source = screen.getByRole('article', { name: 'Sheet Inputs' });
  fireEvent.click(within(source).getByRole('cell', { name: 'Inputs A1 empty cell' }));
  if (maximised) fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
  fireEvent.click(screen.getByRole('button', { name: /Extract to new sheet/ }));
  const target = await screen.findByRole('article', { name: 'Sheet Sheet 1' });
  expect(target).toHaveAttribute('data-presented', 'true');
  expect(target).toHaveClass('sheet-frame-extraction-handoff');
  if (maximised) expect(source).toHaveAttribute('data-presented', 'true');
  await waitFor(() => expect(target).toBeInTheDocument());
});

it('restores the actual canvas and removes target presentation after a nonvisual maximised extraction', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const workbook = workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs', visualScale: 0.8, position: { x: 48, y: 96 }, frameSize: { width: 310, height: 220 } })]);
  render(<App initialWorkbook={workbook} apiClient={persistedWorkbookClient(workbook)} />);
  const surface = screen.getByTestId('workspace-surface');
  measuredElementGeometry(surface, { width: 800, height: 600 });
  const source = screen.getByRole('article', { name: 'Sheet Inputs' });
  fireEvent.click(within(source).getByRole('cell', { name: 'Inputs A1 empty cell' }));
  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
  surface.style.visibility = 'hidden';
  fireEvent.click(screen.getByRole('button', { name: /Extract to new sheet/ }));
  await waitFor(() => expect(source).not.toHaveAttribute('data-presented'));
  await waitFor(() => expect(surface.querySelector('[data-sheet-id]:not([data-sheet-id="inputs"])')).not.toHaveAttribute('data-presented'));
  expect(surface.dataset.viewportScale).toBe('1.25');
});

it('releases a waiting target presentation when the user restores the source', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const workbook = workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs' })]);
  render(<App initialWorkbook={workbook} apiClient={persistedWorkbookClient(workbook)} />);
  measuredElementGeometry(screen.getByTestId('workspace-surface'), { width: 800, height: 600 });
  const source = screen.getByRole('article', { name: 'Sheet Inputs' });
  fireEvent.click(within(source).getByRole('cell', { name: 'Inputs A1 empty cell' }));
  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
  fireEvent.click(screen.getByRole('button', { name: /Extract to new sheet/ }));
  const target = await screen.findByRole('article', { name: 'Sheet Sheet 1' });
  expect(target).toHaveAttribute('data-presented');
  fireEvent.click(screen.getByRole('button', { name: 'Restore to workspace' }));
  await waitFor(() => expect(target).not.toHaveAttribute('data-presented'));
  expect(source).not.toHaveAttribute('data-presented');
});

it('hands painted target cells through the real maximised restore to ordinary canvas presentation', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const workbook = workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs', visualScale: 0.8, position: { x: 48, y: 96 }, frameSize: { width: 310, height: 220 } })]);
  render(<App initialWorkbook={workbook} apiClient={persistedWorkbookClient(workbook)} />);
  const surface = screen.getByTestId('workspace-surface');
  measuredElementGeometry(surface, { width: 800, height: 600 });
  const source = screen.getByRole('article', { name: 'Sheet Inputs' });
  fireEvent.click(within(source).getByRole('cell', { name: 'Inputs A1 empty cell' }));
  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
  fireEvent.click(screen.getByRole('button', { name: /Extract to new sheet/ }));
  const target = await screen.findByRole('article', { name: 'Sheet Sheet 1' });
  expect(target).toHaveAttribute('data-presented');
  for (const frame of [source, target]) {
    const body = frame.querySelector<HTMLElement>('.sheet-frame-body')!;
    const corner = frame.querySelector<HTMLElement>('.sheet-grid-corner')!;
    const cell = frame.querySelector<HTMLElement>('[data-cell-key="A1"]')!;
    Object.defineProperties(body, { offsetWidth: { configurable: true, value: 400 }, clientWidth: { configurable: true, value: 400 }, clientHeight: { configurable: true, value: 300 } });
    body.getBoundingClientRect = () => testRect({ left: 10, top: 10, width: 400, height: 300 });
    corner.getBoundingClientRect = () => testRect({ left: 10, top: 10, width: 40, height: 24 });
    cell.getBoundingClientRect = () => testRect({ left: 50, top: 34, width: 120, height: 24 });
  }
  fireEvent.scroll(source.querySelector('.sheet-frame-body')!);
  await waitFor(() => expect(source).not.toHaveAttribute('data-presented'));
  await waitFor(() => expect(target).not.toHaveAttribute('data-presented'));
  expect(surface.dataset.viewportScale).toBe('1.25');
  expect(target).not.toHaveClass('sheet-frame-extraction-handoff');
});
