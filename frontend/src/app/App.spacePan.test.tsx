import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { App } from './App';

function setup() {
  render(<App initialWorkbook={workbookWithSheets([
    smallSheetDocument({ id: 'inputs', name: 'Inputs' }),
  ])} />);
  const surface = screen.getByTestId('workspace-surface');
  const cell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
  const capture = new Set<number>();
  surface.setPointerCapture = vi.fn((id) => { capture.add(id); });
  surface.hasPointerCapture = (id) => capture.has(id);
  surface.releasePointerCapture = vi.fn((id) => { capture.delete(id); });
  fireEvent.click(cell);
  act(() => cell.focus());
  expect(cell).toHaveFocus();
  fireEvent.keyDown(cell, { key: ' ', code: 'Space' });
  return { surface, cell, capture };
}

function pointer(target: Element, type: string, clientX = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX });
  Object.defineProperty(event, 'pointerId', { value: 7 });
  fireEvent(target, event);
  return event;
}

describe('focused-cell Space pan lifecycle', () => {
  it('clears selection but retains the keyboard owner until keyup, then stops movement and releases capture', () => {
    const { surface, cell, capture } = setup();
    expect(pointer(cell, 'pointerdown').defaultPrevented).toBe(true);
    expect(cell).not.toHaveFocus();
    expect(cell).not.toHaveAttribute('data-active-cell');
    expect(capture.has(7)).toBe(true);
    expect(surface).toHaveClass('workspace-surface-panning');
    pointer(surface, 'pointermove', 10);
    expect(surface).toHaveAttribute('data-viewport-x', '10');
    fireEvent.keyUp(document.body, { key: ' ', code: 'Space' });
    expect(surface).not.toHaveClass('workspace-surface-panning');
    expect(capture.size).toBe(0);
    expect(surface.releasePointerCapture).toHaveBeenCalledWith(7);
    pointer(surface, 'pointermove', 30);
    expect(surface).toHaveAttribute('data-viewport-x', '10');
    pointer(surface, 'pointerup', 30);
  });

  it('starts another drag without a new keydown while Space remains held', () => {
    const { surface, cell, capture } = setup();
    for (let index = 0; index < 2; index++) {
      act(() => cell.focus());
      expect(cell).toHaveFocus();
      expect(pointer(cell, 'pointerdown').defaultPrevented).toBe(true);
      expect(capture.has(7)).toBe(true);
      pointer(surface, 'pointermove', 10);
      pointer(surface, 'pointerup', 10);
      expect(capture.size).toBe(0);
      expect(surface).not.toHaveClass('workspace-surface-panning');
    }
    expect(surface).toHaveAttribute('data-viewport-x', '20');
    fireEvent.keyUp(document.body, { code: 'Space' });
    expect(pointer(cell, 'pointerdown').defaultPrevented).toBe(false);
    pointer(surface, 'pointermove', 30);
    expect(surface).toHaveAttribute('data-viewport-x', '20');
  });
});
