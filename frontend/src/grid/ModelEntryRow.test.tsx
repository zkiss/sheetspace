import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DataModel } from '@workbook/core/model';
import { createModelEntryDraft } from '@application/core/modelEntryDraft';
import { ModelEntryRow } from './ModelEntryRow';

const model: DataModel = { id: 'm', name: 'Model', columns: [
  { id: 'price', name: 'Price', kind: 'manual', type: 'int' },
  { id: 'total', name: 'Total', kind: 'calculated', type: 'float', formula: '=1' },
  { id: 'quantity', name: 'Quantity', kind: 'manual', type: 'int' },
] };

function setup() {
  const commands = { change: vi.fn(), leave: vi.fn(), dismiss: vi.fn(), submit: vi.fn().mockResolvedValue({ firstInvalid: 'quantity' }) };
  const session = { draft: createModelEntryDraft(model), pending: false };
  const view = render(<ModelEntryRow model={model} session={session} commands={commands} />);
  return { commands, session, ...view };
}

describe('model entry row', () => {
  it('renders editable manual fields and a noneditable calculated cell', () => {
    setup();
    expect(screen.getByRole('row', { name: 'New record' })).toBeInTheDocument();
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(screen.getByRole('cell', { name: 'Total calculated' })).toBeInTheDocument();
  });

  it('routes changes and blur without submitting and focuses the first invalid field on Enter', async () => {
    const { commands } = setup();
    const price = screen.getByRole('textbox', { name: 'Price new record' });
    fireEvent.change(price, { target: { value: 'bad' } });
    fireEvent.blur(price);
    fireEvent.keyDown(price, { key: 'Tab' });
    expect(commands.change).toHaveBeenCalledWith('price', 'bad');
    expect(commands.leave).toHaveBeenCalledWith('price');
    expect(commands.submit).not.toHaveBeenCalled();
    fireEvent.keyDown(price, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Quantity new record' })).toHaveFocus());
  });

  it('renders and dismisses feedback without discarding the invalid value', () => {
    const { commands, session, rerender } = setup();
    const flagged = { ...session, draft: { ...session.draft, fields: { ...session.draft.fields, price: { raw: 'bad', invalid: true, message: 'Enter a valid int value.' } } } };
    rerender(<ModelEntryRow model={model} session={flagged} commands={commands} />);
    expect(screen.getByRole('textbox', { name: 'Price new record' })).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Price validation' }));
    expect(commands.dismiss).toHaveBeenCalledWith('price');
    expect(screen.getByRole('textbox', { name: 'Price new record' })).toHaveValue('bad');
    const dismissed = { ...flagged, draft: { ...flagged.draft, fields: { ...flagged.draft.fields, price: { raw: 'bad', invalid: true } } } };
    rerender(<ModelEntryRow model={model} session={dismissed} commands={commands} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Price new record' })).toHaveClass('model-entry-invalid');
    const corrected = { ...dismissed, draft: { ...dismissed.draft, fields: { ...dismissed.draft.fields, price: { raw: '2', invalid: false } } } };
    rerender(<ModelEntryRow model={model} session={corrected} commands={commands} />);
    expect(screen.getByRole('textbox', { name: 'Price new record' })).not.toHaveClass('model-entry-invalid');
  });

  it('offers a retry when an admission outcome is uncertain', async () => {
    const { commands, session, rerender } = setup();
    rerender(<ModelEntryRow model={model} session={{ ...session, retryRequired: true, failure: 'Connection lost' }} commands={commands} />);
    expect(screen.getByRole('textbox', { name: 'Price new record' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry saving record' }));
    await waitFor(() => expect(commands.submit).toHaveBeenCalledOnce());
  });

  it('navigates manual fields in both directions without submitting, even with feedback', () => {
    const { commands, session, rerender } = setup();
    const flagged = { ...session, draft: { ...session.draft, fields: { ...session.draft.fields, price: { raw: 'bad', invalid: true, message: 'Invalid' } } } };
    rerender(<ModelEntryRow model={model} session={flagged} commands={commands} />);
    const price = screen.getByRole('textbox', { name: 'Price new record' });
    const quantity = screen.getByRole('textbox', { name: 'Quantity new record' });
    price.focus();
    fireEvent.keyDown(price, { key: 'Tab' });
    expect(quantity).toHaveFocus();
    fireEvent.keyDown(quantity, { key: 'Tab', shiftKey: true });
    expect(price).toHaveFocus();
    expect(commands.submit).not.toHaveBeenCalled();
  });

  it('keeps native clipboard events from reaching the surrounding grid', () => {
    const onCopy = vi.fn(); const onCut = vi.fn(); const onPaste = vi.fn();
    const commands = { change: vi.fn(), leave: vi.fn(), dismiss: vi.fn(), submit: vi.fn().mockResolvedValue({}) };
    render(<div onCopy={onCopy} onCut={onCut} onPaste={onPaste}><ModelEntryRow model={model} session={{ draft: createModelEntryDraft(model), pending: false }} commands={commands} /></div>);
    const input = screen.getByRole('textbox', { name: 'Price new record' });
    fireEvent.copy(input); fireEvent.cut(input); fireEvent.paste(input);
    expect(onCopy).not.toHaveBeenCalled(); expect(onCut).not.toHaveBeenCalled(); expect(onPaste).not.toHaveBeenCalled();
  });
});
