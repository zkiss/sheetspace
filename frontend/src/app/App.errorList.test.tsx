import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { sheetDocument, workbookWithLegacyFormulaFixtures } from '@test-support/workbookFactories';
import { App } from './App';

it('opens errors from the shortcut and palette and navigates through the current target', async () => {
  const user = userEvent.setup();
  const sheet = sheetDocument({ id: 'a', name: 'Inputs', cells: { A1: '=1/0', B1: '=1/0' } });
  render(<App initialWorkbook={workbookWithLegacyFormulaFixtures([sheet])} />);
  const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
  await user.click(cell);
  fireEvent.keyDown(cell, { altKey: true, shiftKey: true, key: 'E' });
  expect(screen.getByRole('grid', { name: 'Error list' })).toHaveFocus();
  await user.keyboard('{ArrowDown}{Enter}');
  expect(screen.queryByRole('grid', { name: 'Error list' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Command palette' }));
  await user.click(screen.getByRole('button', { name: /Open error list/ }));
  expect(screen.getByRole('grid', { name: 'Error list' })).toHaveFocus();
  expect(screen.getByText('@Inputs!B[1]').closest('tr')).toHaveAttribute('aria-selected', 'true');
});
