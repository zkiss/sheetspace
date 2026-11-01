import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DataModel } from '@workbook/core/model';
import { createModelEntryDraft } from '@application/core/modelEntryDraft';
import { ModelEntryRow } from './ModelEntryRow';

const model: DataModel = { id: 'm', name: 'Model', columns: [
  { id: 'value', name: 'Value', kind: 'manual', type: 'int' },
  { id: 'calculated', name: 'Calculated', kind: 'calculated', type: 'int', formula: '=1' },
] };
const commands = () => ({ change: vi.fn(), leave: vi.fn(), dismiss: vi.fn(), submit: vi.fn().mockResolvedValue({}) });
const session = () => ({ draft: createModelEntryDraft(model), pending: false });

describe('entry row boundaries', () => {
  it.each(['pending', 'stale'] as const)('does not submit while %s', (state) => {
    const actions = commands();
    render(<ModelEntryRow model={model} session={{ ...session(), [state]: true }} commands={actions} />);
    const cell = screen.getByRole('cell', { name: 'Value new record' });
    expect(cell).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(actions.submit).not.toHaveBeenCalled();
  });

  it('ignores duplicate submissions until the first finishes, then permits another', async () => {
    let resolve!: (value: object) => void;
    const actions = commands();
    actions.submit.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    render(<ModelEntryRow model={model} session={session()} commands={actions} />);
    const cell = screen.getByRole('cell', { name: 'Value new record' });
    fireEvent.keyDown(cell, { key: 'Enter' });
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(actions.submit).toHaveBeenCalledTimes(1);
    resolve({});
    await waitFor(() => { fireEvent.keyDown(cell, { key: 'Enter' }); expect(actions.submit).toHaveBeenCalledTimes(2); });
  });

  it('does not edit or clear a calculated cell, but still navigates from it', () => {
    const actions = commands();
    render(<ModelEntryRow model={model} session={session()} commands={actions} />);
    const calculated = screen.getByRole('cell', { name: 'Calculated calculated' });
    calculated.focus();
    fireEvent.doubleClick(calculated);
    for (const key of ['F2', 'x', 'Backspace', 'Delete']) fireEvent.keyDown(calculated, { key });
    expect(actions.change).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.keyDown(calculated, { key: 'ArrowLeft' });
    expect(screen.getByRole('cell', { name: 'Value new record' })).toHaveFocus();
  });

  it('places feedback above a cell near the viewport bottom and removes it on blur', async () => {
    const actions = commands();
    const state = session();
    const flagged = { ...state, draft: { ...state.draft, fields: { ...state.draft.fields, value: { raw: 'bad', invalid: true, message: 'Invalid value' } } } };
    render(<ModelEntryRow model={model} session={flagged} commands={actions} />);
    const cell = screen.getByRole('cell', { name: 'Value new record' });
    vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue({ left: -10, top: window.innerHeight - 20, bottom: window.innerHeight, right: 0, width: 10, height: 20, x: -10, y: window.innerHeight - 20, toJSON: () => ({}) });
    fireEvent.focus(cell);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveStyle({ left: '8px', top: `${window.innerHeight - 74}px` });
    fireEvent.blur(cell);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
