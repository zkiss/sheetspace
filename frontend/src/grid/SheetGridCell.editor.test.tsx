import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SheetGridCellEditor } from './SheetGridCellEditor';
import { testRect } from '@test-support/domGeometry';

afterEach(() => vi.restoreAllMocks());

function setup(draft = 'Draft') {
  const element = document.createElement('div');
  document.body.append(element);
  const anchor = { current: element };
  const measure = vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(testRect({ left: 40, top: 60, width: 90, height: 26 }));
  const interaction = { commit: vi.fn(), commitAndNavigate: vi.fn(), cancel: vi.fn(), suspend: vi.fn(), updateValue: vi.fn() };
  const editingCell = { target: { sheetId: 'inputs', cell: { rowId: 'r1', columnId: 'c1' } }, draft, sessionId: 1 };
  const component = (value: string) => <SheetGridCellEditor anchor={anchor} editingCell={{ ...editingCell, draft: value }} cellKey="A1" sheetName="Inputs" interaction={interaction} />;
  const view = render(component(draft));
  element.remove();
  const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
  return { ...view, editor, measure, interaction, editingCell, updateDraft: (value: string) => view.rerender(component(value)) };
}

describe('portal cell editor', () => {
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

  it.each(['Enter', 'Tab', 'Escape'])('finishes %s once without a blur re-commit', (key) => {
    const { editor, interaction } = setup();
    editor.setSelectionRange(2, 4);
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    fireEvent(editor, menu);
    expect(menu.defaultPrevented).toBe(false);
    expect(screen.getByRole('textbox')).toBe(editor);
    expect(editor).toHaveFocus();
    expect(editor).toHaveValue('Draft');
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 4]);
    for (const action of Object.values(interaction)) expect(action).not.toHaveBeenCalled();
    fireEvent.keyDown(editor, { key });
    fireEvent.blur(editor);
    expect(interaction.commit).not.toHaveBeenCalled();
    if (key === 'Escape') {
      expect(interaction.cancel).toHaveBeenCalledOnce();
      expect(interaction.commitAndNavigate).not.toHaveBeenCalled();
    } else {
      expect(interaction.commitAndNavigate).toHaveBeenCalledOnce();
      expect(interaction.cancel).not.toHaveBeenCalled();
    }
  });

  it('commits the live value only once on ordinary external blur', () => {
    const { editor, interaction, editingCell } = setup();
    editor.value = 'Updated';
    act(() => editor.blur());
    fireEvent.blur(editor);
    expect(interaction.commit).toHaveBeenCalledOnce();
    expect(interaction.commit).toHaveBeenCalledWith({
      ...editingCell, draft: 'Updated', selection: { start: 7, end: 7 }, scrollTop: 0,
    });
  });

  it.each(['cell', 'tab', 'dialog'])('suspends rather than commits when focus transfers to a marked workspace %s', (role) => {
    const { editor, interaction, editingCell } = setup();
    const destination = document.createElement('button');
    destination.setAttribute('role', role);
    destination.setAttribute('data-workspace-navigation', '');
    document.body.append(destination);

    fireEvent.blur(editor, { relatedTarget: destination });

    expect(interaction.suspend).toHaveBeenCalledWith({
      ...editingCell, selection: { start: 5, end: 5 }, scrollTop: 0,
    });
    expect(interaction.commit).not.toHaveBeenCalled();
    destination.remove();
  });

  it('suspends the live selection and scroll position for restoration after navigation', () => {
    const { editor, interaction, editingCell } = setup('first\nsecond\nthird');
    editor.setSelectionRange(2, 9);
    editor.scrollTop = 18;
    const destination = document.createElement('button');
    destination.setAttribute('role', 'cell');
    destination.setAttribute('data-workspace-navigation', '');
    document.body.append(destination);

    fireEvent.blur(editor, { relatedTarget: destination });

    expect(interaction.suspend).toHaveBeenCalledWith({
      ...editingCell, selection: { start: 2, end: 9 }, scrollTop: 18,
    });
    destination.remove();
  });
});
