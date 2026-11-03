import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { persistedWorkbookClient } from '@test-support/apiClients';
import { measuredElementGeometry, testRect } from '@test-support/domGeometry';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import * as workbookController from '@application/react/useWorkbookController';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function useExtractionClock() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let now = 1_000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const pending = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { pending.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { pending.delete(id); });
  return {
    now: () => now,
    pendingFrames: () => [...pending.values()],
    runFrames(time: number) {
      const callbacks = [...pending.entries()];
      pending.clear();
      now = time;
      act(() => { for (const [, callback] of callbacks) callback(time); });
    },
    advanceTimers(ms: number) { act(() => { vi.advanceTimersByTime(ms); }); },
  };
}
type ExtractionClock = ReturnType<typeof useExtractionClock>;

type ExtractionState = {
  source: HTMLElement;
  target: HTMLElement;
  surface: HTMLElement;
  controller: ReturnType<typeof workbookController.useWorkbookController>;
};

function stubPaintedGeometry(...frames: HTMLElement[]) {
  for (const frame of frames) {
    const body = frame.querySelector<HTMLElement>('.sheet-frame-body')!;
    const corner = frame.querySelector<HTMLElement>('.sheet-grid-corner')!;
    const cell = frame.querySelector<HTMLElement>('[data-cell-key="A1"]')!;
    Object.defineProperties(body, { offsetWidth: { configurable: true, value: 400 }, clientWidth: { configurable: true, value: 400 }, clientHeight: { configurable: true, value: 300 } });
    body.getBoundingClientRect = () => testRect({ left: 10, top: 10, width: 400, height: 300 });
    corner.getBoundingClientRect = () => testRect({ left: 10, top: 10, width: 40, height: 24 });
    cell.getBoundingClientRect = () => testRect({ left: 50, top: 34, width: 120, height: 24 });
  }
}

async function reachExtractionRetire(clock: ExtractionClock, { maximised }: { maximised: boolean }): Promise<ExtractionState> {
  const realController = workbookController.useWorkbookController;
  let controller!: ExtractionState['controller'];
  vi.spyOn(workbookController, 'useWorkbookController').mockImplementation((options) => { controller = realController(options); return controller; });
  const workbook = workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs', visualScale: 0.8, position: { x: 48, y: 96 }, frameSize: { width: 310, height: 220 } })]);
  render(<App initialWorkbook={workbook} apiClient={persistedWorkbookClient(workbook)} />);
  const surface = screen.getByTestId('workspace-surface');
  measuredElementGeometry(surface, { width: 800, height: 600 });
  const source = screen.getByRole('article', { name: 'Sheet Inputs' });
  fireEvent.click(within(source).getByRole('cell', { name: 'Inputs A1 empty cell' }));
  if (maximised) {
    fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
    clock.runFrames(clock.now() + 400);
  }
  fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
  fireEvent.click(screen.getByRole('button', { name: /Extract to new sheet/ }));
  const target = screen.getByRole('article', { name: 'Sheet Sheet 1' });
  stubPaintedGeometry(source, target);
  fireEvent.scroll(source.querySelector('.sheet-frame-body')!);
  await act(async () => {});
  expect(target).toHaveClass('sheet-frame-extraction-ready');
  clock.advanceTimers(250);
  return { source, target, surface, controller };
}

async function finishOwnedRestore(clock: ExtractionClock, { maximised }: { maximised: boolean }) {
  if (!maximised) return;
  clock.runFrames(clock.now() + 400);
  await act(async () => {});
}

it.each([false, true])('releases the presentation when the target frame is edited immediately before the terminal settle tick (maximised: %s)', async (maximised) => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  const clock = useExtractionClock();
  const { source, target, surface, controller } = await reachExtractionRetire(clock, { maximised });
  await finishOwnedRestore(clock, { maximised });
  if (maximised) expect(surface.dataset.viewportScale).toBe('1.25');
  expect(target).toHaveAttribute('data-presented');

  clock.runFrames(clock.now() + 120);
  expect(target).toHaveAttribute('data-presented');
  clock.runFrames(clock.now() + 116);
  expect(target).toHaveAttribute('data-presented');

  act(() => { controller.commands.moveSheetFrame(target.dataset.sheetId!, { x: 410, y: 320 }); });
  expect(target).not.toHaveAttribute('data-presented');
  expect(target).not.toHaveClass('sheet-frame-extraction-handoff');
  expect(target).toHaveAttribute('data-position-x', '410');

  clock.runFrames(clock.now() + 100);
  clock.advanceTimers(500);
  await act(async () => {});
  expect(target).not.toHaveAttribute('data-presented');
  expect(target).toHaveAttribute('data-position-x', '410');
  expect(source).not.toHaveAttribute('data-presented');
});

it.each([false, true])('keeps a successor presentation when the aborted extraction\'s stale settle callbacks fire afterwards (maximised: %s)', async (maximised) => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  const clock = useExtractionClock();
  const { target, controller } = await reachExtractionRetire(clock, { maximised });
  await finishOwnedRestore(clock, { maximised });

  clock.runFrames(clock.now() + 120);
  expect(target).toHaveAttribute('data-presented');
  const staleTicks = clock.pendingFrames();
  expect(staleTicks.length).toBeGreaterThan(0);

  act(() => { controller.commands.moveSheetFrame(target.dataset.sheetId!, { x: 410, y: 320 }); });
  expect(target).not.toHaveAttribute('data-presented');

  fireEvent.click(within(target).getByRole('cell', { name: 'Sheet 1 A1 empty cell' }));
  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  clock.runFrames(clock.now() + 400);
  expect(target).toHaveAttribute('data-presented');
  const successorStyle = target.getAttribute('style');

  act(() => { for (const callback of staleTicks) callback(clock.now() + 10_000); });
  expect(target).toHaveAttribute('data-presented');
  expect(target.getAttribute('style')).toBe(successorStyle);
  expect(target).toHaveAttribute('data-position-x', '410');

  clock.advanceTimers(500);
  await act(async () => {});
  expect(target).toHaveAttribute('data-presented');
  expect(target.getAttribute('style')).toBe(successorStyle);
});

it('keeps a successor presentation when the aborted restore publishes stale completion and tick callbacks afterwards', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  const clock = useExtractionClock();
  const { target, controller } = await reachExtractionRetire(clock, { maximised: true });

  const staleRestoreTicks = clock.pendingFrames();
  expect(staleRestoreTicks.length).toBeGreaterThan(0);

  act(() => { controller.commands.moveSheetFrame(target.dataset.sheetId!, { x: 410, y: 320 }); });
  expect(target).not.toHaveAttribute('data-presented');

  fireEvent.click(within(target).getByRole('cell', { name: 'Sheet 1 A1 empty cell' }));
  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  clock.runFrames(clock.now() + 400);
  expect(target).toHaveAttribute('data-presented');
  const successorStyle = target.getAttribute('style');

  act(() => { for (const callback of staleRestoreTicks) callback(clock.now() + 10_000); });
  await act(async () => { vi.advanceTimersByTime(500); });
  expect(target).toHaveAttribute('data-presented');
  expect(target.getAttribute('style')).toBe(successorStyle);
  expect(target).toHaveAttribute('data-position-x', '410');
});
