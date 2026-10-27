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
  it('tracks anchor scroll and resize without replacing the focused input or moving its caret', () => {
    const { editor, measure, updateDraft } = setup();
    const panel = editor.closest<HTMLElement>('.formula-editor-panel')!;
    expect(panel).toHaveStyle({ left: '40px', top: '60px' });
    editor.setSelectionRange(2, 2);
    updateDraft('Draft');
    measure.mockReturnValue(testRect({ left: 70, top: 100, width: 180, height: 52 }));
    fireEvent.scroll(window);
    expect(panel).toHaveStyle({ left: '70px', top: '100px' });
    expect(panel.style.width).toContain('180px');
    expect(editor).toHaveStyle({ height: '52px' });
    measure.mockReturnValue(testRect({ left: 80, top: 110, width: 200, height: 60 }));
    fireEvent.resize(window);
    expect(panel).toHaveStyle({ left: '80px', top: '110px' });
    expect(panel.style.width).toContain('200px');
    expect(editor).toHaveStyle({ height: '60px' });
    expect(screen.getByRole('textbox')).toBe(editor);
    expect(editor).toHaveFocus();
    expect(editor.selectionStart).toBe(2);
  });

  it('keeps syntax overlay text and scroll aligned with the shared input', () => {
    const draft = `=SUM(@A[1], ${'value '.repeat(40)})\nsecond`;
    const { editor, updateDraft } = setup(draft);
    const highlight = document.querySelector<HTMLElement>('.formula-editor-highlight')!;
    expect(highlight.textContent).toBe(`${draft}\u200b`);
    editor.scrollTop = 48;
    editor.scrollLeft = 32;
    fireEvent.scroll(editor);
    expect(highlight.scrollTop).toBe(48);
    expect(highlight.scrollLeft).toBe(32);
    for (const next of ['', 'x', 'first\nsecond\n', '\tindented']) {
      updateDraft(next);
      expect(highlight.textContent).toBe(`${next}\u200b`);
      expect(highlight.scrollTop).toBe(editor.scrollTop);
      expect(highlight.scrollLeft).toBe(editor.scrollLeft);
    }
  });

  it.each([true, false])('light Enter accepts only an arrow-selected completion (selected: %s)', (selected) => {
    const { editor, interaction, updateDraft } = setup('=S');
    fireEvent.change(editor, { target: { value: '=SU' } });
    updateDraft('=SU');
    interaction.updateValue.mockClear();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    if (selected) fireEvent.keyDown(editor, { key: 'ArrowDown' });
    fireEvent.keyDown(editor, { key: 'Enter' });
    if (selected) {
      expect(interaction.updateValue).toHaveBeenCalledOnce();
      expect(interaction.updateValue.mock.calls[0][0]).not.toBe('=SU');
      expect(interaction.commitAndNavigate).not.toHaveBeenCalled();
      updateDraft(interaction.updateValue.mock.calls[0][0]);
      expect(editor).toHaveFocus();
    } else {
      expect(interaction.updateValue).not.toHaveBeenCalled();
      expect(interaction.commitAndNavigate).toHaveBeenCalledOnce();
    }
  });

  it.each(['automatic', 'explicit'])('light Escape cancels with %s completion open', (trigger) => {
    const { editor, interaction, updateDraft } = setup('=S');
    if (trigger === 'automatic') {
      fireEvent.change(editor, { target: { value: '=SU' } });
      updateDraft('=SU');
    } else {
      fireEvent.keyDown(editor, { key: ' ', code: 'Space', ctrlKey: true });
    }
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(interaction.cancel).toHaveBeenCalledOnce();
    expect(interaction.commitAndNavigate).not.toHaveBeenCalled();
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
