import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '@test-support/apiClients';
import { sheetDocument } from '@test-support/workbookFactories';
import { SheetModelControls } from './SheetModelControls';

afterEach(() => cleanup());

const models = [{ id: 'first', name: 'First model', columns: [] }, { id: 'second', name: 'Second model', columns: [] }];

type CommandResult = { ok: true } | { ok: false; reason: string };

function submission(result: CommandResult, completion: Promise<CommandResult> = Promise.resolve(result)) {
  return { result, completion };
}

function renderControls(overrides: Partial<Parameters<typeof SheetModelControls>[0]> = {}) {
  const onBind = vi.fn(() => submission({ ok: true }));
  const onUnbind = vi.fn(() => submission({ ok: true }));
  const onOpenDataModels = vi.fn();
  const sheet = sheetDocument({ id: 'inputs', name: 'Inputs' });
  render(<SheetModelControls models={models} onBind={onBind} onOpenDataModels={onOpenDataModels} onUnbind={onUnbind} sheet={sheet} {...overrides} />);
  return { onBind, onOpenDataModels, onUnbind, sheet };
}

describe('SheetModelControls', () => {
  it('confirms binding and surfaces a rejected command without changing selection', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onBind = vi.fn(() => submission({ ok: false, reason: 'pending-model-transition' }));
    const { sheet } = renderControls({ onBind });

    fireEvent.change(screen.getByLabelText('Model for Inputs'), { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bind model' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('declaration order'));
    expect(onBind).toHaveBeenCalledWith(sheet.id, 'first');
    expect(screen.getByRole('alert')).toHaveTextContent('Wait for the current data model change to finish.');
  });

  it('reports a command that was not applied instead of presenting a success', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onBind = vi.fn(() => submission({ ok: false, reason: 'unknown-model' }));
    renderControls({ onBind });

    fireEvent.change(screen.getByLabelText('Model for Inputs'), { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bind model' }));

    expect(screen.getByRole('alert')).toHaveTextContent('The data model change was not applied.');
  });

  it('opens the bound model for editing and confirms rebind and unbind actions', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const sheet = { ...sheetDocument({ id: 'inputs', name: 'Inputs' }), modelId: 'first' };
    const { onBind, onOpenDataModels, onUnbind } = renderControls({ sheet });

    fireEvent.click(screen.getByRole('button', { name: 'Edit model' }));
    fireEvent.change(screen.getByLabelText('Model for Inputs'), { target: { value: 'second' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rebind model' }));
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Unbind model' }));

    expect(onOpenDataModels).toHaveBeenCalledWith('first');
    expect(onBind).toHaveBeenCalledWith('inputs', 'second');
    expect(onUnbind).toHaveBeenCalledWith('inputs');
    expect(confirm).toHaveBeenNthCalledWith(1, expect.stringContaining('Rebinding'));
    expect(confirm).toHaveBeenNthCalledWith(2, expect.stringContaining('Unbinding'));
  });

  it('reports a rejected persistence outcome and keeps the binding retryable', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const completion = deferred<CommandResult>();
    const onBind = vi.fn(() => submission({ ok: true }, completion.promise));
    const { sheet } = renderControls({ onBind });

    fireEvent.change(screen.getByLabelText('Model for Inputs'), { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bind model' }));

    expect(screen.getByText('Saving data model change…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bind model' })).toBeDisabled();
    await act(async () => { completion.resolve({ ok: false, reason: 'persistence-failed' }); });

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The data model change was not saved.'));
    expect(screen.getByRole('button', { name: 'Bind model' })).toBeEnabled();
    expect(screen.getByLabelText('Model for Inputs')).toHaveValue('first');

    fireEvent.click(screen.getByRole('button', { name: 'Bind model' }));
    expect(onBind).toHaveBeenCalledTimes(2);
    expect(onBind).toHaveBeenLastCalledWith(sheet.id, 'first');
  });

  it('names a bound model that is no longer declared', () => {
    const sheet = { ...sheetDocument({ id: 'inputs', name: 'Inputs' }), modelId: 'missing' };
    renderControls({ models: [], sheet });

    expect(screen.getByLabelText('Bound to data model')).toHaveTextContent('Bound: data model');
  });
});
