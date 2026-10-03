import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { smallSheetDocument } from '@test-support/workbookFactories';
import { formattingSelection, observeFormattingProjection } from '@test-support/formattingProjection';
import { Workspace } from './Workspace';
import { formattingWorkspaceProps } from '@test-support/formattingWorkspace';

afterEach(() => vi.restoreAllMocks());

describe('formatting shortcut event ownership', () => {
  it.each(['editing', 'modal'] as const)('disables shortcut dispatch during %s without invalidating the projection', (guard) => {
    const sheet = smallSheetDocument({ id: 'guards', name: 'Guards' });
    const selection = formattingSelection(sheet, 'cells');
    const props = formattingWorkspaceProps(sheet, selection);
    const work = observeFormattingProjection();
    const view = render(<Workspace {...props} />);
    work.clear();
    view.rerender(<Workspace {...props}
      editingCell={guard === 'editing' ? { target: selection.anchor, draft: 'draft' } : null}
      sheetDialogOpen={guard === 'modal'} />);
    if (guard === 'modal') expect(screen.getByRole('button', { name: 'Number format' })).toBeDisabled();
    fireEvent.keyDown(document.body, { key: 'b', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: '%', code: 'Digit5', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(document.body, { key: 'r', ctrlKey: true, shiftKey: true });
    work.expectCalls(0, 0, 0);
    expect(props.commands.writeNumberFormats).not.toHaveBeenCalled();
    expect(props.onRestoreGridFocus).not.toHaveBeenCalled();
    // The current cached projection remains actionable when the guard retires.
    view.rerender(<Workspace {...props} />);
    fireEvent.keyDown(document.body, { key: 'b', ctrlKey: true });
    work.expectCalls(0, 0, 0);
    expect(props.commands.writeNumberFormats).toHaveBeenCalledOnce();
    expect(props.onRestoreGridFocus).toHaveBeenCalledOnce();
  });

  it('leaves input, textarea, select and contenteditable shortcuts native', () => {
    const sheet = smallSheetDocument({ id: 'native', name: 'Native' });
    const props = formattingWorkspaceProps(sheet, formattingSelection(sheet, 'cells'));
    const work = observeFormattingProjection();
    render(<><Workspace {...props} /><input aria-label="Native input" /><textarea aria-label="Native textarea" />
      <select aria-label="Native select"><option>Option</option></select>
      <div role="textbox" aria-label="Native rich text" contentEditable suppressContentEditableWarning><span>Text</span></div></>);
    work.clear();
    for (const label of ['Native input', 'Native textarea', 'Native select', 'Native rich text']) {
      const owner = screen.getByLabelText(label);
      owner.focus();
      const target = label === 'Native rich text' ? owner.firstElementChild! : owner;
      expect(fireEvent.keyDown(target, { key: 'b', ctrlKey: true })).toBe(true);
      expect(fireEvent.keyDown(target, { key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true })).toBe(true);
      expect(owner).toHaveFocus();
    }
    work.expectCalls(0, 0, 0);
    expect(props.commands.writeNumberFormats).not.toHaveBeenCalled();
    expect(props.onRestoreGridFocus).not.toHaveBeenCalled();
  });

  it('does not take a shortcut already prevented by another event owner', () => {
    const sheet = smallSheetDocument({ id: 'prevented', name: 'Prevented' });
    const props = formattingWorkspaceProps(sheet, formattingSelection(sheet, 'cells'));
    render(<Workspace {...props} />);
    const event = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true });
    event.preventDefault();
    fireEvent(document.body, event);
    expect(props.commands.writeNumberFormats).not.toHaveBeenCalled();
    expect(props.onRestoreGridFocus).not.toHaveBeenCalled();
  });
});
