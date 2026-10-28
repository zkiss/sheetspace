import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { App } from './App';

function setup() {
  render(<App initialWorkbook={workbookWithSheets([
    smallSheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=@B[1]+1', B1: '2' } }),
  ])} />);
  const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
  fireEvent.doubleClick(cell);
  const editor = screen.getByRole('textbox');
  const panel = editor.closest('section')!;
  return { cell, editor, panel, token: panel.querySelector('[data-reference-index]')!, surface: screen.getByTestId('workspace-surface') };
}

function pointer(target: Element, type: string, options: MouseEventInit = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...options });
  Object.defineProperty(event, 'pointerId', { value: 17 });
  fireEvent(target, event);
  return event;
}

describe('shared formula editor workspace gesture ownership', () => {
  it('keeps native primary pointers and selection in the portaled editor', () => {
    const { cell, editor, panel, token, surface } = setup();
    for (const target of [panel, editor, token]) {
      expect(pointer(target, 'pointerdown').defaultPrevented).toBe(false);
      pointer(target, 'pointerup');
      expect(cell).toHaveAttribute('data-active-cell', 'true');
      expect(screen.getByRole('textbox')).toBe(editor);
      expect(surface).toHaveAttribute('data-viewport-x', '0');
      expect(surface).toHaveAttribute('data-viewport-y', '0');
    }
  });

  it('leaves ordinary editor wheel input native without panning or clearing selection', () => {
    const { cell, editor, surface } = setup();
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 80, deltaY: 100 });
    fireEvent(editor, event);
    expect(event.defaultPrevented).toBe(false);
    expect(cell).toHaveAttribute('data-active-cell', 'true');
    expect(surface).toHaveAttribute('data-viewport-x', '0');
    expect(surface).toHaveAttribute('data-viewport-y', '0');
  });

  it('routes Ctrl wheel over the portaled editor to workspace zoom and retains the draft', () => {
    const { cell, editor, surface } = setup();
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 });
    fireEvent(editor, event);
    expect(event.defaultPrevented).toBe(true);
    expect(Number(surface.dataset.viewportScale)).toBeGreaterThan(1);
    expect(cell).toHaveAttribute('data-active-cell', 'true');
    expect(screen.getByRole('textbox')).toBe(editor);
    expect(editor).toHaveValue('=@B[1]+1');
  });

  it('keeps Space typing in the editor from starting workspace pan', () => {
    const { cell, editor, surface } = setup();
    fireEvent.keyDown(editor, { key: ' ', code: 'Space' });
    expect(pointer(editor, 'pointerdown').defaultPrevented).toBe(false);
    pointer(surface, 'pointermove', { clientX: 40, clientY: 20 });
    pointer(editor, 'pointerup');
    fireEvent.keyUp(editor, { key: ' ', code: 'Space' });
    expect(surface).toHaveAttribute('data-viewport-x', '0');
    expect(surface).toHaveAttribute('data-viewport-y', '0');
    expect(cell).toHaveAttribute('data-active-cell', 'true');
    expect(screen.getByRole('textbox')).toBe(editor);
  });

  it('routes an armed Space pan from the editor into the workspace', () => {
    const { cell, editor, surface } = setup();
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    expect(pointer(editor, 'pointerdown').defaultPrevented).toBe(true);
    pointer(surface, 'pointermove', { clientX: 40, clientY: 20 });
    pointer(surface, 'pointerup', { clientX: 40, clientY: 20, buttons: 0 });
    fireEvent.keyUp(document.body, { key: ' ', code: 'Space' });
    expect(surface).toHaveAttribute('data-viewport-x', '40');
    expect(surface).toHaveAttribute('data-viewport-y', '20');
    expect(cell).not.toHaveAttribute('data-active-cell');
  });

});
