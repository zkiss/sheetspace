import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { workbookWithSheets } from '@test-support/workbookFactories';
import { App } from './App';

const feedback = vi.hoisted(() => ({
  state: { pending: false, unresolved: true, error: 'Response was lost.' } as { pending: boolean; unresolved: boolean; error?: string },
  confirm: vi.fn(),
  undo: vi.fn(),
}));

vi.mock('@application/react/useWorkbookController', async (importOriginal) => {
  const original = await importOriginal<typeof import('@application/react/useWorkbookController')>();
  return { useWorkbookController: (...args: Parameters<typeof original.useWorkbookController>) => {
    const controller = original.useWorkbookController(...args);
    return { ...controller, recordDeletion: feedback.state,
      commands: { ...controller.commands, confirmRecordDeletion: feedback.confirm, undo: feedback.undo } };
  } };
});

it('labels deletion errors and confirms only the retained deletion', () => {
  feedback.state = { pending: false, unresolved: true, error: 'Response was lost.' };
  render(<App initialWorkbook={workbookWithSheets([])} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Deletion could not be completed: Response was lost.');
  expect(screen.getByText(/previous deletion needs confirmation/)).toHaveAttribute('role', 'status');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm previous deletion' }));
  expect(feedback.confirm).toHaveBeenCalledOnce();
  expect(feedback.undo).not.toHaveBeenCalled();
});

it('disables confirmation while pending and clears feedback after success', () => {
  feedback.state = { pending: true, unresolved: true, error: 'Response was lost.' };
  const view = render(<App initialWorkbook={workbookWithSheets([])} />);
  expect(screen.getByText(/Confirming deletion/)).toHaveAttribute('role', 'status');
  expect(screen.getByRole('button', { name: 'Confirm previous deletion' })).toBeDisabled();

  feedback.state = { pending: false, unresolved: false };
  view.rerender(<App initialWorkbook={workbookWithSheets([])} />);
  expect(screen.queryByText(/Confirming deletion/)).not.toBeInTheDocument();
  expect(screen.queryByText(/previous deletion needs confirmation/)).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Confirm previous deletion' })).not.toBeInTheDocument();
});

it('shows pending deletion without offering confirmation before it is unresolved', () => {
  feedback.state = { pending: true, unresolved: false };
  render(<App initialWorkbook={workbookWithSheets([])} />);
  expect(screen.getByText(/Confirming deletion/)).toHaveAttribute('role', 'status');
  expect(screen.queryByRole('button', { name: 'Confirm previous deletion' })).not.toBeInTheDocument();
});
