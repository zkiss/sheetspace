import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { measuredElementGeometry, virtualGridGeometry } from '@test-support/domGeometry';
import { sheetDocument, workbookWithLegacyFormulaFixtures } from '@test-support/workbookFactories';
import { App } from './App';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function setup(empty = false, reducedMotion = true) {
  vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion, addEventListener: () => {}, removeEventListener: () => {} }));
  const inputs = sheetDocument({ id: 'inputs', name: 'Inputs', rowCount: empty ? 0 : 30, columnCount: empty ? 0 : 10,
    position: { x: 500, y: 100 }, visualScale: 0.8, zIndex: 7 });
  const outputs = sheetDocument({ id: 'outputs', name: 'Outputs', cells: { A1: '=SUM(@inputs!B[3]:C[5])' } });
  render(<App initialWorkbook={workbookWithLegacyFormulaFixtures([inputs, outputs])} />);
  measuredElementGeometry(screen.getByTestId('workspace-surface'), { width: 800, height: 600 });
  const source = screen.getByRole('article', { name: 'Sheet Outputs' });
  const destination = screen.getByRole('article', { name: 'Sheet Inputs' });
  act(() => {
    virtualGridGeometry(within(source).getByTestId('sheet-frame-body'), { width: 800, height: 600 });
    virtualGridGeometry(within(destination).getByTestId('sheet-frame-body'), { width: 800, height: 600 });
  });
  fireEvent.click(within(source).getByRole('cell', { name: 'Outputs A1 cell' }));
  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  return { source, destination };
}

function followRange(source: HTMLElement) {
  const cell = within(source).getByRole('cell', { name: 'Outputs A1 cell' });
  fireEvent.keyDown(cell, { key: 'F2' });
  const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Outputs A1 editor' });
  editor.setSelectionRange(8, 8);
  fireEvent.keyDown(editor, { key: 'F4' });
}

it('transfers the retained grid for a reference range and restores both destinations through history', async () => {
  const { source, destination } = setup();
  const grid = within(destination).getByTestId('sheet-grid');
  followRange(source);
  await waitFor(() => expect(destination).toHaveAttribute('data-presented', 'true'));
  const anchor = within(destination).getByRole('cell', { name: 'Inputs B3 empty cell' });
  await waitFor(() => expect(anchor).toHaveFocus());
  expect(within(destination).getByRole('cell', { name: 'Inputs C5 empty cell' })).toHaveAttribute('data-navigation-highlight', 'true');
  expect(within(destination).getByTestId('sheet-grid')).toBe(grid);
  expect(destination).toHaveAttribute('data-position-x', '500');
  expect(destination).toHaveAttribute('data-visual-scale', '0.8');
  expect(destination).toHaveAttribute('data-z-index', '7');
  fireEvent.keyDown(anchor, { key: 'ArrowLeft', altKey: true });
  await waitFor(() => expect(source).toHaveAttribute('data-presented', 'true'));
  await waitFor(() => expect(within(source).getByRole('cell', { name: 'Outputs A1 cell' })).toHaveFocus());
  fireEvent.keyDown(document.body, { key: 'ArrowRight', altKey: true });
  await waitFor(() => expect(destination).toHaveAttribute('data-presented', 'true'));
  await waitFor(() => expect(within(destination).getByRole('cell', { name: 'Inputs C5 empty cell' })).toHaveFocus());
  expect(anchor).toHaveAttribute('data-reference-selected', 'true');
});

it.each([false, true])('transfers sheet search including an empty destination (empty=%s)', async (empty) => {
  const { source, destination } = setup(empty);
  fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
  fireEvent.click(screen.getByRole('button', { name: /Go to sheet…/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Inputs' }));
  await waitFor(() => expect(destination).toHaveAttribute('data-presented', 'true'));
  expect(source).not.toHaveAttribute('data-presented');
  if (!empty) await waitFor(() => expect(within(destination).getByRole('cell', { name: 'Inputs A1 empty cell' })).toHaveFocus());
  fireEvent.keyDown(document.body, { key: 'ArrowLeft', altKey: true });
  await waitFor(() => expect(source).toHaveAttribute('data-presented', 'true'));
});

it('reveals content undo on another maximised sheet without adding an explicit navigation destination', async () => {
  const { source, destination } = setup();
  const cell = within(source).getByRole('cell', { name: 'Outputs A1 cell' });
  fireEvent.keyDown(cell, { key: 'F2' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Outputs A1 editor' }), { target: { value: 'changed' } });
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Outputs A1 editor' }), { key: 'Enter' });
  fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
  fireEvent.click(screen.getByRole('button', { name: /Go to sheet…/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Inputs' }));
  await waitFor(() => expect(destination).toHaveAttribute('data-presented', 'true'));
  await waitFor(() => expect(within(destination).getByRole('cell', { name: 'Inputs A1 empty cell' })).toHaveFocus());
  fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
  await waitFor(() => expect(source).toHaveAttribute('data-presented', 'true'));
  expect(cell).not.toHaveTextContent('changed');
  expect(source).toHaveAttribute('data-position-x', '0');
});

it.each(['source restoration', 'target entry'] as const)('adopts displayed geometry when Restore interrupts %s', async (stage) => {
  useAnimationClock();
  const { source, destination } = setup(false, false);
  await finishTransfer();
  await act(async () => { vi.advanceTimersByTime(8); });
  followRange(source);
  if (stage === 'target entry') {
    for (let frame = 0; frame < 100 && !destination.hasAttribute('data-presented'); frame++) {
      await act(async () => { vi.advanceTimersByTime(16); });
    }
  }
  await act(async () => { vi.advanceTimersByTime(32); });
  const presented = stage === 'source restoration' ? source : destination;
  const body = within(presented).getByTestId('sheet-frame-body');
  expect(presented).toHaveAttribute('data-presented', 'true');
  const geometry = [presented.style.cssText, body.style.cssText];
  fireEvent.click(screen.getByRole('button', { name: 'Restore to workspace' }));
  expect(presented).toHaveAttribute('data-presented', 'true');
  expect([presented.style.cssText, body.style.cssText]).toEqual(geometry);
  await finishTransfer();
  expect(source).not.toHaveAttribute('data-presented');
  expect(destination).not.toHaveAttribute('data-presented');
  const surface = screen.getByTestId('workspace-surface');
  const scale = 1 / Number(presented.dataset.visualScale);
  expect(Number(surface.dataset.viewportScale)).toBeCloseTo(scale);
  expect(Number(surface.dataset.viewportX) + Number(presented.dataset.positionX) * scale).toBeCloseTo((800 - Number(presented.dataset.frameWidth)) / 2);
  expect(Number(surface.dataset.viewportY) + Number(presented.dataset.positionY) * scale).toBeCloseTo((600 - Number(presented.dataset.frameHeight)) / 2);
  expect(screen.getByRole('button', { name: 'Maximise sheet' })).toBeInTheDocument();
  expect(destination.querySelector('[data-navigation-highlight="true"]')).toBeNull();
  expect(destination.contains(document.activeElement)).toBe(false);
});

function useAnimationClock() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
}

async function finishTransfer() {
  for (let stage = 0; stage < 5; stage++) {
    await act(async () => { vi.advanceTimersByTime(1000); });
  }
}

it('completes an animated reference transfer when no newer grid input claims ownership', async () => {
  useAnimationClock();
  const { source, destination } = setup(false, false);
  await finishTransfer();
  followRange(source);
  await finishTransfer();
  expect(destination).toHaveAttribute('data-presented', 'true');
  expect(within(destination).getByRole('cell', { name: 'Inputs B3 empty cell' })).toHaveFocus();
});

it.each(['click', 'keyboard', 'extend', 'pointer'] as const)('retires an animated reference transfer before accepting newer %s selection', async (input) => {
  useAnimationClock();
  const { source, destination } = setup(false, false);
  await finishTransfer();
  followRange(source);
  await act(async () => { vi.advanceTimersByTime(32); });
  const next = within(source).getByRole('cell', { name: 'Outputs A2 empty cell' });
  if (input === 'keyboard') fireEvent.keyDown(within(source).getByRole('cell', { name: 'Outputs A1 cell' }), { key: 'ArrowDown' });
  else if (input === 'pointer') {
    fireEvent(next, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 60, clientY: 70 }));
    fireEvent(next, new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 60, clientY: 70 }));
  } else fireEvent.click(next, { shiftKey: input === 'extend' });
  expect(next).toHaveAttribute('data-active-cell', 'true');

  await finishTransfer();
  expect(destination).not.toHaveAttribute('data-presented');
  expect(next).toHaveAttribute('data-active-cell', 'true');
  expect(destination.contains(document.activeElement)).toBe(false);
  expect(destination.querySelector('[data-navigation-highlight="true"]')).toBeNull();

  fireEvent.click(within(source).getByRole('cell', { name: 'Outputs A1 cell' }));
  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  await finishTransfer();
  followRange(source);
  await finishTransfer();
  expect(destination).toHaveAttribute('data-presented', 'true');
  expect(within(destination).getByRole('cell', { name: 'Inputs B3 empty cell' })).toHaveFocus();
});
