import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithLegacyFormulaFixtures } from '@test-support/workbookFactories';
import { App } from './App';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

it('opens errors from the shortcut and palette and navigates through the current target', () => {
  vi.useFakeTimers();
  const sheet = sheetDocument({ id: 'a', name: 'Inputs', cells: { A1: '=1/0', B1: '=1/0' } });
  render(<App initialWorkbook={workbookWithLegacyFormulaFixtures([sheet])} />);
  const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
  fireEvent.click(cell);
  fireEvent.keyDown(cell, { altKey: true, shiftKey: true, key: 'E' });
  expect(screen.getByRole('gridcell', { name: '@Inputs!A[1]' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
  expect(screen.getByRole('grid', { name: 'Error list' })).toBeInTheDocument();
  const destination = screen.getByRole('cell', { name: 'Inputs B1 cell' });
  expect(destination).toHaveFocus();
  expect(destination).toHaveAttribute('data-navigation-highlight');
  fireEvent.keyDown(destination, { altKey: true, shiftKey: true, key: 'E' });
  expect(screen.queryByRole('grid', { name: 'Error list' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
  fireEvent.click(screen.getByRole('button', { name: /Toggle error list Alt/ }));
  expect(screen.getByRole('gridcell', { name: '@Inputs!B[1]' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('grid', { name: 'Error list' })).not.toBeInTheDocument();
});

it('does not steal the shortcut from an active cell editor', async () => {
  const sheet = sheetDocument({ id: 'a', name: 'Inputs', cells: { A1: '=1/0' } });
  render(<App initialWorkbook={workbookWithLegacyFormulaFixtures([sheet])} />);
  const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
  fireEvent.click(cell);
  fireEvent.keyDown(cell, { key: 'F2' });
  const editor = screen.getByRole('textbox', { name: 'Inputs A1 editor' });
  fireEvent.keyDown(editor, { altKey: true, shiftKey: true, key: 'E' });
  expect(editor).toHaveFocus();
  expect(screen.queryByRole('grid', { name: 'Error list' })).not.toBeInTheDocument();
});

it('refreshes errors after correction, undo and redo', async () => {
  const user = userEvent.setup();
  const sheet = sheetDocument({ id: 'a', name: 'Inputs', cells: { A1: '=1/0' } });
  render(<App initialWorkbook={workbookWithLegacyFormulaFixtures([sheet])} />);
  const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
  await user.click(cell);
  await user.keyboard('42{Enter}');
  expect(screen.queryByRole('button', { name: /Toggle error list/ })).not.toBeInTheDocument();
  fireEvent.keyDown(cell, { altKey: true, shiftKey: true, key: 'E' });
  expect(screen.getByText('No workbook errors.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Close errors' }));
  await user.keyboard('{Control>}z{/Control}');
  await user.click(screen.getByRole('button', { name: /Toggle error list/ }));
  expect(within(screen.getByRole('grid', { name: 'Error list' })).getByRole('gridcell', { name: '@Inputs!A[1]' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Close errors' }));
  await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
  expect(screen.queryByRole('button', { name: /Toggle error list/ })).not.toBeInTheDocument();
});
