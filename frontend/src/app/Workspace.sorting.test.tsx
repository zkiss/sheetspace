import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { formattingSelection } from '@test-support/formattingProjection';
import { formattingWorkspaceProps } from '@test-support/formattingWorkspace';
import { Workspace } from './Workspace';

function openSorting(name: string) {
  fireEvent.contextMenu(screen.getByRole('article', { name: `Sheet ${name}` }));
  fireEvent.click(within(screen.getByRole('menu', { name: `${name} sheet menu` })).getByRole('menuitem', { name: 'Sort…' }));
  return screen.getByRole('dialog', { name: `Sort ${name}` });
}

it('routes model sheet sorting to its own command and cancels drafts on Escape', async () => {
  const first = smallSheetDocument({ id: 'first', name: 'First' });
  const base = smallSheetDocument({ id: 'second', name: 'Second' });
  const second = { ...base, modelId: 'm', modelColumnBindings: { p: base.content.columns[0]! } };
  const props = formattingWorkspaceProps(first, formattingSelection(first, 'cells'));
  props.workbook = { ...workbookWithSheets([first, second]), dataModels: { m: { id: 'm', name: 'Model', columns: [{ id: 'p', name: 'Property', kind: 'manual', type: 'float' }] } } };
  const result = { ok: true as const, value: props.workbook, changed: true };
  vi.mocked(props.commands.configureSorting).mockReturnValue({ result, completion: Promise.resolve(result) });
  render(<Workspace {...props} />);
  let dialog = openSorting('Second');
  const add = within(dialog).getByRole('button', { name: '+ Add another sort column' });
  expect(add).toHaveFocus();
  fireEvent.click(add);
  const column = within(dialog).getByLabelText('Column 1');
  expect(column).toHaveTextContent('Property');
  fireEvent.keyDown(column, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Sort Second' })).not.toBeInTheDocument();
  expect(props.commands.configureSorting).not.toHaveBeenCalled();
  dialog = openSorting('Second');
  expect(within(dialog).queryByLabelText('Column 1')).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: '+ Add another sort column' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  expect(props.commands.configureSorting).toHaveBeenCalledWith('second', [{ columnId: second.content.columns[0], direction: 'ascending' }]);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sort Second' })).not.toBeInTheDocument());
  expect(openSorting('First')).toHaveTextContent('No sorting applied');
});

it('keeps pending sorting disabled and isolates subsequent sheet drafts', async () => {
  const first = smallSheetDocument({ id: 'first', name: 'First' });
  const base = smallSheetDocument({ id: 'second', name: 'Second' });
  const second = { ...base, sorting: [{ columnId: base.content.columns[0]!, direction: 'descending' as const }] };
  const props = formattingWorkspaceProps(first, formattingSelection(first, 'cells'));
  props.workbook = workbookWithSheets([first, second]);
  const result = { ok: true as const, value: props.workbook, changed: true };
  let finish!: (value: typeof result) => void;
  vi.mocked(props.commands.configureSorting).mockReturnValue({ result, completion: new Promise((resolve) => { finish = resolve; }) });
  render(<Workspace {...props} />);
  let dialog = openSorting('Second');
  expect(within(dialog).getByLabelText('Sort order 1')).toHaveValue('descending');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  expect(props.commands.configureSorting).toHaveBeenLastCalledWith('second', second.sorting);
  expect(within(dialog).getByRole('button', { name: 'Apply' })).toBeDisabled();
  expect(within(dialog).getByRole('status')).toHaveTextContent('Saving sorting');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(dialog).toBeInTheDocument();
  await act(async () => { finish(result); });
  expect(screen.queryByRole('dialog', { name: 'Sort Second' })).not.toBeInTheDocument();
  dialog = openSorting('First');
  expect(within(dialog).queryByLabelText('Column 1')).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: '+ Add another sort column' }));
  expect(within(dialog).getByLabelText('Column 1')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(props.commands.configureSorting).toHaveBeenCalledTimes(1);
});
