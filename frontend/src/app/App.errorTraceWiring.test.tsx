import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { App } from './App';
import type { StableCellIdentity } from '@workbook/core/model';

const targets = vi.hoisted(() => ({ current: [] as { sheetId: string; cell: { rowId: string; columnId: string } }[] }));
vi.mock('./ErrorList', async (importOriginal) => {
  const original = await importOriginal<typeof import('./ErrorList')>();
  return { ErrorList: (props: Parameters<typeof original.ErrorList>[0]) => <>
    <original.ErrorList {...props} />
    {props.open && targets.current.map((target, index) => <button key={index} onClick={() => props.onNavigate?.(target)}>Trace target {index}</button>)}
  </> };
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it('rejects removed identities and navigates a current target absent from the error list', () => {
  const sheet = sheetDocument({ id: 's', name: 'Inputs', rowCount: 2, columnCount: 2, cells: { B1: '=1/0' } });
  const workbook = workbookWithSheets([sheet]);
  const content = workbook.documents.s.content;
  const valid: StableCellIdentity = { rowId: content.rows[0], columnId: content.columns[0] };
  targets.current = [
    { sheetId: 'removed', cell: valid },
    { sheetId: 's', cell: { ...valid, rowId: 'removed' } },
    { sheetId: 's', cell: { ...valid, columnId: 'removed' } },
    { sheetId: 's', cell: valid },
  ];
  render(<App initialWorkbook={workbook} />);
  fireEvent.click(screen.getByRole('button', { name: /Toggle error list/ }));
  for (const index of [0, 1, 2]) {
    fireEvent.click(screen.getByRole('button', { name: `Trace target ${index}` }));
    expect(screen.getByRole('grid', { name: 'Error list' })).toBeInTheDocument();
  }
  fireEvent.click(screen.getByRole('button', { name: 'Trace target 3' }));
  expect(screen.getByRole('grid', { name: 'Error list' })).toBeInTheDocument();
  const destination = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
  expect(destination).toHaveFocus();
  expect(destination).toHaveAttribute('data-navigation-highlight');
});
