import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { measuredElementGeometry, virtualGridGeometry } from '@test-support/domGeometry';
import { sheetDocument, workbookWithLegacyFormulaFixtures } from '@test-support/workbookFactories';
import { zoomWorkspace } from '@test-support/workspaceActions';
import { App } from './App';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }));
}

function measureWorkspaceAndGrids() {
  const surface = screen.getByTestId('workspace-surface');
  measuredElementGeometry(surface, { width: 800, height: 600 });
  const inputs = screen.getByRole('article', { name: 'Sheet Inputs' });
  const outputs = screen.getByRole('article', { name: 'Sheet Outputs' });
  act(() => {
    virtualGridGeometry(within(inputs).getByTestId('sheet-frame-body'), { width: 238, height: 126 });
    virtualGridGeometry(within(outputs).getByTestId('sheet-frame-body'), { width: 238, height: 126 });
  });
  return { inputs, outputs, surface };
}

it('suppresses formula reference links through maximised editing and restores them after returning to the canvas', async () => {
  stubReducedMotion(false);
  const inputs = sheetDocument({
    id: 'inputs', name: 'Inputs', position: { x: 420, y: 140 }, visualScale: 0.75,
  });
  const outputs = sheetDocument({
    id: 'outputs', name: 'Outputs', position: { x: 80, y: 60 }, visualScale: 1.4,
    cells: { A1: '=@inputs!B[2]' },
  });
  render(<App initialWorkbook={workbookWithLegacyFormulaFixtures([inputs, outputs])} />);
  const { outputs: outputsFrame, surface } = measureWorkspaceAndGrids();
  zoomWorkspace('in');
  expect(Number(surface.dataset.viewportScale)).toBeGreaterThan(1);

  fireEvent.click(within(outputsFrame).getByRole('cell', { name: 'Outputs A1 cell' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show references' }));
  const link = await screen.findByRole('button', { name: 'Navigate to @Inputs!B[2]' });
  expect(document.querySelector('.contextual-reference-canvas')).toBeInTheDocument();
  const initialX1 = link.getAttribute('x1');
  const initialX2 = link.getAttribute('x2');

  let now = 0;
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
  function settleAnimation() {
    now += 1_000;
    for (let turn = 0; turn < 10 && frames.size > 0; turn += 1) {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) act(() => callback(now));
      now += 1_000;
    }
  }

  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  // The entering phase still owns a sampled canvas-to-maximised presentation.
  expect(outputsFrame).toHaveAttribute('data-presented', 'true');
  expect(screen.queryByRole('button', { name: 'Navigate to @Inputs!B[2]' })).not.toBeInTheDocument();
  expect(document.querySelector('.contextual-reference-canvas')).toBeNull();
  settleAnimation();
  expect(within(outputsFrame).getByTestId('sheet-frame-header')).toHaveStyle({ height: '0px' });

  fireEvent.wheel(within(outputsFrame).getByTestId('sheet-grid'), { ctrlKey: true, deltaY: 100 });
  expect(within(outputsFrame).getByTestId('sheet-frame-body').style.transform).not.toBe('scale(1)');
  expect(document.querySelector('.contextual-reference-canvas')).toBeNull();
  expect(document.querySelector('.contextual-reference-offscreen-marker')).toBeNull();
  expect(document.querySelector('.contextual-reference-overview-target')).toBeNull();

  const cell = within(outputsFrame).getByRole('cell', { name: 'Outputs A1 cell' });
  fireEvent.click(cell);
  fireEvent.keyDown(cell, { key: 'F2' });
  const editor = screen.getByRole('textbox', { name: 'Outputs A1 editor' });
  fireEvent.change(editor, { target: { value: '=@inputs!B[2]+1' } });
  const token = document.querySelector<HTMLElement>('[data-reference-index="0"]')!;
  expect(token).toHaveTextContent('@inputs!B[2]');
  vi.spyOn(token, 'getClientRects').mockReturnValue([{ left: 10, right: 100, top: 10, bottom: 30 } as DOMRect] as unknown as DOMRectList);
  fireEvent.mouseMove(editor, { clientX: 20, clientY: 20 });
  expect(editor).toHaveValue('=@inputs!B[2]+1');
  expect(editor).toHaveFocus();
  expect(screen.queryByRole('button', { name: 'Navigate to @Inputs!B[2]' })).not.toBeInTheDocument();
  fireEvent.keyDown(editor, { key: 'Escape' });
  expect(screen.queryByRole('textbox', { name: 'Outputs A1 editor' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Restore to workspace' }));
  // Restoring is still a non-canvas phase and must not flash stale canvas links.
  expect(screen.queryByRole('button', { name: 'Navigate to @Inputs!B[2]' })).not.toBeInTheDocument();
  expect(document.querySelector('.contextual-reference-canvas')).toBeNull();

  settleAnimation();
  expect(outputsFrame).not.toHaveAttribute('data-presented');
  const restoredLink = await screen.findByRole('button', { name: /Navigate to @inputs!B\[2\]/i });
  expect(document.querySelector('.contextual-reference-canvas')).toBeInTheDocument();
  expect(restoredLink.getAttribute('x1')).not.toBe(initialX1);
  expect(restoredLink.getAttribute('x2')).not.toBe(initialX2);
});

it('suppresses canvas-anchored error reference previews outside canvas mode', async () => {
  stubReducedMotion(true);
  const inputs = sheetDocument({ id: 'inputs', name: 'Inputs', position: { x: 360, y: 120 } });
  const outputs = sheetDocument({
    id: 'outputs', name: 'Outputs', position: { x: 40, y: 40 }, cells: { A1: '=@inputs!B[2]/0' },
  });
  render(<App initialWorkbook={workbookWithLegacyFormulaFixtures([inputs, outputs])} />);
  const { outputs: outputsFrame } = measureWorkspaceAndGrids();

  fireEvent.click(within(outputsFrame).getByRole('cell', { name: 'Outputs A1 cell' }));
  fireEvent.click(screen.getByRole('button', { name: /Toggle error list/ }));
  const errorReference = document.querySelector<HTMLElement>('.error-list-reference');
  expect(errorReference).not.toBeNull();
  fireEvent.mouseEnter(errorReference!);
  expect(await screen.findByLabelText('Formula reference paths')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  expect(outputsFrame).toHaveAttribute('data-presented', 'true');
  expect(screen.queryByLabelText('Formula reference paths')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Restore to workspace' }));
  expect(await screen.findByLabelText('Formula reference paths')).toBeInTheDocument();
});
