import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { measuredElementGeometry, virtualGridGeometry } from '@test-support/domGeometry';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { App } from './App';

function setup() {
  render(<App initialWorkbook={workbookWithSheets([sheetDocument({
    id: 'inputs', name: 'Inputs', position: { x: 50, y: 50 }, frameSize: { width: 240, height: 160 },
    rowCount: 20, columnCount: 10, cells: { A1: 'old' },
  })])} />);
  const surface = screen.getByTestId('workspace-surface');
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  const body = within(frame).getByTestId('sheet-frame-body');
  act(() => {
    measuredElementGeometry(surface, { width: 800, height: 600 });
    virtualGridGeometry(body, { width: 240, height: 118 });
  });
  const cell = within(frame).getByRole('cell', { name: 'Inputs A1 cell' });
  fireEvent.doubleClick(cell);
  const editor = screen.getByRole('textbox');
  fireEvent.change(editor, { target: { value: 'new' } });
  fireEvent.keyDown(editor, { key: 'Enter' });
  return { surface, frame, body, cell };
}

function history(redo = false) {
  fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, shiftKey: redo });
}

describe('history cell reveal in the composed workspace', () => {
  it.each([
    { axis: 'x', deltaX: 250, deltaY: 0 },
    { axis: 'y', deltaX: 0, deltaY: 150 },
  ])('reveals undo and redo targets hidden by a partially clipped frame on $axis', ({ axis, deltaX, deltaY }) => {
    const { surface, cell, frame } = setup();
    for (const redo of [false, true]) {
      fireEvent.wheel(surface, {
        deltaX: deltaX ? deltaX + Number(surface.dataset.viewportX) : 0,
        deltaY: deltaY ? deltaY + Number(surface.dataset.viewportY) : 0,
      });
      const before = Number(axis === 'x' ? surface.dataset.viewportX : surface.dataset.viewportY);
      // A sliver of the sheet still intersects the workspace.
      expect(before + Number(axis === 'x' ? frame.dataset.frameWidth : frame.dataset.frameHeight) + 50).toBeGreaterThan(0);
      history(redo);
      expect(cell).toHaveTextContent(redo ? 'new' : 'old');
      expect(Number(axis === 'x' ? surface.dataset.viewportX : surface.dataset.viewportY)).toBeGreaterThan(before);
      // A1's full 76x26.4 cell, not just the frame sliver, is now in view.
      expect(Number(surface.dataset.viewportX) + 90).toBeGreaterThanOrEqual(0);
      expect(Number(surface.dataset.viewportX) + 166).toBeLessThanOrEqual(800);
      expect(Number(surface.dataset.viewportY) + 118.4).toBeGreaterThanOrEqual(0);
      expect(Number(surface.dataset.viewportY) + 144.8).toBeLessThanOrEqual(600);
      expect(within(frame).getByRole('cell', { name: 'Inputs A2 empty cell' })).toHaveAttribute('data-active-cell', 'true');
    }
  });

  it.each([0, 70])('does not move the workspace when the history cell is visible, including a clipped frame (pan=%s)', (deltaX) => {
    const { surface, cell } = setup();
    fireEvent.wheel(surface, { deltaX });
    for (const redo of [false, true]) {
      history(redo);
      expect(cell).toHaveTextContent(redo ? 'new' : 'old');
      expect(surface).toHaveAttribute('data-viewport-x', String(-deltaX || 0));
      expect(surface).toHaveAttribute('data-viewport-y', '0');
    }
  });

  it.each([false, true])('keeps intentional grid scrolling after workspace pan/zoom (zoom=%s), but reveals on the next action', (zoom) => {
    const { surface, body, cell, frame } = setup();
    history();
    // Clear active-cell scrolling so history alone owns this regression.
    const pointer = (type: string) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, buttons: 1 });
      Object.defineProperty(event, 'pointerId', { value: 17 });
      fireEvent(surface, event);
    };
    pointer('pointerdown'); pointer('pointerup');
    expect(frame.querySelector('[data-active-cell="true"]')).toBeNull();
    body.scrollTop = 300;
    body.scrollLeft = 400;
    fireEvent.scroll(body);
    expect(body.scrollTop).toBe(300);
    fireEvent.wheel(surface, zoom ? { ctrlKey: true, deltaY: -10 } : { deltaX: 10 });
    expect(body.scrollTop).toBe(300);
    expect(body.scrollLeft).toBe(400);
    history(true);
    expect(cell).toHaveTextContent('new');
    expect(body.scrollTop).toBe(0);
    expect(body.scrollLeft).toBe(0);
  });
});
