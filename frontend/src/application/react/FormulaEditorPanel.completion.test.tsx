import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FormulaReferenceResolver } from '@workbook/formula/reference';
import { FormulaEditorPanel } from './FormulaEditorPanel';

const resolver: FormulaReferenceResolver = {
  currentSheetId: 'sheet', sheetByQualifier: () => undefined, coordinateAt: () => undefined, addressOf: () => undefined,
};

function setup(mode: 'light' | 'heavy' | 'model') {
  const apply = vi.fn(); const cancel = vi.fn(); const commit = vi.fn(); const parent = vi.fn();
  function Editor() {
    const [raw, setRaw] = useState('=S');
    return <div onKeyDown={parent}><FormulaEditorPanel ariaLabel="Formula" autoFocus cellMode={mode === 'model' ? undefined : mode} onApply={apply} onCancel={cancel} onCommitAndNavigate={commit} onRawChange={setRaw} raw={raw} resolver={resolver} sheetNames={[]} /></div>;
  }
  render(<Editor />);
  const input = screen.getByLabelText('Formula') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: '=SU' } });
  return { input, apply, cancel, commit, parent };
}

describe('formula completion keyboard handling', () => {
  it.each(['light', 'heavy', 'model'] as const)('accepts a selected completion in %s with Enter or Tab', (mode) => {
    const { input, apply, cancel, commit, parent } = setup(mode);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.push(callback); return 1; });
    for (const key of ['Enter', 'Tab']) {
      if (key === 'Tab') { fireEvent.change(input, { target: { value: '=SU' } }); fireEvent.keyDown(input, { key: ' ', code: 'Space', ctrlKey: true }); }
      input.setSelectionRange(3, 3);
      expect(fireEvent.keyDown(input, { key: 'ArrowDown' })).toBe(false);
      expect(input.selectionStart).toBe(3);
      expect(fireEvent.keyDown(input, { key })).toBe(false);
      act(() => { for (const callback of frames.splice(0)) callback(0); });
      expect(input).toHaveValue('=SUM');
      expect(input.selectionStart).toBe(4);
      expect(input).toHaveFocus();
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    }
    expect(apply).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled(); expect(parent).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it.each(['light', 'heavy', 'model'] as const)('dismisses selected and unselected suggestions before normal Escape in %s', (mode) => {
    const { input, cancel } = setup(mode);
    input.setSelectionRange(1, 2);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('=SU'); expect(input.selectionStart).toBe(1); expect(input.selectionEnd).toBe(2); expect(input).toHaveFocus();
    expect(cancel).not.toHaveBeenCalled(); expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(cancel).toHaveBeenCalledTimes(mode === 'light' ? 1 : 0);
    fireEvent.keyDown(input, { key: ' ', code: 'Space', ctrlKey: true });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('=SU'); expect(input.selectionStart).toBe(1); expect(input.selectionEnd).toBe(2);
  });

  it.each(['Enter', 'Tab'])('retains light navigation for unselected %s', (key) => {
    const { input, commit } = setup('light');
    fireEvent.keyDown(input, { key });
    expect(commit).toHaveBeenCalledWith({ key, shift: false });
  });

  it.each(['light', 'heavy', 'model'] as const)('preserves modified commands in %s', (mode) => {
    const { input, apply, cancel } = setup(mode);
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(input, { key: 'Escape', metaKey: true });
    expect(apply).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(['heavy', 'model'] as const)('preserves ordinary unselected keys in %s', (mode) => {
    const { input, commit } = setup(mode);
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(false);
    expect(input).toHaveValue('  =SU');
    expect(commit).not.toHaveBeenCalled();
  });
});
