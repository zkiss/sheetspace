import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FormulaEditorPanel } from '@application/react/FormulaEditorPanel';
import { changeEntryField, createModelEntryDraft, dismissEntryFeedback, leaveEntryField } from '@application/core/modelEntryDraft';
import { createEmptyWorkbook } from '@workbook/mutations/operations';
import type { DataModel } from '@workbook/core/model';
import { ModelEntryRow } from './ModelEntryRow';

const model: DataModel = { id: 'm', name: 'Model', columns: [
  { id: 'first', name: 'First', kind: 'manual', type: 'int' },
  { id: 'middle', name: 'Middle', kind: 'manual', type: 'int' },
  { id: 'calc', name: 'Calc', kind: 'calculated', type: 'int', formula: '=1' },
  { id: 'last', name: 'Last', kind: 'manual', type: 'int' },
] };
const workbook = createEmptyWorkbook();
const editorInteraction = { FormulaEditor: FormulaEditorPanel, cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() };

function setup() {
  const dismiss = vi.fn();
  const submit = vi.fn().mockResolvedValue({});
  function Harness() {
    const [draft, setDraft] = useState(() => {
      let next = createModelEntryDraft(model);
      for (const id of ['first', 'middle', 'last']) {
        next = changeEntryField(next, model, id, 'bad', workbook, 'sheet');
        next = leaveEntryField(next, model, id, workbook, 'sheet');
      }
      return next;
    });
    return <><button>Before</button><ModelEntryRow model={model} session={{ draft, pending: false }} sheetName="Sheet" editorInteraction={editorInteraction} commands={{
      change: (id, raw) => setDraft((current) => changeEntryField(current, model, id, raw, workbook, 'sheet')),
      leave: (id) => setDraft((current) => leaveEntryField(current, model, id, workbook, 'sheet')),
      dismiss: (id) => { dismiss(id); setDraft((current) => dismissEntryFeedback(current, id)); }, submit,
    }} /><button>After</button></>;
  }
  render(<Harness />);
  return { user: userEvent.setup(), dismiss, submit };
}
const cell = (name: string) => screen.getByRole('cell', { name: `${name} new record` });

describe('entry validation keyboard access', () => {
  it.each([['First', 'first'], ['Middle', 'middle'], ['Last', 'last']])('dismisses %s feedback without changing its draft or focus', async (name, id) => {
    const { user, dismiss, submit } = setup();
    const target = cell(name);
    await user.click(target);
    expect(await screen.findByRole('alert')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(dismiss).toHaveBeenCalledWith(id);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(target).toHaveFocus();
    expect(target).toHaveAttribute('aria-selected', 'true');
    expect(target).toHaveAttribute('aria-invalid', 'true');
    expect(target).toHaveTextContent('bad');
    expect(submit).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('keeps Tab and arrow navigation and revalidates a dismissed draft on leaving', async () => {
    const { user, submit } = setup();
    await user.click(cell('Middle'));
    await user.keyboard('{Escape}{Tab}');
    expect(screen.getByRole('cell', { name: 'Calc calculated' })).toHaveFocus();
    await user.keyboard('{Escape}{Shift>}{Tab}{/Shift}');
    expect(cell('Middle')).toHaveFocus();
    expect(await screen.findByRole('alert')).toBeVisible();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(cell('Last')).toHaveFocus();
    expect(cell('Middle')).toHaveTextContent('bad');
    expect(submit).not.toHaveBeenCalled();
  });

  it('allows native Tab exit at both row boundaries', async () => {
    const { user } = setup();
    await user.click(cell('First'));
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus();
    await user.click(cell('Last'));
    await user.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  it('lets the actual editor cancel before the cell dismisses feedback', async () => {
    const { user, dismiss } = setup();
    const target = cell('Middle');
    await user.click(target);
    await user.keyboard('{F2}');
    const editor = await screen.findByRole('textbox', { name: 'Sheet Middle editor' });
    await user.clear(editor);
    await user.type(editor, '123');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(target).toHaveFocus());
    expect(dismiss).not.toHaveBeenCalled();
    expect(target).toHaveTextContent('bad');
    expect(await screen.findByRole('alert')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(dismiss).toHaveBeenCalledWith('middle');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('dismisses by clicking feedback while editing and returns focus to the cell', async () => {
    const { user, dismiss } = setup();
    const target = cell('Middle');
    await user.click(target);
    await user.keyboard('{F2}');
    await screen.findByRole('textbox', { name: 'Sheet Middle editor' });
    await user.click(await screen.findByRole('button', { name: 'Dismiss (Esc)' }));
    await waitFor(() => expect(target).toHaveFocus());
    expect(dismiss).toHaveBeenCalledWith('middle');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(target).toHaveTextContent('bad');
  });
});
