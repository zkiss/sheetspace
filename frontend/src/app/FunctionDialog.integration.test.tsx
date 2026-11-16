import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
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
  fireEvent.change(screen.getByLabelText('Formula body'), { target: { value: '=SUM(@a,@b)' } });
  fireEvent.click(screen.getByText('Save'));
  await screen.findByText('fibonacci(a: int, b: int)');
  act(() => { expect(controller.commands.updateCellContent('one', 'A1', '=fibonacci(3,5)').ok).toBe(true); });
  expect(screen.getByTestId('result')).toHaveTextContent('8');
  expect(tabularCellsByA1(controller.workbook.documents.one.content).A1).toBe('=fibonacci(3,5)');
  fireEvent.click(screen.getByText('Edit fibonacci'));
  fireEvent.change(screen.getByLabelText('Formula body'), { target: { value: '=SUM(@a,@b,1)' } });
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
    const { workbook, commands, saveStatus, hasPendingSaves } = useWorkbookController({ initialWorkbook: initial, apiClient: api });
    return <FunctionDialog functions={workbook.functions ?? []} saveStatus={saveStatus} hasPendingSaves={hasPendingSaves} onClose={() => {}} onRetry={commands.retryFailedSaves} onSave={async (draft, previous) => commands.setFunction(draft, previous).completion} onDelete={async (name) => commands.deleteFunction(name).completion} />;
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
    const { workbook, commands, saveStatus, hasPendingSaves } = useWorkbookController({ initialWorkbook: initial, apiClient: api });
    return <FunctionDialog functions={workbook.functions ?? []} saveStatus={saveStatus} hasPendingSaves={hasPendingSaves} onClose={() => {}} onRetry={commands.retryFailedSaves} onSave={async (draft, previous) => commands.setFunction(draft, previous).completion} onDelete={async (name) => commands.deleteFunction(name).completion} />;
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

it('waits for all concurrent retries before reporting failure and saving the current draft', async () => {
  let failOther!: () => void;
  let finishFunction!: () => void;
  const other = new Promise<void>((resolve) => { failOther = resolve; });
  const functionRetry = new Promise<void>((resolve) => { finishFunction = resolve; });
  const save = vi.fn().mockResolvedValueOnce({ ok: false, reason: 'persistence-failed' }).mockResolvedValue({ ok: true });
  let retries = 0;
  function RetryHarness() {
    const [status, setStatus] = useState<'saved' | 'saving' | 'failed'>('saved');
    const [pending, setPending] = useState(false);
    const [functions, setFunctions] = useState<ReturnType<typeof workbookWithSheets>['functions']>([]);
    async function retry() {
      setStatus('saving'); setPending(true);
      if (++retries === 1) {
        void other.then(() => setStatus('failed'));
        await Promise.all([other, functionRetry]);
        setFunctions([{ name: 'value', parameters: [], body: '=1' }]);
      } else {
        await Promise.resolve();
        setStatus('saved');
      }
      setPending(false);
    }
    return <FunctionDialog functions={functions ?? []} saveStatus={status} hasPendingSaves={pending} onClose={() => {}} onRetry={() => void retry()} onSave={async (...args) => {
      const result = await save(...args);
      if (!result.ok) setStatus('failed');
      return result;
    }} onDelete={vi.fn()} />;
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
  await act(async () => { failOther(); await other; });
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => { finishFunction(); await functionRetry; });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
  expect(screen.getByLabelText('Formula body')).toHaveValue('=2');
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save).toHaveBeenLastCalledWith({ name: 'renamed', parameters: [], body: '=2' }, 'value');
});

it('edits a parameter formula in light and expanded modes', () => {
  render(<Harness capture={() => {}} />);
  fireEvent.click(screen.getByText('Create function'));
  fireEvent.click(screen.getByText('+ Add parameter'));
  fireEvent.change(screen.getByLabelText('Parameter 1 name'), { target: { value: 'amount' } });
  const input = screen.getByRole('textbox', { name: 'Formula body' });
  fireEvent.change(input, { target: { value: '=@amount * 2' } });
  expect(screen.queryByText(/formula body is malformed/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }));
  expect(screen.getByRole('region', { name: 'Formula body editor' })).toHaveAttribute('data-editor-mode', 'heavy');
  fireEvent.click(screen.getByRole('button', { name: 'Collapse editor' }));
  expect(screen.getByRole('region', { name: 'Formula body editor' })).toHaveAttribute('data-editor-mode', 'light');
  expect(input).toHaveValue('=@amount * 2');
});

it('uses Escape to leave the expanded editor, the draft, and the dialog in order', () => {
  const close = vi.fn();
  render(<FunctionDialog functions={[]} onClose={close} onRetry={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create function' }));
  fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }));
  const input = screen.getByRole('textbox', { name: 'Formula body' });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.getByRole('region', { name: 'Formula body editor' })).toHaveAttribute('data-editor-mode', 'light');
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.getByRole('button', { name: 'Create function' })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Create function' }), { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
});

it('dismisses formula completions before closing the expanded editor or discarding the draft', () => {
  const close = vi.fn();
  render(<FunctionDialog functions={[]} onClose={close} onRetry={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create function' }));
  fireEvent.change(screen.getByLabelText('Function name'), { target: { value: 'total' } });
  fireEvent.click(screen.getByText('+ Add parameter'));
  fireEvent.change(screen.getByLabelText('Parameter 1 name'), { target: { value: 'amount' } });
  const input = screen.getByRole('textbox', { name: 'Formula body' });
  fireEvent.change(input, { target: { value: '=SU' } });
  fireEvent.keyDown(input, { key: ' ', code: 'Space', ctrlKey: true });
  expect(screen.getByRole('listbox', { name: 'Formula completions' })).toBeInTheDocument();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('listbox', { name: 'Formula completions' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Function name')).toHaveValue('total');
  expect(screen.getByLabelText('Parameter 1 name')).toHaveValue('amount');
  expect(input).toHaveValue('=SU');
  fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }));
  fireEvent.keyDown(input, { key: ' ', code: 'Space', ctrlKey: true });
  expect(screen.getByRole('listbox', { name: 'Formula completions' })).toBeInTheDocument();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('listbox', { name: 'Formula completions' })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Formula body editor' })).toHaveAttribute('data-editor-mode', 'heavy');
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.getByRole('region', { name: 'Formula body editor' })).toHaveAttribute('data-editor-mode', 'light');
  expect(input).toHaveValue('=SU');
  expect(screen.getByLabelText('Function name')).toHaveValue('total');
  expect(close).not.toHaveBeenCalled();
});
