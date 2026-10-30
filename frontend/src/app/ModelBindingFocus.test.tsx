import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { deferred } from '@test-support/apiClients';
import { sheetDocument } from '@test-support/workbookFactories';
import { SheetModelControls } from '../workspace/SheetModelControls';
import { NavigationPalette } from './NavigationPalette';

afterEach(cleanup);

it('retains modal focus during a failed bind and restores the selector when it settles', async () => {
  const completion = deferred<{ ok: true } | { ok: false; reason: string }>();
  render(<NavigationPalette commands={[]} onClose={vi.fn()} panel={{ title: 'Bind model', content: <SheetModelControls
    models={[{ id: 'first', name: 'First', columns: [] }]} sheet={sheetDocument({ id: 's', name: 'Inputs' })}
    onBind={() => ({ result: { ok: true }, completion: completion.promise })} onUnbind={vi.fn()} onOpenDataModels={vi.fn()} /> }} />);
  const selector = screen.getByLabelText('Model for Inputs');
  fireEvent.change(selector, { target: { value: 'first' } });
  fireEvent.click(screen.getByRole('button', { name: 'Bind model' }));
  const confirm = screen.getByRole('button', { name: 'Confirm bind' });
  confirm.focus();
  fireEvent.click(confirm);
  const close = screen.getByRole('button', { name: 'Close command palette' });
  expect(close).toHaveFocus();
  fireEvent.keyDown(close, { key: 'Tab' });
  expect(close).toHaveFocus();
  await act(async () => { completion.resolve({ ok: false, reason: 'persistence-failed' }); });
  expect(selector).toHaveFocus();
  expect(screen.getByRole('alert')).toHaveTextContent('not saved');
  fireEvent.keyDown(selector, { key: 'Tab', shiftKey: true });
  expect(close).toHaveFocus();
  fireEvent.keyDown(close, { key: 'Tab' });
  expect(selector).toHaveFocus();
});

it('returns focus to the selector after cancelling direct unbind', () => {
  render(<NavigationPalette commands={[]} onClose={vi.fn()} panel={{ title: 'Unbind model', content: <SheetModelControls
    models={[{ id: 'first', name: 'First', columns: [] }]} sheet={{ ...sheetDocument({ id: 's', name: 'Inputs' }), modelId: 'first' }}
    initialAction="unbind" onBind={vi.fn()} onUnbind={vi.fn()} onOpenDataModels={vi.fn()} /> }} />);
  const cancel = screen.getByRole('button', { name: 'Cancel' });
  cancel.focus();
  fireEvent.click(cancel);
  expect(screen.getByLabelText('Model for Inputs')).toHaveFocus();
});

it.each(['bind', 'rebind', 'unbind'] as const)('restores selector focus after confirming %s successfully', async (action) => {
  const completion = deferred<{ ok: true } | { ok: false; reason: string }>();
  const submit = vi.fn(() => ({ result: { ok: true } as const, completion: completion.promise }));
  render(<NavigationPalette commands={[]} onClose={vi.fn()} panel={{ title: 'Model', content: <SheetModelControls
    models={[{ id: 'first', name: 'First', columns: [] }, { id: 'second', name: 'Second', columns: [] }]}
    sheet={{ ...sheetDocument({ id: 's', name: 'Inputs' }), ...(action === 'bind' ? {} : { modelId: 'first' }) }}
    initialAction={action === 'unbind' ? 'unbind' : undefined} onBind={submit} onUnbind={submit} onOpenDataModels={vi.fn()} /> }} />);
  const selector = screen.getByLabelText('Model for Inputs');
  if (action !== 'unbind') {
    fireEvent.change(selector, { target: { value: action === 'bind' ? 'first' : 'second' } });
    fireEvent.click(screen.getByRole('button', { name: action === 'bind' ? 'Bind model' : 'Rebind model' }));
  }
  const confirm = screen.getByRole('button', { name: `Confirm ${action}` });
  confirm.focus();
  fireEvent.click(confirm);
  expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  expect(document.activeElement).not.toBeDisabled();
  await act(async () => { completion.resolve({ ok: true }); });
  expect(selector).toHaveFocus();
  expect(submit).toHaveBeenCalledOnce();
});

it('returns focus to the selector after synchronous rejection', () => {
  const result = { ok: false as const, reason: 'pending-change' };
  render(<NavigationPalette commands={[]} onClose={vi.fn()} panel={{ title: 'Bind model', content: <SheetModelControls
    models={[{ id: 'first', name: 'First', columns: [] }]} sheet={sheetDocument({ id: 's', name: 'Inputs' })}
    onBind={() => ({ result, completion: Promise.resolve(result) })} onUnbind={vi.fn()} onOpenDataModels={vi.fn()} /> }} />);
  const selector = screen.getByLabelText('Model for Inputs');
  fireEvent.change(selector, { target: { value: 'first' } });
  fireEvent.click(screen.getByRole('button', { name: 'Bind model' }));
  const confirm = screen.getByRole('button', { name: 'Confirm bind' });
  confirm.focus();
  fireEvent.click(confirm);
  expect(selector).toHaveFocus();
  expect(screen.getByRole('alert')).toHaveTextContent('Wait for the current');
});
