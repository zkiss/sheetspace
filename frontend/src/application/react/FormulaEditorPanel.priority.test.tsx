import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { keymap, type Binding } from '@shared/keyboard/keymap';
import type { FormulaInspectionReference } from '@workbook/formula/formulaInspectionContracts';
import { FormulaEditorPanel } from './FormulaEditorPanel';

const resolver = { currentSheetId: 'sheet', sheetByQualifier: () => undefined, coordinateAt: () => undefined, addressOf: () => undefined };
const reference: FormulaInspectionReference = {
  kind: 'reference', text: '@Source!A[1]', sourceSpan: { start: 5, end: 17 }, displaySpan: { start: 5, end: 17 },
  target: { kind: 'cell', sheetId: 'source' }, broken: false, navigable: true,
};
const raw = '=SUM(@Source!A[1],SU)';

describe('formula editor shortcut priority', () => {
  it.each(['reference', 'mode'] as const)('%s precedes competing completion and navigation controls', (action) => {
    for (const chosen of [false, true]) for (const collision of [false, true]) {
      const map = keymap as unknown as Record<string, Binding>;
      const originals = { ...map };
      const assertCompetition = () => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        expect(screen.queryByRole('option', { selected: true }) !== null).toBe(chosen);
      };
      const navigate = vi.fn(assertCompetition); const toggle = vi.fn(assertCompetition); const view = vi.fn(); const hover = vi.fn();
      const apply = vi.fn(); const cancel = vi.fn(); const commit = vi.fn(); const parent = vi.fn(); const change = vi.fn();
      function Editor() {
        const [value, setValue] = useState(raw);
        return <div onKeyDown={parent}><FormulaEditorPanel ariaLabel="Formula" autoFocus cellMode="light" raw={value} resolver={resolver} sheetNames={[]} inspectionReferences={[reference]}
          onRawChange={(next) => { change(next); setValue(next); }} onReferenceNavigate={navigate} onToggleMode={toggle} onReferenceHover={hover} onViewChange={view}
          onApply={apply} onCancel={cancel} onCommitAndNavigate={commit} /></div>;
      }
      const rendered = render(<Editor />);
      try {
        const input = screen.getByLabelText('Formula') as HTMLTextAreaElement;
        input.setSelectionRange(raw.length - 1, raw.length - 1);
        fireEvent.keyDown(input, { key: ' ', code: 'Space', ctrlKey: true });
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        if (chosen) fireEvent.keyDown(input, { key: 'ArrowDown' });
        expect(screen.queryByRole('option', { selected: true }) !== null).toBe(chosen);
        input.setSelectionRange(8, 8); input.scrollTop = 12;
        view.mockClear(); hover.mockClear(); parent.mockClear();
        if (collision) {
          map[action === 'reference' ? 'reference-navigate' : 'toggle-editor-mode'] = [{ key: 'F9' }];
          map['completion-accept'] = [{ key: 'F9' }]; map['completion-next'] = [{ key: 'F9' }]; map['editor-commit-down'] = [{ key: 'F9' }];
          if (action === 'reference') map['toggle-editor-mode'] = [{ key: 'F9' }];
        }
        expect(fireEvent.keyDown(input, { key: collision ? 'F9' : action === 'reference' ? 'F4' : 'F2' })).toBe(false);
        expect(view).toHaveBeenCalledWith({ start: 8, end: 8, scrollTop: 12 });
        if (action === 'reference') {
          expect(navigate).toHaveBeenCalledOnce(); expect(navigate).toHaveBeenCalledWith(reference); expect(hover).toHaveBeenCalledWith(null); expect(toggle).not.toHaveBeenCalled();
        } else {
          expect(toggle).toHaveBeenCalledOnce(); expect(navigate).not.toHaveBeenCalled(); expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        }
        expect(input).toHaveValue(raw); expect(change).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
        expect(apply).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled(); expect(parent).not.toHaveBeenCalled();
      } finally { rendered.unmount(); Object.assign(map, originals); }
    }
  });
});
