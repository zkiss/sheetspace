import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { SheetSortingControls, type SortingSubmission } from './SheetSortingControls';

type Result = Awaited<SortingSubmission['completion']>;
const accepted = { ok: true as const };

function deferredSubmission() {
  let settle!: (result: Result) => void;
  const completion = new Promise<Result>((resolve) => { settle = resolve; });
  return { submission: { result: accepted, completion }, settle };
}

function renderSorting(onApply: () => SortingSubmission) {
  const sheet = sheetDocument({ id: 's', name: 'Sheet', columnCount: 2 });
  const sorting = [{ columnId: sheet.content.columns[0]!, direction: 'descending' as const }];
  const close = vi.fn();
  function Parent() {
    const [open, setOpen] = useState(true);
    return <>
      <button>Background</button>
      {open && <SheetSortingControls sheet={{ ...sheet, sorting }} onApply={onApply} onClose={() => {
        close();
        setOpen(false);
        screen.getByRole('button', { name: 'Background' }).focus();
      }} />}
    </>;
  }
  const view = render(<Parent />);
  return { ...view, close, background: screen.getByRole('button', { name: 'Background' }) };
}

it('owns real keyboard focus while saving, promotes focus after failure, and releases it on Escape', async () => {
  const user = userEvent.setup();
  const request = deferredSubmission();
  const apply = vi.fn(() => request.submission);
  const { close, background } = renderSorting(apply);
  const dialog = screen.getByRole('dialog');
  await user.click(screen.getByRole('button', { name: 'Apply' }));

  expect(dialog).toHaveFocus();
  background.focus();
  expect(dialog).toHaveFocus();
  await user.tab();
  await user.tab({ shift: true });
  await user.keyboard('{Escape}{Enter}');
  expect(dialog).toHaveFocus();
  expect(close).not.toHaveBeenCalled();
  expect(apply).toHaveBeenCalledOnce();

  await act(async () => request.settle({ ok: false, reason: 'persistence-failed' }));

  expect(screen.getByRole('alert')).toHaveTextContent('Sorting could not be saved');
  expect(screen.getByLabelText('Sort order 1')).toHaveValue('descending');
  expect(screen.getByLabelText('Column 1')).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByRole('button', { name: 'Apply' })).toHaveFocus();
  await user.tab();
  expect(screen.getByLabelText('Column 1')).toHaveFocus();
  background.focus();
  expect(screen.getByLabelText('Column 1')).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(close).toHaveBeenCalledOnce();
  expect(background).toHaveFocus();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  background.blur();
  background.focus();
  expect(background).toHaveFocus();
});

it('retains focused Apply on immediate rejection and reconciles repeated failure and successful retry', async () => {
  const user = userEvent.setup();
  const failed = deferredSubmission();
  const saved = deferredSubmission();
  const rejection = { ok: false as const, reason: 'pending-model-transition' };
  const apply = vi.fn()
    .mockReturnValueOnce({ result: rejection, completion: Promise.resolve(rejection) })
    .mockReturnValueOnce(failed.submission)
    .mockReturnValueOnce(saved.submission);
  const { close, background } = renderSorting(apply);
  const button = screen.getByRole('button', { name: 'Apply' });
  await user.click(button);
  expect(button).toHaveFocus();
  expect(screen.getByRole('alert')).toHaveTextContent('pending workbook change');
  await user.click(button);
  expect(screen.getByRole('dialog')).toHaveFocus();
  await act(async () => failed.settle({ ok: false, reason: 'persistence-failed' }));
  expect(screen.getByLabelText('Column 1')).toHaveFocus();
  await user.click(button);
  expect(screen.getByRole('dialog')).toHaveFocus();
  await act(async () => saved.settle(accepted));
  expect(close).toHaveBeenCalledOnce();
  expect(background).toHaveFocus();
  expect(apply).toHaveBeenCalledTimes(3);
});
