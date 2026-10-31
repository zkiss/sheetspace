import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import type { DataModel } from '@workbook/core/model';
import { sheetDocument, workbookWithLegacyFormulaFixtures, workbookWithSheets } from '@test-support/workbookFactories';
import { App } from './App';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';

it('navigates trace header and cross-sheet causes through the workspace', async () => {
  const user = userEvent.setup();
  const source = sheetDocument({ id: 'source', name: 'Source', cells: { A1: '=1/0' } });
  const summary = sheetDocument({ id: 'summary', name: 'Summary', cells: { A1: '=@Source!A[1]+1' } });
  const workbook = workbookWithLegacyFormulaFixtures([summary, source]);
  const document = workbook.documents.summary;
  document.content.cells[cellIdentityKey(cellIdentityAt(document.content, 'A1')!)] = prepareUserFormula('=@Source!A[1]+1', workbook, document.id);
  render(<App initialWorkbook={workbook} />);
  await user.click(screen.getByRole('button', { name: /Errors \(2\)/ }));
  await user.click(within(screen.getByRole('region', { name: 'Error trace' })).getAllByRole('button', { name: '@Summary!A[1]' })[0]);
  const inspected = screen.getByRole('cell', { name: 'Summary A1 cell' });
  await waitFor(() => expect(inspected).toHaveFocus());
  expect(inspected).toHaveAttribute('data-navigation-highlight');
  fireEvent.keyDown(inspected, { altKey: true, shiftKey: true, key: 'E' });
  const trace = screen.getByRole('region', { name: 'Error trace' });
  await user.click(within(trace).getByRole('button', { name: '@Source!A[1]' }));
  const destination = screen.getByRole('cell', { name: 'Source A1 cell' });
  await waitFor(() => expect(destination).toHaveFocus());
  expect(destination).toHaveAttribute('data-navigation-highlight');
});

it('navigates a model-bound calculated cell from its trace header', async () => {
  const user = userEvent.setup();
  const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', rowCount: 2, columnCount: 2, cells: { B1: 'three' } });
  const model: DataModel = { id: 'model', name: 'Model', columns: [
    { id: 'total', name: 'Total', kind: 'calculated', type: 'float', formula: '=@B[1]*2' },
    { id: 'input', name: 'Input', kind: 'manual', type: 'string' },
  ] };
  const bound = bindSheetToModel({ ...workbookWithSheets([sheet]), dataModels: { model } }, sheet.id, model.id, () => 'unused-column');
  if (!bound.ok) throw new Error(bound.reason);
  render(<App initialWorkbook={bound.value} />);
  await user.click(screen.getByRole('button', { name: /Errors \(1\)/ }));
  const trace = screen.getByRole('region', { name: 'Error trace' });
  await user.click(within(trace).getAllByRole('button', { name: '@Inputs!Total[1]' })[0]);
  const calculated = screen.getByRole('cell', { name: /Inputs A1 calculated/ });
  await waitFor(() => expect(calculated).toHaveFocus());
  expect(calculated).toHaveAttribute('data-navigation-highlight');
});
