import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { deferred, persistedWorkbookClient } from '@test-support/apiClients';
import { WorkbookApiError } from '@infrastructure/persistence/workbookApi';
import { measuredElementGeometry, testRect } from '@test-support/domGeometry';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import * as workbookController from '@application/react/useWorkbookController';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each([[false, 'move'], [true, 'move'], [true, 'resize'], [true, 'scale']] as const)('yields to same-batch edits (maximised: %s, edit: %s)', async (maximised, edit) => {
  const useController = workbookController.useWorkbookController;
  let edited = false;
  let latest: ReturnType<typeof useController> | undefined;
  let targetId = '';
  vi.spyOn(workbookController, 'useWorkbookController').mockImplementation((options) => {
    const controller = useController(options);
    latest = controller;
    return { ...controller, commands: { ...controller.commands, extractSelection: (request) => {
      const submission = controller.commands.extractSelection(request);
      expect(screen.queryByRole('article', { name: 'Sheet Sheet 1', hidden: true })).toBeNull();
      if (submission.result.ok) {
        targetId = request.targetSheetId;
        const result = edit === 'move'
          ? controller.commands.moveSheetFrame(request.targetSheetId, { x: 410, y: 320 })
          : edit === 'resize'
            ? controller.commands.resizeSheetFrame(request.targetSheetId, { x: 410, y: 320 }, { width: 350, height: 260 })
            : controller.commands.setSheetVisualScale(request.targetSheetId, 1.4);
        expect(result.ok).toBe(true);
        edited = true;
      }
      return submission;
    } } };
  });
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const workbook = workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs', visualScale: 0.8 })]);
  render(<App initialWorkbook={workbook} />);
  measuredElementGeometry(screen.getByTestId('workspace-surface'), { width: 800, height: 600 });
  const source = screen.getByRole('article', { name: 'Sheet Inputs' });
  fireEvent.click(within(source).getByRole('cell', { name: 'Inputs A1 empty cell' }));
  if (maximised) fireEvent.click(document.querySelector<HTMLButtonElement>('.sheet-frame-active .sheet-frame-maximise')!, { detail: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
  fireEvent.click(screen.getByRole('button', { name: /Extract to new sheet/ }));
  const target = await screen.findByRole('article', { name: 'Sheet Sheet 1', hidden: true });
  expect(edited).toBe(true);
  expect(target).not.toHaveAttribute('data-presented');
  expect(target).not.toHaveClass('sheet-frame-extraction-handoff');
  if (edit !== 'scale') expect(target).toHaveAttribute('data-position-x', '410');
  if (edit === 'scale') expect(latest!.workbook.documents[targetId].frame.visualScale).toBe(1.4);
  if (edit === 'resize') expect(latest!.workbook.documents[targetId].frame.size).toEqual({ width: 350, height: 260 });
  if (maximised) expect(source).toHaveAttribute('data-presented');
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
  expect(target).not.toHaveAttribute('data-presented');
  if (edit !== 'scale') expect(target).toHaveAttribute('data-position-x', '410');
  if (edit === 'scale') expect(latest!.workbook.documents[targetId].frame.visualScale).toBe(1.4);
  if (maximised) expect(source).toHaveAttribute('data-presented');
});

it('places both ends of a selected rectangle at the captured maximised body scale', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const workbook = workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs', visualScale: 0.8 })]);
  render(<App initialWorkbook={workbook} apiClient={persistedWorkbookClient(workbook)} />);
  const surface = screen.getByTestId('workspace-surface');
  measuredElementGeometry(surface, { width: 800, height: 600 });
  const source = screen.getByRole('article', { name: 'Sheet Inputs' });
  fireEvent.click(within(source).getByRole('cell', { name: 'Inputs A1 empty cell' }));
  fireEvent.click(within(source).getByRole('cell', { name: 'Inputs B2 empty cell' }), { shiftKey: true });
  fireEvent.click(document.querySelector<HTMLButtonElement>('.sheet-frame-active .sheet-frame-maximise')!, { detail: 1 });
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
  if (maximised) fireEvent.click(document.querySelector<HTMLButtonElement>('.sheet-frame-active .sheet-frame-maximise')!, { detail: 1 });
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
  fireEvent.click(document.querySelector<HTMLButtonElement>('.sheet-frame-active .sheet-frame-maximise')!, { detail: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
  surface.style.visibility = 'hidden';
  fireEvent.click(screen.getByRole('button', { name: /Extract to new sheet/ }));
  await waitFor(() => expect(source).not.toHaveAttribute('data-presented'));
  await waitFor(() => expect(surface.querySelector('[data-sheet-id]:not([data-sheet-id="inputs"])')).not.toHaveAttribute('data-presented'));
  expect(surface.dataset.viewportScale).toBe('1.25');
});

it('accepts the published inherited scale and post-stacking z-index without a foreign edit', async () => {
  const useController = workbookController.useWorkbookController;
  let requestedZ: number | undefined;
  let publishedFrame: ReturnType<typeof useController>['workbook']['documents'][string]['frame'] | undefined;
  vi.spyOn(workbookController, 'useWorkbookController').mockImplementation((options) => {
    const controller = useController(options);
    return { ...controller, commands: { ...controller.commands, extractSelection: (request) => {
      const alteredRequest = { ...request, frame: { ...request.frame, zIndex: request.frame.zIndex + 5 } };
      const submission = controller.commands.extractSelection(alteredRequest);
      requestedZ = alteredRequest.frame.zIndex;
      expect(submission.result).toMatchObject({ ok: true });
      if (submission.result.ok) publishedFrame = submission.result.workbook.documents[request.targetSheetId].frame;
      return submission;
    } } };
  });
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const workbook = workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs', visualScale: 0.8 })]);
  render(<App initialWorkbook={workbook} />);
  const surface = screen.getByTestId('workspace-surface');
  measuredElementGeometry(surface, { width: 800, height: 600 });
  const source = screen.getByRole('article', { name: 'Sheet Inputs' });
  fireEvent.click(within(source).getByRole('cell', { name: 'Inputs A1 empty cell' }));
  fireEvent.click(document.querySelector<HTMLButtonElement>('.sheet-frame-active .sheet-frame-maximise')!, { detail: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
  surface.style.visibility = 'hidden';
  fireEvent.click(screen.getByRole('button', { name: /Extract to new sheet/ }));
  expect(publishedFrame!.visualScale).toBe(0.8);
  expect(publishedFrame!.zIndex).not.toBe(requestedZ);
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
  fireEvent.click(document.querySelector<HTMLButtonElement>('.sheet-frame-active .sheet-frame-maximise')!, { detail: 1 });
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
  fireEvent.click(document.querySelector<HTMLButtonElement>('.sheet-frame-active .sheet-frame-maximise')!, { detail: 1 });
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

it.each(['complete', 'frame-waiting', 'frame-fade', 'frame-restore', 'frame-change', 'undo-restore', 'undo-settle', 'takeover', 'reject-restore', 'reject-settle'] as const)('handles %s during animated extraction transport', async (scenario) => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let now = 1_000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  const tick = async (ms: number) => {
    now += ms;
    const callbacks = [...frames.values()];
    frames.clear();
    await act(async () => { vi.advanceTimersByTime(ms); for (const callback of callbacks) callback(now); });
  };
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
  fireEvent.click(document.querySelector<HTMLButtonElement>('.sheet-frame-active .sheet-frame-maximise')!, { detail: 1 });
  expect(screen.getByRole('button', { name: 'Restore to workspace' })).toBeEnabled();
  await tick(400);
  fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
  fireEvent.click(screen.getByRole('button', { name: /Extract to new sheet/ }));
  const target = screen.getByRole('article', { name: 'Sheet Sheet 1' });
  await act(async () => {});
  if (scenario === 'frame-waiting') {
    expect(target).toHaveAttribute('data-presented');
    act(() => { controller!.commands.moveSheetFrame(target.dataset.sheetId!, { x: 410, y: 320 }); });
    expect(target).not.toHaveAttribute('data-presented');
    expect(target).toHaveAttribute('data-position-x', '410');
    expect(source).toHaveAttribute('data-presented');
    await tick(350);
    expect(target).not.toHaveAttribute('data-presented');
    expect(source).toHaveAttribute('data-presented');
    return;
  }
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
  await act(async () => {});
  expect(target).toHaveClass('sheet-frame-extraction-ready');
  if (scenario === 'frame-fade') {
    expect(target).toHaveClass('sheet-frame-extraction-handoff');
    act(() => { controller!.commands.moveSheetFrame(target.dataset.sheetId!, { x: 410, y: 320 }); });
    expect(target).not.toHaveAttribute('data-presented');
    await tick(350);
    expect(target).not.toHaveAttribute('data-presented');
    expect(target).toHaveAttribute('data-position-x', '410');
    expect(source).toHaveAttribute('data-presented');
    return;
  }
  await tick(250);
  expect(target).not.toHaveClass('sheet-frame-extraction-handoff');
  expect(source).toHaveAttribute('data-presented');
  expect(target).toHaveAttribute('data-presented');
  const heldPresentation = target.getAttribute('style');
  await tick(60);
  expect(source).toHaveAttribute('data-presented');
  expect(target).toHaveAttribute('style', heldPresentation);
  if (scenario === 'frame-restore') {
    act(() => { controller!.commands.moveSheetFrame(target.dataset.sheetId!, { x: 410, y: 320 }); });
    expect(target).not.toHaveAttribute('data-presented');
    expect(target).toHaveAttribute('data-position-x', '410');
    await tick(350);
    expect(target).not.toHaveAttribute('data-presented');
    expect(target).toHaveAttribute('data-position-x', '410');
    return;
  }
  if (scenario === 'undo-restore' || scenario === 'takeover' || scenario === 'reject-restore') {
    if (scenario === 'undo-restore') {
      act(() => { controller!.commands.undo(); });
      await act(async () => {});
      expect(target).not.toBeInTheDocument();
    } else if (scenario === 'takeover') {
      fireEvent.click(screen.getByRole('button', { name: 'Restore to workspace' }));
      await act(async () => {});
      expect(target).not.toHaveAttribute('data-presented');
    } else {
      await act(async () => { completion.reject(new WorkbookApiError('conflict', 409, 'model-lifecycle-conflict')); });
      await act(async () => {});
      expect(target).not.toBeInTheDocument();
    }
    await tick(350);
    if (scenario !== 'takeover') expect(target).not.toBeInTheDocument();
    else expect(target).not.toHaveAttribute('data-presented');
    return;
  }
  await tick(500);
  expect(source).not.toHaveAttribute('data-presented');
  expect(surface.dataset.viewportScale).toBe('1.25');
  expect(target).toHaveAttribute('data-presented');
  const startOfSettle = target.getAttribute('style');
  if (scenario === 'frame-change' || scenario === 'undo-settle' || scenario === 'reject-settle') {
    await tick(60);
    await tick(60);
    expect(target).toHaveAttribute('data-presented');
    if (scenario === 'reject-settle') {
      await act(async () => { completion.reject(new WorkbookApiError('conflict', 409, 'model-lifecycle-conflict')); });
      await act(async () => {});
      expect(target).not.toBeInTheDocument();
      await tick(300);
      expect(target).not.toBeInTheDocument();
      return;
    }
    if (scenario === 'undo-settle') {
      act(() => { controller!.commands.undo(); });
      await act(async () => {});
      expect(target).not.toBeInTheDocument();
      act(() => { controller!.commands.redo(); });
      const redone = screen.getByRole('article', { name: 'Sheet Sheet 1' });
      expect(redone).not.toHaveAttribute('data-presented');
      await tick(300);
      expect(redone).not.toHaveAttribute('data-presented');
      return;
    }
    act(() => { controller!.commands.moveSheetFrame(target.dataset.sheetId!, { x: 410, y: 320 }); });
    expect(target).not.toHaveAttribute('data-presented');
    expect(target).toHaveAttribute('data-position-x', '410');
    await tick(300);
    expect(target).not.toHaveAttribute('data-presented');
    expect(target).toHaveAttribute('data-position-x', '410');
    return;
  }
  await tick(120);
  await tick(120);
  await tick(120);
  expect(target.getAttribute('style')).not.toBe(startOfSettle);
  await tick(200);
  expect(target).not.toHaveAttribute('data-presented');
});
