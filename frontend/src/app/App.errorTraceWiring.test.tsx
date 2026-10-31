import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
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

it('rejects removed identities and navigates a current target absent from the error list', async () => {
  const user = userEvent.setup();
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
  await user.click(screen.getByRole('button', { name: /Errors/ }));
  for (const index of [0, 1, 2]) {
    await user.click(screen.getByRole('button', { name: `Trace target ${index}` }));
    expect(screen.getByRole('grid', { name: 'Error list' })).toBeInTheDocument();
  }
  await user.click(screen.getByRole('button', { name: 'Trace target 3' }));
  expect(screen.queryByRole('grid', { name: 'Error list' })).not.toBeInTheDocument();
  const destination = await screen.findByRole('cell', { name: 'Inputs A1 empty cell' });
  await waitFor(() => expect(destination).toHaveFocus());
  expect(destination).toHaveAttribute('data-navigation-highlight');
});
