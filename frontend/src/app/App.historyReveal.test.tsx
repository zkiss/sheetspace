import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { measuredElementGeometry, testRect, virtualGridGeometry } from '@test-support/domGeometry';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { panWorkspace } from '@test-support/workspaceActions';
import { App } from './App';

function setup(target = 'A1', visualScale = 1, variableSizes = false) {
  const sheet = sheetDocument({
    id: 'inputs', name: 'Inputs', position: { x: 50, y: 50 }, frameSize: { width: 240, height: 160 },
    visualScale, rowCount: 20, columnCount: 10, cells: { [target]: 'old' },
  });
  if (variableSizes) sheet.presentation = {
    rowHeights: { [sheet.content.rows[0]]: 35.3, [sheet.content.rows[1]]: 51.4, [sheet.content.rows[2]]: 44.7 },
    columnWidths: { [sheet.content.columns[0]]: 88.6, [sheet.content.columns[1]]: 109.7, [sheet.content.columns[2]]: 90.2 },
  };
  render(<App initialWorkbook={workbookWithSheets([sheet])} />);
  const surface = screen.getByTestId('workspace-surface');
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  const body = within(frame).getByTestId('sheet-frame-body');
  act(() => {
    measuredElementGeometry(surface, { width: 800, height: 600 });
    // The frame is border-box: 1px borders, 32px title, and a 238x126
    // scrollport. Rects include both transforms; client sizes do not.
    virtualGridGeometry(body, { width: 238, height: 126 });
    const rect = (left: number, top: number, width: number, height: number) => {
      const zoom = Number(surface.dataset.viewportScale);
      const scale = zoom * visualScale;
      return testRect({ left: Number(surface.dataset.viewportX) + (50 + left * visualScale) * zoom,
        top: Number(surface.dataset.viewportY) + (50 + top * visualScale) * zoom,
        width: width * scale, height: height * scale });
    };
    frame.getBoundingClientRect = () => rect(0, 0, 240, 160);
    body.getBoundingClientRect = () => rect(1, 33, 238, 126);
    // Emulate the browser's integer scroll extents and clamped assignments.
    for (const [property, dimension, viewportSize] of [['scrollLeft', 'width', 238], ['scrollTop', 'height', 126]] as const) {
      let offset = 0;
      Object.defineProperty(body, property, { configurable: true, get: () => offset, set: (value: number) => {
        const grid = body.querySelector<HTMLElement>('.sheet-grid')!;
        offset = Math.max(0, Math.min(value, Math.round(Number.parseFloat(grid.style[dimension])) - viewportSize));
      } });
    }
    if (target === 'J20') {
      body.scrollLeft = 500;
      body.scrollTop = 400;
      fireEvent.scroll(body);
    }
  });
  const cell = within(frame).getByRole('cell', { name: `Inputs ${target} cell` });
  fireEvent.doubleClick(cell);
  const editor = screen.getByRole('textbox');
  fireEvent.change(editor, { target: { value: 'new' } });
  fireEvent.keyDown(editor, { key: 'Enter' });
  return { surface, frame, body, cell };
}

function history(redo = false) {
  fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, shiftKey: redo });
}

function clearSelection(surface: HTMLElement) {
  for (const type of ['pointerdown', 'pointerup']) {
    const event = new MouseEvent(type, { bubbles: true, button: 0, buttons: 1 });
    Object.defineProperty(event, 'pointerId', { value: 17 });
    fireEvent(surface, event);
  }
}

describe('history cell reveal in the composed workspace', () => {
  it.each([
    { target: 'C3', left: 160, top: 30, panX: 300, panY: 125, movesX: true, movesY: false, scale: 1, zoom: false },
    { target: 'C3', left: 100, top: 60, panX: 125, panY: 200, movesX: false, movesY: true, scale: 1, zoom: false },
    { target: 'C3', left: 160, top: 60, panX: 300, panY: 200, movesX: true, movesY: true, scale: 1.5, zoom: true },
    { target: 'J20', left: 0, top: 0, panX: 400, panY: 300, movesX: true, movesY: true, scale: 1.5, zoom: true },
    { target: 'C3', left: 200, top: 90, panX: 300, panY: 200, movesX: true, movesY: true, scale: 1.5, zoom: true, variableSizes: true },
  ])('composes unobscured inner and outer undo/redo reveal: %o', ({ target, left, top, panX, panY, movesX, movesY, scale, zoom, variableSizes }) => {
    const { surface, frame, body } = setup(target, scale, variableSizes);
    if (zoom) fireEvent.wheel(surface, { ctrlKey: true, deltaY: -50 });
    for (const redo of [false, true]) {
      body.scrollLeft = left;
      body.scrollTop = top;
      fireEvent.scroll(body);
      panWorkspace(-panX - Number(surface.dataset.viewportX), -panY - Number(surface.dataset.viewportY));
      // Explicit pan clears selection; history must not recreate it on reveal.
      expect(frame.querySelector('[data-active-cell="true"]')).toBeNull();
      const beforeX = Number(surface.dataset.viewportX);
      const beforeY = Number(surface.dataset.viewportY);
      history(redo);
      const cell = frame.querySelector<HTMLElement>(`[data-cell-key="${target}"]`)!;
      expect(cell).toHaveTextContent(redo ? 'new' : 'old');
      const localLeft = Number.parseFloat(cell.style.left) - body.scrollLeft;
      const localTop = Number.parseFloat(cell.parentElement!.style.top) - body.scrollTop;
      const width = Number.parseFloat(cell.style.width);
      const height = Number.parseFloat(cell.parentElement!.style.height);
      // Full cells, not clipped intersections: no title or sticky-header overlap.
      expect(localLeft).toBeGreaterThanOrEqual(40 - 1e-9);
      expect(localTop).toBeGreaterThanOrEqual(26.4 - 1e-9);
      expect(localLeft + width).toBeLessThanOrEqual(238 + 1e-9);
      expect(localTop + height).toBeLessThanOrEqual(126 + 1e-9);
      const bodyRect = body.getBoundingClientRect();
      const screenScale = scale * Number(surface.dataset.viewportScale);
      expect(bodyRect.left + localLeft * screenScale).toBeGreaterThanOrEqual(0);
      expect(bodyRect.top + localTop * screenScale).toBeGreaterThanOrEqual(0);
      expect(bodyRect.left + (localLeft + width) * screenScale).toBeLessThanOrEqual(800);
      expect(bodyRect.top + (localTop + height) * screenScale).toBeLessThanOrEqual(600);
      if (!movesX) {
        expect(body.scrollLeft).toBe(left);
        expect(Number(surface.dataset.viewportX)).toBe(beforeX);
      }
      if (!movesY) {
        expect(body.scrollTop).toBe(top);
        expect(Number(surface.dataset.viewportY)).toBe(beforeY);
      }
      expect(frame.querySelector('[data-active-cell="true"]')).toBeNull();
    }
  });

  it.each([
    { axis: 'x', deltaX: 250, deltaY: 0 },
    { axis: 'y', deltaX: 0, deltaY: 150 },
  ])('reveals undo and redo targets hidden by a partially clipped frame on $axis', ({ axis, deltaX, deltaY }) => {
    const { surface, cell, frame } = setup();
    for (const redo of [false, true]) {
      panWorkspace(
        deltaX ? -deltaX - Number(surface.dataset.viewportX) : 0,
        deltaY ? -deltaY - Number(surface.dataset.viewportY) : 0,
      );
      const before = Number(axis === 'x' ? surface.dataset.viewportX : surface.dataset.viewportY);
      // A sliver of the sheet still intersects the workspace.
      expect(before + Number(axis === 'x' ? frame.dataset.frameWidth : frame.dataset.frameHeight) + 50).toBeGreaterThan(0);
      history(redo);
      expect(cell).toHaveTextContent(redo ? 'new' : 'old');
      expect(Number(axis === 'x' ? surface.dataset.viewportX : surface.dataset.viewportY)).toBeGreaterThan(before);
      // A1's full 76x26.4 cell, not just the frame sliver, is now in view.
      expect(Number(surface.dataset.viewportX) + 91).toBeGreaterThanOrEqual(0);
      expect(Number(surface.dataset.viewportX) + 167).toBeLessThanOrEqual(800);
      expect(Number(surface.dataset.viewportY) + 109.4).toBeGreaterThanOrEqual(0);
      expect(Number(surface.dataset.viewportY) + 135.8).toBeLessThanOrEqual(600);
      expect(frame.querySelector('[data-active-cell="true"]')).toBeNull();
    }
  });

  it.each([0, 70])('does not move the workspace when the history cell is visible, including a clipped frame (pan=%s)', (deltaX) => {
    const { surface, cell } = setup();
    if (deltaX) panWorkspace(-deltaX);
    const selectedKey = surface.querySelector('[data-active-cell="true"]')?.getAttribute('data-cell-key');
    for (const redo of [false, true]) {
      history(redo);
      expect(cell).toHaveTextContent(redo ? 'new' : 'old');
      expect(surface).toHaveAttribute('data-viewport-x', String(-deltaX || 0));
      expect(surface).toHaveAttribute('data-viewport-y', '0');
      expect(surface.querySelector('[data-active-cell="true"]')?.getAttribute('data-cell-key')).toBe(selectedKey);
    }
  });

  it.each([false, true])('keeps intentional grid scrolling after workspace pan/zoom (zoom=%s), but reveals on the next action', (zoom) => {
    const { surface, body, cell, frame } = setup();
    history();
    // Clear active-cell scrolling so history alone owns this regression.
    clearSelection(surface);
    expect(frame.querySelector('[data-active-cell="true"]')).toBeNull();
    body.scrollTop = 300;
    body.scrollLeft = 400;
    fireEvent.scroll(body);
    expect(body.scrollTop).toBe(300);
    if (zoom) fireEvent.wheel(surface, { ctrlKey: true, deltaY: -10 });
    else panWorkspace(-10);
    expect(body.scrollTop).toBe(300);
    expect(body.scrollLeft).toBe(400);
    history(true);
    expect(cell).toHaveTextContent('new');
    expect(body.scrollTop).toBe(0);
    expect(body.scrollLeft).toBe(0);
  });

  it('does not replay consumed history after overview or culled-frame remounts', () => {
    const { surface, body, frame } = setup('J20');
    history();
    clearSelection(surface);
    expect(frame.querySelector('[data-active-cell="true"]')).toBeNull();
    body.scrollLeft = 0;
    body.scrollTop = 0;
    fireEvent.scroll(body);
    fireEvent.wheel(surface, { ctrlKey: true, deltaY: 600 });
    expect(frame).toHaveAttribute('data-rendering-mode', 'overview');
    fireEvent.wheel(surface, { ctrlKey: true, deltaY: -600 });
    expect(frame).toHaveAttribute('data-rendering-mode', 'detailed');
    expect(body.scrollTop).toBe(0);
    expect(body.scrollLeft).toBe(0);
    panWorkspace(-3000);
    expect(screen.queryByRole('article', { name: 'Sheet Inputs' })).not.toBeInTheDocument();
    panWorkspace(3000);
    const remountedBody = within(screen.getByRole('article', { name: 'Sheet Inputs' })).getByTestId('sheet-frame-body');
    expect(remountedBody).not.toBe(body);
    expect(remountedBody.scrollTop).toBe(0);
    expect(remountedBody.scrollLeft).toBe(0);
  });

  it('refines a culled target with the mounted scrollbar geometry before consuming the action', () => {
    const { surface } = setup('J20', 8);
    clearSelection(surface);
    panWorkspace(-4000);
    expect(screen.queryByRole('article', { name: 'Sheet Inputs' })).not.toBeInTheDocument();
    // The remount has classic 15px scrollbars on both axes. At sheet scale 8,
    // their 120px screen displacement exceeds ordinary navigation padding.
    const widthGetter = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    const heightGetter = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('sheet-frame-body') ? 223 : widthGetter?.get?.call(this) ?? 0;
    });
    const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('sheet-frame-body') ? 111 : heightGetter?.get?.call(this) ?? 0;
    });
    try {
      history();
      const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
      const body = within(frame).getByTestId('sheet-frame-body');
      const cell = frame.querySelector<HTMLElement>('[data-cell-key="J20"]')!;
      const localLeft = Number.parseFloat(cell.style.left) - body.scrollLeft;
      const localTop = Number.parseFloat(cell.parentElement!.style.top) - body.scrollTop;
      const left = Number(surface.dataset.viewportX) + 50 + (1 + localLeft) * 8;
      const top = Number(surface.dataset.viewportY) + 50 + (33 + localTop) * 8;
      expect(localLeft).toBeGreaterThanOrEqual(40);
      expect(localTop).toBeGreaterThanOrEqual(26.4);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(left + 76 * 8).toBeLessThanOrEqual(800);
      expect(top + 26.4 * 8).toBeLessThanOrEqual(600);
      expect(cell).toHaveTextContent('old');
      panWorkspace(-20);
      expect(Number(surface.dataset.viewportX)).toBeCloseTo(left - 50 - (1 + localLeft) * 8 - 20);
    } finally {
      width.mockRestore();
      height.mockRestore();
    }
  });
});
