import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { workbookWithSheets } from '@test-support/workbookFactories';
import { autosaveClient } from '@test-support/apiClients';
import { setCustomFunction } from '@calculation/customFunctions';
import { App } from './App';

it('opens the workbook function manager from the toolbar and restores focus', async () => {
  render(<App initialWorkbook={workbookWithSheets([])} />);
  const button = screen.getByRole('button', { name: 'Functions' });
  fireEvent.click(button);
  expect(screen.getByRole('dialog', { name: 'Functions' })).toBeInTheDocument();
  fireEvent.click(screen.getByText('Close'));
  await Promise.resolve();
  expect(button).toHaveFocus();
});

it('saves an invalid body through the API and reopens it after reloading', async () => {
  let persisted = workbookWithSheets([]);
  const api = autosaveClient({
    loadWorkbook: async () => structuredClone(persisted),
    setFunction: async (operationId, _before, declaration, previousName) => {
      const result = setCustomFunction(persisted, { ...declaration, identity: 'function-identity' }, previousName);
      if (!result.ok) throw new Error(result.error);
      persisted = structuredClone(result.workbook);
      return { operationId, committedIdentity: 'function-identity', alreadyCommitted: false, workbook: structuredClone(persisted) };
    },
  });
  const app = render(<App apiClient={api} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Functions' }));
  fireEvent.click(screen.getByText('Create function'));
  fireEvent.change(screen.getByLabelText('Function name'), { target: { value: 'broken' } });
  fireEvent.change(screen.getByLabelText('Formula body'), { target: { value: '=SUM(' } });
  fireEvent.click(screen.getByText('Save'));
  await screen.findByText('broken()');
  app.unmount();
  render(<App apiClient={api} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Functions' }));
  fireEvent.click(screen.getByText('Edit broken'));
  expect(screen.getByLabelText('Formula body')).toHaveValue('=SUM(');
  expect(screen.getByText(/malformed/)).toBeInTheDocument();
});
