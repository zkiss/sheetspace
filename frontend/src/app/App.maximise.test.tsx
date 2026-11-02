import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { measuredElementGeometry } from '@test-support/domGeometry';

afterEach(() => vi.unstubAllGlobals());

it('maximises the existing grid, isolates zoom and restores the unchanged frame', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const sheet = smallSheetDocument({ id: 'inputs', name: 'Inputs', position: { x: 48, y: 96 }, visualScale: 0.8 });
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
