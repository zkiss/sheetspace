import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useWorkbookController } from '@application/react/useWorkbookController';
import { setCustomFunction } from '@calculation/customFunctions';
import { autosaveClient } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { tabularCellsByA1 } from '@workbook/read/queries';
import { FunctionDialog } from './FunctionDialog';

function Harness({ capture }: { capture: (controller: ReturnType<typeof useWorkbookController>) => void }) {
  const controller = useWorkbookController({ initialWorkbook: workbookWithSheets([sheetDocument({ id: 'one', name: 'One' })]) });
  capture(controller);
  const { workbook, commands, formulaResults } = controller;
  return <><output data-testid="result">{formulaResults.one.A1?.display}</output><FunctionDialog functions={workbook.functions ?? []} onClose={() => {}} onRetry={commands.retryFailedSaves} onSave={async (draft, previous) => commands.setFunction(draft, previous).completion} onDelete={async (name) => commands.deleteFunction(name).completion} /></>;
}

it('connects authoring, cell entry, editing and deletion to recalculated callers', async () => {
  let controller!: ReturnType<typeof useWorkbookController>;
  render(<Harness capture={(current) => { controller = current; }} />);
  fireEvent.click(screen.getByText('Create function'));
  fireEvent.change(screen.getByLabelText('Function name'), { target: { value: 'fibonacci' } });
  fireEvent.click(screen.getByText('+ Add parameter'));
  fireEvent.change(screen.getByLabelText('Parameter 1 name'), { target: { value: 'a' } });
  fireEvent.click(screen.getByText('+ Add parameter'));
  fireEvent.change(screen.getByLabelText('Parameter 2 name'), { target: { value: 'b' } });
  fireEvent.change(screen.getByLabelText('Formula body'), { target: { value: '=SUM(a,b)' } });
  fireEvent.click(screen.getByText('Save'));
  await screen.findByText('fibonacci(a: int, b: int)');
  act(() => { expect(controller.commands.updateCellContent('one', 'A1', '=fibonacci(3,5)').ok).toBe(true); });
  expect(screen.getByTestId('result')).toHaveTextContent('8');
  expect(tabularCellsByA1(controller.workbook.documents.one.content).A1).toBe('=fibonacci(3,5)');
  fireEvent.click(screen.getByText('Edit fibonacci'));
  fireEvent.change(screen.getByLabelText('Formula body'), { target: { value: '=SUM(a,b,1)' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('9'));
  fireEvent.click(screen.getByText('Delete fibonacci'));
  await waitFor(() => expect(screen.queryByText('Edit fibonacci')).not.toBeInTheDocument());
  expect(screen.getByTestId('result')).toHaveTextContent('#NAME!');
  expect(tabularCellsByA1(controller.workbook.documents.one.content).A1).toBe('=fibonacci(3,5)');
});

it('reconciles a retried create before saving further changes to the retained draft', async () => {
  const initial = workbookWithSheets([sheetDocument({ id: 'one', name: 'One' })]);
  const first = setCustomFunction(initial, { name: 'value', parameters: [], body: '=1' });
  if (!first.ok) throw new Error(first.error);
  const second = setCustomFunction(first.workbook, { name: 'renamed', parameters: [], body: '=2' }, 'value');
  if (!second.ok) throw new Error(second.error);
  const save = vi.fn().mockRejectedValueOnce(new Error('offline'))
    .mockImplementationOnce(async (id: string) => ({ operationId: id, committedIdentity: 'identity', alreadyCommitted: true, workbook: first.workbook }))
    .mockImplementationOnce(async (id: string) => ({ operationId: id, committedIdentity: 'identity', alreadyCommitted: false, workbook: second.workbook }));
  const api = autosaveClient({ loadWorkbook: vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(first.workbook), setFunction: save });
  function RetryHarness() {
    const { workbook, commands, saveStatus } = useWorkbookController({ initialWorkbook: initial, apiClient: api });
    return <FunctionDialog functions={workbook.functions ?? []} saveStatus={saveStatus} onClose={() => {}} onRetry={commands.retryFailedSaves} onSave={async (draft, previous) => commands.setFunction(draft, previous).completion} onDelete={async (name) => commands.deleteFunction(name).completion} />;
  }
  render(<RetryHarness />);
  fireEvent.click(screen.getByText('Create function'));
  fireEvent.change(screen.getByLabelText('Function name'), { target: { value: 'value' } });
  fireEvent.change(screen.getByLabelText('Formula body'), { target: { value: '=1' } });
  fireEvent.click(screen.getByText('Save'));
  await screen.findByRole('alert');
  fireEvent.change(screen.getByLabelText('Function name'), { target: { value: 'renamed' } });
  fireEvent.change(screen.getByLabelText('Formula body'), { target: { value: '=2' } });
  fireEvent.click(screen.getByText('Save'));
  await screen.findByText('renamed()');
  expect(save).toHaveBeenCalledTimes(3);
});

it('keeps the draft editable when retrying a failed save fails again', async () => {
  const initial = workbookWithSheets([sheetDocument({ id: 'one', name: 'One' })]);
  const save = vi.fn().mockRejectedValue(new Error('offline'));
  const api = autosaveClient({ loadWorkbook: vi.fn().mockResolvedValue(initial), setFunction: save });
  function RetryHarness() {
    const { workbook, commands, saveStatus } = useWorkbookController({ initialWorkbook: initial, apiClient: api });
    return <FunctionDialog functions={workbook.functions ?? []} saveStatus={saveStatus} onClose={() => {}} onRetry={commands.retryFailedSaves} onSave={async (draft, previous) => commands.setFunction(draft, previous).completion} onDelete={async (name) => commands.deleteFunction(name).completion} />;
  }
  render(<RetryHarness />);
  fireEvent.click(screen.getByText('Create function'));
  fireEvent.change(screen.getByLabelText('Function name'), { target: { value: 'value' } });
  fireEvent.change(screen.getByLabelText('Formula body'), { target: { value: '=1' } });
  fireEvent.click(screen.getByText('Save'));
  await screen.findByRole('alert');
  fireEvent.change(screen.getByLabelText('Formula body'), { target: { value: '=2' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
  expect(screen.getByLabelText('Formula body')).toHaveValue('=2');
  expect(screen.getByRole('alert')).toHaveTextContent('Check your connection and try again');
});
