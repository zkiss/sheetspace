import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { deferred, persistedWorkbookClient } from '@test-support/apiClients';
import { WorkbookApiError } from '@infrastructure/persistence/workbookApi';
import { measuredElementGeometry, testRect } from '@test-support/domGeometry';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import * as workbookController from '@application/react/useWorkbookController';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('places both ends of a selected rectangle at the captured maximised body scale', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const workbook = workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs', visualScale: 0.8 })]);
  render(<App initialWorkbook={workbook} apiClient={persistedWorkbookClient(workbook)} />);
  const surface = screen.getByTestId('workspace-surface');
  measuredElementGeometry(surface, { width: 800, height: 600 });
  const source = screen.getByRole('article', { name: 'Sheet Inputs' });
  fireEvent.click(within(source).getByRole('cell', { name: 'Inputs A1 empty cell' }));
  fireEvent.click(within(source).getByRole('cell', { name: 'Inputs B2 empty cell' }), { shiftKey: true });
  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  const sourceBody = source.querySelector<HTMLElement>('.sheet-frame-body')!;
  sourceBody.getBoundingClientRect = () => testRect({ left: 100, top: 80, width: 400, height: 300 });
  const sourceScale = Number(sourceBody.style.transform.match(/scale\(([^)]+)\)/)![1]);
  fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
  fireEvent.click(screen.getByRole('button', { name: /Extract to new sheet/ }));
  const target = await screen.findByRole('article', { name: 'Sheet Sheet 1' });
  const targetBody = target.querySelector<HTMLElement>('.sheet-frame-body')!;
  const targetScale = Number(targetBody.style.transform.match(/scale\(([^)]+)\)/)![1]);
  expect(targetScale).toBeCloseTo(sourceScale);
  const left = parseFloat(target.style.left) + parseFloat(targetBody.style.left);
  const top = parseFloat(target.style.top) + parseFloat(targetBody.style.top);
  for (const key of ['A1', 'B2']) {
    const original = source.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;
    const moved = target.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;
    const originalRow = original.parentElement!;
    const movedRow = moved.parentElement!;
    expect(left + parseFloat(moved.style.left) * targetScale).toBeCloseTo(100 + parseFloat(original.style.left) * sourceScale);
    expect(top + parseFloat(movedRow.style.top) * targetScale).toBeCloseTo(80 + parseFloat(originalRow.style.top) * sourceScale);
    expect(parseFloat(moved.style.width) * targetScale).toBeCloseTo(parseFloat(original.style.width) * sourceScale);
    expect(parseFloat(moved.style.height) * targetScale).toBeCloseTo(parseFloat(original.style.height) * sourceScale);
  }
});

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

it.each(['complete', 'frame-change', 'undo-restore', 'undo-settle', 'takeover', 'reject-restore', 'reject-settle'] as const)('handles %s during animated extraction transport', async (scenario) => {
  const useController = workbookController.useWorkbookController;
  let controller: ReturnType<typeof useController> | undefined;
  vi.spyOn(workbookController, 'useWorkbookController').mockImplementation((options) => {
    controller = useController(options);
    return controller;
  });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  const workbook = workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs', visualScale: 0.8, position: { x: 48, y: 96 }, frameSize: { width: 310, height: 220 } })]);
  const api = persistedWorkbookClient(workbook);
  const completion = deferred<typeof workbook>();
  if (scenario.startsWith('reject')) api.saveModelLifecycle.mockReturnValue(completion.promise);
  render(<App initialWorkbook={workbook} apiClient={api} />);
  const surface = screen.getByTestId('workspace-surface');
  measuredElementGeometry(surface, { width: 800, height: 600 });
  const source = screen.getByRole('article', { name: 'Sheet Inputs' });
  fireEvent.click(within(source).getByRole('cell', { name: 'Inputs A1 empty cell' }));
  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Restore to workspace' })).toBeEnabled());
  await new Promise((resolve) => setTimeout(resolve, 300));
  fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
  fireEvent.click(screen.getByRole('button', { name: /Extract to new sheet/ }));
  const target = await screen.findByRole('article', { name: 'Sheet Sheet 1' });
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
  await waitFor(() => expect(target).toHaveClass('sheet-frame-extraction-ready'));
  await waitFor(() => expect(target).not.toHaveClass('sheet-frame-extraction-handoff'));
  expect(source).toHaveAttribute('data-presented');
  expect(target).toHaveAttribute('data-presented');
  const heldPresentation = target.getAttribute('style');
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
  expect(source).toHaveAttribute('data-presented');
  expect(target).toHaveAttribute('style', heldPresentation);
  if (scenario === 'undo-restore' || scenario === 'takeover' || scenario === 'reject-restore') {
    if (scenario === 'undo-restore') {
      act(() => { controller!.commands.undo(); });
      await waitFor(() => expect(target).not.toBeInTheDocument());
    } else if (scenario === 'takeover') {
      fireEvent.click(screen.getByRole('button', { name: 'Restore to workspace' }));
      await waitFor(() => expect(target).not.toHaveAttribute('data-presented'));
    } else {
      await act(async () => { completion.reject(new WorkbookApiError('conflict', 409, 'model-lifecycle-conflict')); });
      await waitFor(() => expect(target).not.toBeInTheDocument());
    }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
    if (scenario !== 'takeover') expect(target).not.toBeInTheDocument();
    else expect(target).not.toHaveAttribute('data-presented');
    return;
  }
  await waitFor(() => expect(source).not.toHaveAttribute('data-presented'));
  expect(surface.dataset.viewportScale).toBe('1.25');
  expect(target).toHaveAttribute('data-presented');
  const startOfSettle = target.getAttribute('style');
  if (scenario === 'frame-change' || scenario === 'undo-settle' || scenario === 'reject-settle') {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
    if (scenario === 'reject-settle') {
      await act(async () => { completion.reject(new WorkbookApiError('conflict', 409, 'model-lifecycle-conflict')); });
      await waitFor(() => expect(target).not.toBeInTheDocument());
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
      expect(target).not.toBeInTheDocument();
      return;
    }
    if (scenario === 'undo-settle') {
      act(() => { controller!.commands.undo(); });
      await waitFor(() => expect(target).not.toBeInTheDocument());
      act(() => { controller!.commands.redo(); });
      const redone = await screen.findByRole('article', { name: 'Sheet Sheet 1' });
      expect(redone).not.toHaveAttribute('data-presented');
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
      expect(redone).not.toHaveAttribute('data-presented');
      return;
    }
    act(() => { controller!.commands.moveSheetFrame(target.dataset.sheetId!, { x: 410, y: 320 }); });
    expect(target).not.toHaveAttribute('data-presented');
    expect(target).toHaveAttribute('data-position-x', '410');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(target).not.toHaveAttribute('data-presented');
    expect(target).toHaveAttribute('data-position-x', '410');
    return;
  }
  await waitFor(() => expect(target.getAttribute('style')).not.toBe(startOfSettle));
  await waitFor(() => expect(target).not.toHaveAttribute('data-presented'));
});
