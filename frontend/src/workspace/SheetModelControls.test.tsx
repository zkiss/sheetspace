import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { SheetModelControls } from './SheetModelControls';

afterEach(() => cleanup());

const models = [{ id: 'first', name: 'First model', columns: [] }, { id: 'second', name: 'Second model', columns: [] }];

function renderControls(overrides: Partial<Parameters<typeof SheetModelControls>[0]> = {}) {
  const onBind = vi.fn(() => ({ ok: true }));
  const onUnbind = vi.fn(() => ({ ok: true }));
  const onOpenDataModels = vi.fn();
  const sheet = sheetDocument({ id: 'inputs', name: 'Inputs' });
  render(<SheetModelControls models={models} onBind={onBind} onOpenDataModels={onOpenDataModels} onUnbind={onUnbind} sheet={sheet} {...overrides} />);
  return { onBind, onOpenDataModels, onUnbind, sheet };
}

describe('SheetModelControls', () => {
  it('confirms binding and surfaces a rejected command without changing selection', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onBind = vi.fn(() => ({ ok: false, reason: 'pending-model-transition' }));
    const { sheet } = renderControls({ onBind });

    fireEvent.change(screen.getByLabelText('Model for Inputs'), { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bind model' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('declaration order'));
    expect(onBind).toHaveBeenCalledWith(sheet.id, 'first');
    expect(screen.getByRole('alert')).toHaveTextContent('Wait for the current data model change to finish.');
  });

  it('offers bound-model editing plus confirmed rebind and unbind actions', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const sheet = { ...sheetDocument({ id: 'inputs', name: 'Inputs' }), modelId: 'first' };
    const { onBind, onOpenDataModels, onUnbind } = renderControls({ sheet });

    fireEvent.click(screen.getByRole('button', { name: 'Edit model' }));
    fireEvent.change(screen.getByLabelText('Model for Inputs'), { target: { value: 'second' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rebind model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unbind model' }));

    expect(onOpenDataModels).toHaveBeenCalledOnce();
    expect(onBind).toHaveBeenCalledWith('inputs', 'second');
    expect(onUnbind).toHaveBeenCalledWith('inputs');
    expect(confirm).toHaveBeenNthCalledWith(1, expect.stringContaining('Rebinding'));
    expect(confirm).toHaveBeenNthCalledWith(2, expect.stringContaining('Unbinding'));
  });
});
