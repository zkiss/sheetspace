import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { App } from './App';

it('applies sorting through the real workspace and keeps sheet settings independent', async () => {
  const first = smallSheetDocument({ id: 'first', name: 'First', cells: { A1: '2', A2: '1' } });
  const second = smallSheetDocument({ id: 'second', name: 'Second', cells: { A1: '3', A2: '4' } });
  render(<App initialWorkbook={workbookWithSheets([first, second])} />);
  fireEvent.contextMenu(screen.getByRole('article', { name: 'Sheet First' }));
  const menu = screen.getByRole('menu', { name: 'First sheet menu' });
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Sorting…' }));
  fireEvent.click(within(menu).getByRole('button', { name: 'Add criterion' }));
  fireEvent.click(within(menu).getByRole('button', { name: 'Apply sorting' }));
  await waitFor(() => expect(within(menu).getByLabelText('Active sorting')).toHaveTextContent('A (ascending)'));
  expect(screen.getByRole('cell', { name: 'First A1 cell' })).toHaveTextContent('1');
  fireEvent.contextMenu(screen.getByRole('article', { name: 'Sheet Second' }));
  expect(within(screen.getByRole('menu', { name: 'Second sheet menu' })).getByLabelText('Active sorting')).toHaveTextContent('Sorting off');
  expect(screen.getByRole('cell', { name: 'Second A1 cell' })).toHaveTextContent('3');
});

