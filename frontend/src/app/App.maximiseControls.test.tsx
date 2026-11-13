import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { measuredElementGeometry } from '@test-support/domGeometry';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('maximises an inactive title without starting a drag and transfers keyboard focus to restore', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.push(callback); return frames.length; });
  const sheets = [smallSheetDocument({ id: 'one', name: 'One' }), smallSheetDocument({ id: 'two', name: 'Two' })];
  render(<App initialWorkbook={workbookWithSheets(sheets)} />);
  measuredElementGeometry(screen.getByTestId('workspace-surface'), { width: 800, height: 600 });
  const inactive = screen.getByRole('article', { name: 'Sheet Two' });
  const button = within(inactive).getByRole('button', { name: 'Maximise Two' });
  const header = within(inactive).getByTestId('sheet-frame-header');
  header.setPointerCapture = vi.fn();
  fireEvent.pointerDown(button, { button: 0 });
  expect(header.setPointerCapture).not.toHaveBeenCalled();
  button.focus();
  fireEvent.click(button, { detail: 0 });
  act(() => { for (const frame of frames.splice(0)) frame(16); });
  expect(inactive).toHaveAttribute('data-presented', 'true');
  expect(screen.getByRole('button', { name: 'Restore to workspace' })).toHaveFocus();
});
