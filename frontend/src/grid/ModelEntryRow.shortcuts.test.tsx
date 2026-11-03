import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FormulaEditorPanel } from '@application/react/FormulaEditorPanel';
import { createModelEntryDraft } from '@application/core/modelEntryDraft';
import { keymap } from '@shared/keyboard/keymap';
import type { DataModel } from '@workbook/core/model';
import { ModelEntryRow } from './ModelEntryRow';

const model: DataModel = { id: 'm', name: 'Model', columns: [
  { id: 'value', name: 'Value', kind: 'manual', type: 'int' },
] };

describe.each([['MacIntel', 'metaKey', 'ctrlKey'], ['Linux', 'ctrlKey', 'metaKey']] as const)(
  'rebound entry actions on %s', (platform, native, foreign) => {
    it.each([
      ['entry-submit', 'F6', ['Enter']],
      ['entry-edit', 'F7', ['F2']],
      ['clear-cells', 'F8', ['Delete', 'Backspace']],
    ] as const)('executes only %s for its native chord', (action, key, originalKeys) => {
      const original = keymap[action];
      const platformOverride = vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
      Object.assign(keymap, { [action]: [{ key, mod: true }] });
      try {
        const commands = { change: vi.fn(), leave: vi.fn(), dismiss: vi.fn(), submit: vi.fn().mockResolvedValue({}) };
        const editorInteraction = { FormulaEditor: FormulaEditorPanel, cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() };
        const draft = createModelEntryDraft(model);
        draft.fields.value.raw = '42';
        render(<ModelEntryRow model={model} session={{ draft, pending: false }} commands={commands} editorInteraction={editorInteraction} sheetName="Sheet" />);
        const cell = screen.getByRole('cell', { name: 'Value new record' });
        cell.focus();

        for (const oldKey of originalKeys) fireEvent.keyDown(cell, { key: oldKey });
        fireEvent.keyDown(cell, { key, [foreign]: true });
        fireEvent.keyDown(cell, { key, [native]: true, shiftKey: true });
        expect(commands.submit).not.toHaveBeenCalled();
        expect(commands.change).not.toHaveBeenCalled();
        expect(commands.leave).not.toHaveBeenCalled();
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

        fireEvent.keyDown(cell, { key, [native]: true });
        expect(commands.submit).toHaveBeenCalledTimes(action === 'entry-submit' ? 1 : 0);
        expect(commands.change).toHaveBeenCalledTimes(action === 'clear-cells' ? 1 : 0);
        expect(commands.leave).toHaveBeenCalledTimes(action === 'clear-cells' ? 1 : 0);
        if (action === 'clear-cells') {
          expect(commands.change).toHaveBeenCalledWith('value', '');
          expect(commands.leave).toHaveBeenCalledWith('value');
        }
        if (action === 'entry-edit') expect(screen.getByRole('textbox', { name: 'Sheet Value editor' })).toBeInTheDocument();
        else expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      } finally {
        Object.assign(keymap, { [action]: original });
        platformOverride.mockRestore();
      }
    });
  },
);
