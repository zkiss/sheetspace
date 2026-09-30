import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SheetGridCellEditor } from './SheetGridCellEditor';
import { testRect } from '@test-support/domGeometry';

afterEach(() => vi.restoreAllMocks());

function setup(draft = 'Draft') {
  const element = document.createElement('div');
  document.body.append(element);
  const anchor = { current: element };
  const measure = vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(testRect({ left: 40, top: 60, width: 90, height: 26 }));
  const interaction = { commit: vi.fn(), commitAndNavigate: vi.fn(), cancel: vi.fn(), updateValue: vi.fn() };
  const editingCell = { target: { sheetId: 'inputs', cell: { rowId: 'r1', columnId: 'c1' } }, draft };
  const component = (value: string) => <SheetGridCellEditor anchor={anchor} editingCell={{ ...editingCell, draft: value }} cellKey="A1" sheetName="Inputs" interaction={interaction} />;
  const view = render(component(draft));
  element.remove();
  const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
  return { ...view, editor, measure, interaction, editingCell, updateDraft: (value: string) => view.rerender(component(value)) };
}

describe('portal cell editor', () => {
  it('anchors immediately, tracks scrolling and transforms, and preserves focus and caret across drafts', () => {
    const { editor, measure, updateDraft } = setup();
    expect(editor).toHaveFocus();
    expect(editor).toHaveClass('sheet-grid-cell-editor');
    expect(editor).toHaveStyle({ left: '40px', top: '60px', height: '26px' });
    expect(editor.selectionStart).toBe(5);
    editor.setSelectionRange(2, 2);
    updateDraft('Draft');
    expect(editor.selectionStart).toBe(2);
    measure.mockReturnValue(testRect({ left: 70, top: 100, width: 180, height: 52 }));
    fireEvent.scroll(window);
    expect(editor).toHaveStyle({ left: '70px', top: '100px', height: '52px' });
    expect(editor).toHaveFocus();
    expect(editor.style.width).toContain('180px');
    measure.mockReturnValue(testRect({ left: 70, top: 100, width: 200, height: 52 }));
    fireEvent.resize(window);
    expect(editor.style.width).toContain('200px');
    measure.mockReturnValue(testRect({ left: 70, top: 100, width: 200, height: 60 }));
    fireEvent.resize(window);
    expect(editor).toHaveStyle({ height: '60px' });
  });

  it('grows and shrinks to content within the maximum, keeping long drafts scrollable', () => {
    const { editor, updateDraft } = setup();
    Object.defineProperty(editor, 'scrollHeight', { configurable: true, value: 300 });
    Object.defineProperty(editor, 'scrollWidth', { configurable: true, value: 500 });
    updateDraft('a\nb\nc');
    expect(editor).toHaveStyle({ height: '112px', overflowY: 'auto', overflowX: 'auto' });
    Object.defineProperty(editor, 'scrollHeight', { configurable: true, value: 30 });
    updateDraft('short');
    expect(editor).toHaveStyle({ height: '30px', overflowY: 'hidden' });
  });

  it('inserts a newline at the selected caret only for Shift+Enter', () => {
    const { editor, interaction } = setup('first second');
    editor.setSelectionRange(5, 6);
    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true });
    expect(interaction.updateValue).toHaveBeenCalledWith('first\nsecond');
    expect(editor.selectionStart).toBe(6);
    for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { ctrlKey: true, shiftKey: true }]) {
      const event = createEvent.keyDown(editor, { key: 'Enter', ...modifiers });
      fireEvent(editor, event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(interaction.updateValue).toHaveBeenCalledOnce();
    expect(interaction.commitAndNavigate).not.toHaveBeenCalled();
  });

  it.each(['Enter', 'Tab', 'Escape'])('finishes %s once without a blur re-commit', (key) => {
    const { editor, interaction } = setup();
    fireEvent.keyDown(editor, { key });
    fireEvent.blur(editor);
    expect(interaction.commit).not.toHaveBeenCalled();
    if (key === 'Escape') expect(interaction.cancel).toHaveBeenCalledOnce();
    else expect(interaction.commitAndNavigate).toHaveBeenCalledOnce();
  });

  it('commits the live value only once on ordinary external blur', () => {
    const { editor, interaction, editingCell } = setup();
    editor.value = 'Updated';
    act(() => editor.blur());
    fireEvent.blur(editor);
    expect(interaction.commit).toHaveBeenCalledOnce();
    expect(interaction.commit).toHaveBeenCalledWith({ ...editingCell, draft: 'Updated' });
  });
});
