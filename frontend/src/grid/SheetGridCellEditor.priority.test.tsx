import { FormulaEditorPanel } from '@application/react/FormulaEditorPanel';
import { keymap, type Binding } from '@shared/keyboard/keymap';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SheetGridCellEditor } from './SheetGridCellEditor';
import type { FormulaInspectionReference } from '@workbook/formula/formulaInspectionContracts';

const reference: FormulaInspectionReference = { kind: 'reference', text: '@Source!A[1]', sourceSpan: { start: 5, end: 17 }, displaySpan: { start: 5, end: 17 }, target: { kind: 'cell', sheetId: 'source' }, broken: false, navigable: true };
const raw = '=SUM(@Source!A[1],SU)';

describe('portal editor shortcut priority wiring', () => {
  it.each(['mode', 'reference'] as const)('routes a rebound %s action before chosen completion or commit', (action) => {
    const map = keymap as unknown as Record<string, Binding>; const originals = { ...map };
    const element = document.createElement('div'); document.body.append(element);
    const navigate = vi.fn(); const updateView = vi.fn();
    const interaction = { FormulaEditor: FormulaEditorPanel, commit: vi.fn(), commitAndNavigate: vi.fn(), cancel: vi.fn(), suspend: vi.fn(), updateValue: vi.fn(), updateView,
      formulaContext: { resolver: { currentSheetId: 'inputs', sheetByQualifier: () => undefined, coordinateAt: () => undefined, addressOf: () => undefined }, sheetNames: [], inspectionReferences: [reference], onReferenceNavigate: navigate } };
    const editingCell = { target: { sheetId: 'inputs', cell: { rowId: 'r1', columnId: 'c1' } }, draft: raw, sessionId: 1 };
    const rendered = render(<SheetGridCellEditor anchor={{ current: element }} editingCell={editingCell} cellKey="A1" sheetName="Inputs" interaction={interaction} />);
    try {
      const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
      editor.setSelectionRange(raw.length - 1, raw.length - 1);
      fireEvent.keyDown(editor, { key: ' ', code: 'Space', ctrlKey: true });
      fireEvent.keyDown(editor, { key: 'ArrowDown' });
      expect(screen.getByRole('option', { selected: true })).toBeInTheDocument();
      editor.setSelectionRange(8, 8); editor.scrollTop = 12; updateView.mockClear();
      map[action === 'mode' ? 'toggle-editor-mode' : 'reference-navigate'] = [{ key: 'F9' }];
      map['completion-accept'] = [{ key: 'F9' }]; map['editor-commit-down'] = [{ key: 'F9' }];
      expect(fireEvent.keyDown(editor, { key: 'F9' })).toBe(false);
      expect(editor).toHaveValue(raw); expect(interaction.updateValue).not.toHaveBeenCalled();
      expect(interaction.commit).not.toHaveBeenCalled(); expect(interaction.commitAndNavigate).not.toHaveBeenCalled(); expect(interaction.cancel).not.toHaveBeenCalled();
      expect(updateView).toHaveBeenCalledWith({ start: 8, end: 8 }, 12, editingCell);
      if (action === 'mode') {
        expect(editor.closest('[data-editor-mode]')).toHaveAttribute('data-editor-mode', 'heavy');
        expect(screen.getByRole('textbox')).toBe(editor); expect(editor).toHaveFocus(); expect(editor.selectionStart).toBe(8);
        expect(interaction.suspend).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
      } else {
        expect(interaction.suspend).toHaveBeenCalledOnce();
        expect(interaction.suspend).toHaveBeenCalledWith({ ...editingCell, selection: { start: 8, end: 8 }, scrollTop: 12 });
        expect(navigate).toHaveBeenCalledWith(reference);
        expect(interaction.suspend.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0]);
        fireEvent.blur(editor); expect(interaction.commit).not.toHaveBeenCalled();
      }
    } finally { rendered.unmount(); element.remove(); Object.assign(map, originals); }
  });
});
