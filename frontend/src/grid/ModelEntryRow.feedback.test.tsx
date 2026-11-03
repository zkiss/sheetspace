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

function setup(middleRaw = 'bad') {
  const dismiss = vi.fn();
  const submit = vi.fn().mockResolvedValue({});
  function Harness() {
    const [draft, setDraft] = useState(() => {
      let next = createModelEntryDraft(model);
      for (const id of ['first', 'middle', 'last']) {
        next = changeEntryField(next, model, id, id === 'middle' ? middleRaw : 'bad', workbook, 'sheet');
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

  it('dismisses completion before cancelling the light editor or dismissing cell feedback', async () => {
    const { user, dismiss, submit } = setup('=SU');
    const target = cell('Middle');
    await user.click(target);
    await user.keyboard('{F2}');
    const editor = await screen.findByRole('textbox', { name: 'Sheet Middle editor' });
    await user.keyboard('{Control>} {/Control}');
    expect(await screen.findByRole('listbox', { name: 'Formula completions' })).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox', { name: 'Formula completions' })).not.toBeInTheDocument();
    expect(editor).toHaveFocus();
    expect(editor).toHaveValue('=SU');
    expect(screen.getByRole('alert')).toBeVisible();
    expect(dismiss).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(target).toHaveFocus());
    expect(target).toHaveTextContent('=SU');
    expect(dismiss).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(dismiss).toHaveBeenCalledWith('middle');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(target).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();
  });

  it('keeps heavy editor Escape and Tab ownership until Ctrl+Escape cancels', async () => {
    const modifier = 'Control';
    const { user, dismiss, submit } = setup();
    const target = cell('Middle');
    await user.click(target);
    await user.keyboard('{F2}{F2}');
    const editor = await screen.findByRole('textbox', { name: 'Sheet Middle editor' });
    expect(editor.closest('[data-editor-mode]')).toHaveAttribute('data-editor-mode', 'heavy');
    await user.keyboard('{Escape}');
    expect(editor).toHaveFocus();
    expect(editor).toHaveValue('bad');
    expect(screen.getByRole('alert')).toBeVisible();
    expect(dismiss).not.toHaveBeenCalled();
    await user.keyboard('{Tab}');
    expect(editor).toHaveFocus();
    expect(editor).toHaveValue('  bad');
    expect(dismiss).not.toHaveBeenCalled();
    await user.keyboard(`{${modifier}>}{Escape}{/${modifier}}`);
    await waitFor(() => expect(target).toHaveFocus());
    expect(target).toHaveTextContent('bad');
    expect(screen.getByRole('alert')).toBeVisible();
    expect(dismiss).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(dismiss).toHaveBeenCalledWith('middle');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(target).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();
  });

  it('dismisses by clicking feedback while editing and returns focus to the cell', async () => {
    const { user, dismiss } = setup();
    const target = cell('Middle');
    await user.click(target);
    await user.keyboard('{F2}');
    await screen.findByRole('textbox', { name: 'Sheet Middle editor' });
    await user.click(await screen.findByRole('button', { name: 'Dismiss (Escape)' }));
    await waitFor(() => expect(target).toHaveFocus());
    expect(dismiss).toHaveBeenCalledWith('middle');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(target).toHaveTextContent('bad');
  });
});

it.each([['MacIntel', '⌘+Shift+K', 'Meta+Shift+K'], ['Linux', 'Ctrl+Shift+K', 'Control+Shift+K']])('derives feedback hint and ARIA from the %s binding', async (platform, label, aria) => {
  const { keymap } = await import('@shared/keyboard/keymap');
  const original = keymap.cancel;
  Object.assign(keymap, { cancel: [{ key: 'k', mod: true, shift: true }] });
  const platformOverride = vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
  try {
    const { user, dismiss } = setup();
    await user.click(cell('Middle'));
    expect(await screen.findByRole('button', { name: `Dismiss (${label})` })).toHaveAttribute('aria-keyshortcuts', aria);
    await user.keyboard(platform === 'MacIntel' ? '{Control>}{Shift>}k{/Shift}{/Control}' : '{Meta>}{Shift>}k{/Shift}{/Meta}');
    expect(dismiss).not.toHaveBeenCalled();
    await user.keyboard(platform === 'MacIntel' ? '{Meta>}{Shift>}k{/Shift}{/Meta}' : '{Control>}{Shift>}k{/Shift}{/Control}');
    expect(dismiss).toHaveBeenCalledWith('middle');
  } finally { Object.assign(keymap, { cancel: original }); platformOverride.mockRestore(); }
});
