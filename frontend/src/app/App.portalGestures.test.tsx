import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

function gesture(target: Element, type: string, scale: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { scale, clientX: 40, clientY: 60 });
  fireEvent(target, event);
  return event;
}

describe('native pinch over portal cell editors', () => {
  it('consumes the complete lifecycle, zooms cumulatively, and preserves the editor draft, focus and caret', () => {
    render(<App initialWorkbook={workbookWithSheets([sheetDocument({ id: 'inputs', name: 'Inputs' })])} />);
    const cell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    fireEvent.doubleClick(cell);
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox');
    const surface = screen.getByTestId('workspace-surface');
    expect(surface).not.toContainElement(editor);
    fireEvent.change(editor, { target: { value: 'Uncommitted draft' } });
    editor.setSelectionRange(2, 6);

    for (const [type, scale] of [['gesturestart', 1], ['gesturechange', 1.5], ['gesturechange', 2], ['gestureend', 2]] as const) {
      expect(gesture(editor, type, scale).defaultPrevented).toBe(true);
      expect(editor).toHaveFocus();
      expect(editor).toHaveValue('Uncommitted draft');
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 6]);
    }
    expect(surface).toHaveAttribute('data-viewport-scale', '2');
    expect(surface).toHaveAttribute('data-viewport-x', '-40');
    expect(surface).toHaveAttribute('data-viewport-y', '-60');
    expect(cell).toHaveTextContent('');
    // An ended lifecycle must not leave gesture state that consumes a second end.
    expect(gesture(editor, 'gestureend', 2).defaultPrevented).toBe(false);
    expect(gesture(editor, 'gesturestart', 1).defaultPrevented).toBe(true);
    expect(gesture(editor, 'gesturechange', 1.25).defaultPrevented).toBe(true);
    expect(gesture(editor, 'gestureend', 1.25).defaultPrevented).toBe(true);
    expect(surface).toHaveAttribute('data-viewport-scale', '2.5');
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(cell).toHaveTextContent('Uncommitted draft');
  });

  it('excludes unrelated portals even during an owned editor gesture', () => {
    render(<>
      <App initialWorkbook={workbookWithSheets([sheetDocument({ id: 'inputs', name: 'Inputs' })])} />
      {/* Native events use only DOM ancestry: these external editor targets
          have the same outside-surface route as unrelated body portals. */}
      <textarea aria-label="Unrelated portal" />
      <textarea aria-label="Other workspace editor" data-workspace-sheet-editor="other-sheet" />
    </>);
    fireEvent.doubleClick(screen.getByRole('cell', { name: 'Inputs A1 empty cell' }));
    const editor = screen.getByRole('textbox', { name: 'Inputs A1 editor' });
    const surface = screen.getByTestId('workspace-surface');
    expect(gesture(editor, 'gesturestart', 1).defaultPrevented).toBe(true);
    for (const name of ['Unrelated portal', 'Other workspace editor']) {
      const unrelated = screen.getByRole('textbox', { name });
      expect(surface).not.toContainElement(unrelated);
      for (const [type, scale] of [['gesturestart', 1], ['gesturechange', 3], ['gestureend', 3]] as const) {
        expect(gesture(unrelated, type, scale).defaultPrevented).toBe(false);
      }
    }
    expect(surface).toHaveAttribute('data-viewport-scale', '1');
    expect(editor).toHaveFocus();
    expect(gesture(editor, 'gesturechange', 1.5).defaultPrevented).toBe(true);
    expect(gesture(editor, 'gestureend', 1.5).defaultPrevented).toBe(true);
    expect(surface).toHaveAttribute('data-viewport-scale', '1.5');
  });
});
