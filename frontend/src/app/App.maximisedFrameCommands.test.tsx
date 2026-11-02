import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { measuredElementGeometry } from '@test-support/domGeometry';

afterEach(() => vi.unstubAllGlobals());

it.each([
  { command: 'Sheet display scale…', edits: { 'Display scale (%)': 200 }, attribute: 'data-visual-scale', value: '2' },
  { command: 'Resize sheet…', edits: { Width: 500, Height: 350 }, attribute: 'data-frame-width', value: '500' },
  { command: 'Move sheet…', edits: { 'X position': -300, 'Y position': 500 }, attribute: 'data-position-x', value: '-300' },
])('restores the actual saved frame after $command and content undo while maximised', async ({ command, edits, attribute, value }) => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const sheet = smallSheetDocument({ id: 'inputs', name: 'Inputs', position: { x: 48, y: 96 }, visualScale: 0.8, frameSize: { width: 310, height: 220 } });
  render(<App initialWorkbook={workbookWithSheets([sheet])} />);
  const surface = screen.getByTestId('workspace-surface');
  measuredElementGeometry(surface, { width: 800, height: 600 });
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  fireEvent.click(within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' }));
  fireEvent.keyDown(within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' }), { key: 'F2' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Inputs A1 editor' }), { target: { value: 'changed' } });
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Inputs A1 editor' }), { key: 'Enter' });
  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
  fireEvent.click(screen.getByRole('button', { name: command }));
  for (const [label, number] of Object.entries(edits)) {
    fireEvent.change(screen.getByRole('spinbutton', { name: label }), { target: { value: number } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(frame).toHaveAttribute(attribute, value));
  expect(frame).toHaveAttribute('data-presented', 'true');
  restoreAndExpectNativeCentredFrame(frame, surface);

  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
  await waitFor(() => expect(within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' })).not.toHaveTextContent('changed'));
  expect(frame).toHaveAttribute(attribute, value);
  expect(frame).toHaveAttribute('data-presented', 'true');
  restoreAndExpectNativeCentredFrame(frame, surface);
});

function restoreAndExpectNativeCentredFrame(frame: HTMLElement, surface: HTMLElement) {
  fireEvent.click(screen.getByRole('button', { name: 'Restore to workspace' }));
  expect(frame).not.toHaveAttribute('data-presented');
  const scale = Number(surface.dataset.viewportScale);
  expect(scale * Number(frame.dataset.visualScale)).toBeCloseTo(1);
  expect(Number(surface.dataset.viewportX) + Number(frame.dataset.positionX) * scale).toBeCloseTo((800 - Number(frame.dataset.frameWidth)) / 2);
  expect(Number(surface.dataset.viewportY) + Number(frame.dataset.positionY) * scale).toBeCloseTo((600 - Number(frame.dataset.frameHeight)) / 2);
}
