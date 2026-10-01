import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

function gesture(target: Element, type: string, scale: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { scale, clientX: 40, clientY: 60 });
  fireEvent(target, event);
  return event;
}

describe('native pinch over portal cell editors', () => {
  it('consumes the complete lifecycle, zooms cumulatively, and preserves the editor draft, focus and caret', () => {
    render(<App initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs' })])} />);
    const cell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    fireEvent.doubleClick(cell);
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox');
    const surface = screen.getByTestId('workspace-surface');
    expect(surface).not.toContainElement(editor);
    fireEvent.change(editor, { target: { value: 'Uncommitted draft' } });
    editor.setSelectionRange(2, 6);

    const ordinaryPointer = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
    Object.assign(ordinaryPointer, { pointerId: 17 });
    fireEvent(editor, ordinaryPointer);
    expect(ordinaryPointer.defaultPrevented).toBe(false);
    const ordinaryWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
    fireEvent(editor, ordinaryWheel);
    expect(ordinaryWheel.defaultPrevented).toBe(false);
    expect(fireEvent.keyDown(editor, { code: 'Space', key: ' ', cancelable: true })).toBe(true);
    expect(surface).toHaveAttribute('data-viewport-scale', '1');
    expect(surface).toHaveAttribute('data-viewport-x', '0');
    expect(surface).toHaveAttribute('data-viewport-y', '0');

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
      <App initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs' })])} />
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

  it('does not treat reference metadata for a culled sheet as ownership of an external editor', () => {
    render(<>
      <App initialWorkbook={workbookWithSheets([
        smallSheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=remote!A1' } }),
        smallSheetDocument({ id: 'remote', name: 'Remote', position: { x: 1e6, y: 1e6 } }),
      ])} />
      <textarea aria-label="Foreign editor" data-workspace-sheet-editor="remote" />
    </>);
    const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    fireEvent.click(cell);
    fireEvent.doubleClick(cell);
    const editor = screen.getByRole('textbox', { name: 'Inputs A1 editor' });
    const foreign = screen.getByRole('textbox', { name: 'Foreign editor' });
    const surface = screen.getByTestId('workspace-surface');
    expect(screen.queryByRole('article', { name: 'Sheet Remote' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remote!A1, reference' })).toHaveAttribute('data-sheet-id', 'remote');
    expect(gesture(editor, 'gesturestart', 1).defaultPrevented).toBe(true);
    for (const [type, scale] of [['gesturestart', 1], ['gesturechange', 3], ['gestureend', 3]] as const) {
      expect(gesture(foreign, type, scale).defaultPrevented).toBe(false);
    }
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 });
    fireEvent(foreign, wheel);
    expect(wheel.defaultPrevented).toBe(false);
    expect(surface).toHaveAttribute('data-viewport-scale', '1');
    expect(gesture(editor, 'gesturechange', 1.5).defaultPrevented).toBe(true);
    expect(gesture(editor, 'gestureend', 1.5).defaultPrevented).toBe(true);
    expect(surface).toHaveAttribute('data-viewport-scale', '1.5');
    expect(editor).toHaveFocus();
  });
});
