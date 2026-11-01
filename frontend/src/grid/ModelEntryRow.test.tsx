import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FormulaEditorPanel } from '@application/react/FormulaEditorPanel';
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
  const editorInteraction = { FormulaEditor: FormulaEditorPanel, cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() };
  const view = render(<ModelEntryRow model={model} session={session} commands={commands} editorInteraction={editorInteraction} sheetName="Sheet" />);
  return { commands, session, editorInteraction, ...view };
}
const cell = (name: string) => screen.getByRole('cell', { name });

describe('model entry row', () => {
  it.each([['calculated-only', [model.columns[1]]], ['empty', []]])('provides a save control for a %s model', async (_name, columns) => {
    const entryModel = { ...model, columns };
    const commands = { change: vi.fn(), leave: vi.fn(), dismiss: vi.fn(), submit: vi.fn().mockResolvedValue({}) };
    const session = { draft: createModelEntryDraft(entryModel), pending: false };
    const { rerender } = render(<ModelEntryRow model={entryModel} session={session} commands={commands} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save record' }));
    expect(commands.submit).toHaveBeenCalledOnce();
    rerender(<ModelEntryRow model={entryModel} session={{ ...session, pending: true }} commands={commands} />);
    expect(screen.getByRole('button', { name: 'Save record' })).toBeDisabled();
  });

  it('navigates all cells without submitting and hands upward movement to the grid', () => {
    const onNavigateUp = vi.fn();
    const { commands, session, editorInteraction, rerender } = setup();
    rerender(<ModelEntryRow model={model} session={session} commands={commands} editorInteraction={editorInteraction} onNavigateUp={onNavigateUp} />);
    const price = cell('Price new record'); const total = cell('Total calculated'); const quantity = cell('Quantity new record');
    expect(screen.getByRole('rowheader', { name: 'New record row' })).toHaveTextContent('+');
    expect(total).toHaveAttribute('aria-readonly', 'true');
    price.focus(); fireEvent.keyDown(price, { key: 'ArrowLeft' }); expect(price).toHaveFocus();
    fireEvent.keyDown(price, { key: 'Tab' }); expect(total).toHaveFocus();
    fireEvent.keyDown(total, { key: 'ArrowRight' }); expect(quantity).toHaveFocus();
    fireEvent.keyDown(quantity, { key: 'ArrowRight' }); expect(quantity).toHaveFocus();
    fireEvent.keyDown(quantity, { key: 'ArrowUp' }); expect(onNavigateUp).toHaveBeenCalledWith(2);
    expect(commands.submit).not.toHaveBeenCalled();
  });

  it('edits with the shared editor and cancels back to the original draft', async () => {
    const { commands } = setup();
    const price = cell('Price new record'); price.focus();
    fireEvent.keyDown(price, { key: 'F2' });
    const editor = await screen.findByRole('textbox', { name: 'Sheet Price editor' });
    fireEvent.change(editor, { target: { value: '42' } });
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(commands.change).toHaveBeenLastCalledWith('price', '');
    expect(commands.leave).toHaveBeenCalledWith('price');
    await waitFor(() => expect(price).toHaveFocus());
  });

  it('commits an edited draft and navigates without admitting it', async () => {
    const { commands } = setup();
    const price = cell('Price new record'); price.focus();
    fireEvent.keyDown(price, { key: '7' });
    const editor = await screen.findByRole('textbox', { name: 'Sheet Price editor' });
    fireEvent.change(editor, { target: { value: '72' } });
    fireEvent.keyDown(editor, { key: 'Tab' });
    await waitFor(() => expect(cell('Total calculated')).toHaveFocus());
    expect(commands.change).toHaveBeenLastCalledWith('price', '72');
    expect(commands.leave).toHaveBeenCalledWith('price');
    expect(commands.submit).not.toHaveBeenCalled();
  });

  it.each([
    ['Quantity new record', 'Sheet Quantity editor', 'quantity', false],
    ['Price new record', 'Sheet Price editor', 'price', true],
  ])('keeps focus on the boundary cell after editing %s with Tab', async (name, editorName, id, shiftKey) => {
    const { commands } = setup();
    const boundary = cell(name); boundary.focus();
    fireEvent.keyDown(boundary, { key: 'F2' });
    const editor = await screen.findByRole('textbox', { name: editorName });
    fireEvent.change(editor, { target: { value: '42' } });
    fireEvent.keyDown(editor, { key: 'Tab', shiftKey });
    await waitFor(() => expect(boundary).toHaveFocus());
    expect(commands.change).toHaveBeenLastCalledWith(id, '42');
    expect(commands.leave).toHaveBeenCalledWith(id);
    expect(commands.submit).not.toHaveBeenCalled();
  });

  it('submits on Enter and focuses the first invalid cell', async () => {
    const { commands } = setup();
    const price = cell('Price new record'); price.focus(); fireEvent.keyDown(price, { key: 'Enter' });
    await waitFor(() => expect(cell('Quantity new record')).toHaveFocus());
    expect(commands.submit).toHaveBeenCalledOnce();
  });

  it('shows validation only for the selected invalid cell and preserves its value', async () => {
    const { commands, session, editorInteraction, rerender } = setup();
    const flagged = { ...session, draft: { ...session.draft, fields: { ...session.draft.fields, price: { raw: 'bad', invalid: true, message: 'Invalid price' } } } };
    rerender(<ModelEntryRow model={model} session={flagged} commands={commands} editorInteraction={editorInteraction} />);
    const price = cell('Price new record');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.focus(price); expect(await screen.findByRole('alert')).toHaveTextContent('Invalid price');
    expect(price).toHaveAttribute('aria-invalid', 'true'); expect(price).toHaveTextContent('bad');
    fireEvent.blur(price); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers retry and prevents entry while an admission is uncertain', () => {
    const { commands, session, rerender } = setup();
    rerender(<ModelEntryRow model={model} session={{ ...session, retryRequired: true, failure: 'Connection lost' }} commands={commands} />);
    expect(cell('Price new record')).toHaveAttribute('tabindex', '-1');
    fireEvent.click(screen.getByRole('button', { name: 'Retry saving record' }));
    expect(commands.submit).toHaveBeenCalledOnce();
  });

  it('keeps clipboard events from reaching the surrounding grid', () => {
    const onCopy = vi.fn(); const onCut = vi.fn(); const onPaste = vi.fn();
    const commands = { change: vi.fn(), leave: vi.fn(), dismiss: vi.fn(), submit: vi.fn().mockResolvedValue({}) };
    render(<div onCopy={onCopy} onCut={onCut} onPaste={onPaste}><ModelEntryRow model={model} session={{ draft: createModelEntryDraft(model), pending: false }} commands={commands} /></div>);
    const price = cell('Price new record'); fireEvent.copy(price); fireEvent.cut(price); fireEvent.paste(price);
    expect(onCopy).not.toHaveBeenCalled(); expect(onCut).not.toHaveBeenCalled(); expect(onPaste).not.toHaveBeenCalled();
  });
});
