import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { autosaveClient } from '@test-support/apiClients';
import { measuredElementGeometry } from '@test-support/domGeometry';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

afterEach(() => vi.unstubAllGlobals());

function pointer(target: HTMLElement, type: string, x: number, ctrlKey = false) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: x, ctrlKey });
  Object.assign(event, { pointerId: 17 });
  fireEvent(target, event);
}

it.each(['drag', 'resize', 'scale'] as const)('retires captured frame %s before maximising', (owner) => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const api = autosaveClient({ updateSheetVisualScale: vi.fn() });
  const sheet = smallSheetDocument({ id: 'inputs', name: 'Inputs', position: { x: 48, y: 96 }, visualScale: 0.8, frameSize: { width: 310, height: 220 }, zIndex: 7 });
  render(<App apiClient={api} initialWorkbook={workbookWithSheets([sheet])} />);
  measuredElementGeometry(screen.getByTestId('workspace-surface'), { width: 800, height: 600 });
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  fireEvent.click(within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' }));
  const target = owner === 'drag' ? within(frame).getByTestId('sheet-frame-header')
    : within(frame).getByRole('separator', { name: 'Resize sheet Inputs from right' });
  let captured = false;
  target.setPointerCapture = vi.fn(() => { captured = true; });
  target.hasPointerCapture = vi.fn(() => captured);
  target.releasePointerCapture = vi.fn(() => { captured = false; });
  pointer(target, 'pointerdown', 50, owner === 'scale');
  pointer(target, 'pointermove', 100, owner === 'scale');
  expect(captured).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  expect(target.releasePointerCapture).toHaveBeenCalledWith(17);
  pointer(target, 'pointermove', 150, owner === 'scale');
  pointer(target, 'pointerup', 150, owner === 'scale');
  pointer(target, 'pointerdown', 50, owner === 'scale');
  pointer(target, 'pointermove', 150, owner === 'scale');
  pointer(target, 'pointerup', 150, owner === 'scale');
  expect(captured).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Restore to workspace' }));

  expect(frame).toHaveAttribute('data-position-x', '48');
  expect(frame).toHaveAttribute('data-position-y', '96');
  expect(frame).toHaveAttribute('data-frame-width', '310');
  expect(frame).toHaveAttribute('data-frame-height', '220');
  expect(frame).toHaveAttribute('data-visual-scale', '0.8');
  expect(frame).toHaveAttribute('data-z-index', '7');
  expect(api.updateSheetPosition).not.toHaveBeenCalled();
  expect(api.updateSheetFrameLayout).not.toHaveBeenCalled();
  expect(api.updateSheetVisualScale).not.toHaveBeenCalled();
});
