import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { openSheetContextMenu } from '@test-support/appScreen';
import { positionedSheet, workbookWithSheets } from '@test-support/workbookFactories';
import { App } from './App';

const boundary = vi.hoisted(() => ({ reject: true }));
vi.mock('@application/react/useWorkbookController', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@application/react/useWorkbookController')>();
  return {
    ...actual,
    useWorkbookController: (...args: Parameters<typeof actual.useWorkbookController>) => {
      const controller = actual.useWorkbookController(...args);
      return { ...controller, commands: { ...controller.commands, renameSheet: (...renameArgs: Parameters<typeof controller.commands.renameSheet>) =>
        boundary.reject ? { ok: false, reason: 'persistence-failed' } : controller.commands.renameSheet(...renameArgs) } };
    },
  };
});

describe('rename admission feedback', () => {
  it('retains a rejected draft, permits cancellation, and retries successfully', () => {
    boundary.reject = true;
    const sheet = positionedSheet('inputs', 'Inputs', { x: 0, y: 0 });
    render(<App initialWorkbook={workbookWithSheets([sheet])} />);
    const openRename = () => fireEvent.click(within(openSheetContextMenu(screen.getByRole('article', { name: 'Sheet Inputs' }))).getByRole('menuitem', { name: 'Rename' }));
    openRename();
    const input = screen.getByLabelText('Sheet name');
    fireEvent.change(input, { target: { value: 'New name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Saving failed');
    expect(input).toHaveAttribute('aria-describedby', 'rename-sheet-name-error');
    expect(input).toHaveValue('New name');
    expect(screen.getByRole('form', { name: 'Rename sheet' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Sheet Inputs' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Rename sheet' })).not.toBeInTheDocument();
    openRename();
    fireEvent.change(screen.getByLabelText('Sheet name'), { target: { value: 'New name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    boundary.reject = false;
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('form', { name: 'Rename sheet' })).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Sheet New name' })).toBeInTheDocument();
  });
});
