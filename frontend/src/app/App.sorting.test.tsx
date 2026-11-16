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
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Sort…' }));
  const dialog = screen.getByRole('dialog', { name: 'Sort First' });
  fireEvent.click(within(dialog).getByRole('button', { name: '+ Add another sort column' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sort First' })).not.toBeInTheDocument());
  expect(screen.getByRole('cell', { name: 'First A1 cell' })).toHaveTextContent('1');
  fireEvent.contextMenu(screen.getByRole('article', { name: 'Sheet Second' }));
  fireEvent.click(within(screen.getByRole('menu', { name: 'Second sheet menu' })).getByRole('menuitem', { name: 'Sort…' }));
  expect(screen.getByRole('dialog', { name: 'Sort Second' })).toHaveTextContent('No sorting applied');
  expect(screen.getByRole('cell', { name: 'Second A1 cell' })).toHaveTextContent('3');
});

