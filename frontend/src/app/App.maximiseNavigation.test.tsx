import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { measuredElementGeometry } from '@test-support/domGeometry';

afterEach(() => vi.unstubAllGlobals());

it('transfers maximised presentation when sheet search chooses another sheet', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const source = smallSheetDocument({ id: 'source', name: 'Source', position: { x: 0, y: 0 } });
  const target = smallSheetDocument({ id: 'target', name: 'Target', position: { x: 1200, y: 0 } });
  render(<App initialWorkbook={workbookWithSheets([source, target])} />);
  measuredElementGeometry(screen.getByTestId('workspace-surface'), { width: 800, height: 600 });
  const sourceFrame = screen.getByRole('article', { name: 'Sheet Source' });
  fireEvent.click(within(sourceFrame).getByRole('cell', { name: 'Source A1 empty cell' }));
  fireEvent.click(screen.getByRole('button', { name: 'Maximise sheet' }));
  fireEvent.keyDown(document.body, { key: 'S', code: 'KeyS', altKey: true, shiftKey: true });
  fireEvent.click(screen.getByRole('button', { name: /Target/ }));
  await waitFor(() => expect(screen.getByRole('article', { name: 'Sheet Target' })).toHaveAttribute('data-presented', 'true'));
  expect(sourceFrame).not.toHaveAttribute('data-presented');
});
