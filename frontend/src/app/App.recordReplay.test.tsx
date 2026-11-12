import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { workbookWithSheets } from '@test-support/workbookFactories';
import { App } from './App';

const confirm = vi.hoisted(() => vi.fn());
vi.mock('@application/react/useWorkbookController', async (importOriginal) => {
  const original = await importOriginal<typeof import('@application/react/useWorkbookController')>();
  return { useWorkbookController: (...args: Parameters<typeof original.useWorkbookController>) => {
    const controller = original.useWorkbookController(...args);
    return { ...controller, commands: { ...controller.commands, undo: confirm },
      recordReplay: { pending: false, unresolved: true, error: 'The workbook changed on sheet Inputs.' } };
  } };
});

it('shows replay failure context and offers confirmation even without undo history', () => {
  render(<App initialWorkbook={workbookWithSheets([])} />);
  expect(screen.getByRole('alert')).toHaveTextContent('The workbook changed on sheet Inputs.');
  expect(screen.getByText(/needs confirmation/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm previous undo or redo' }));
  expect(confirm).toHaveBeenCalledOnce();
});
