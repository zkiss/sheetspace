import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { testRect } from '@test-support/domGeometry';
import { workbookWithSheets, smallSheetDocument } from '@test-support/workbookFactories';
import { App } from './App';
import { activateCellEditor, resizeHandle } from '@test-support/appScreen';
import { persistedWorkbookClient } from '@test-support/apiClients';

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
}

describe('workspace minimap integration', () => {
  it('preserves an active draft and ignores zoom gestures over the map', () => {
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    try {
      render(<App initialWorkbook={workbookWithSheets([
        smallSheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '7' } }),
        smallSheetDocument({ id: 'far', name: 'Far', position: { x: 4000, y: 0 } }),
      ])} />);
      const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
      activateCellEditor(cell);
      const editor = screen.getByRole('textbox', { name: 'Inputs A1 editor' });
      fireEvent.change(editor, { target: { value: 'draft' } });
      const map = screen.getByRole('img', { name: 'Workspace map' });
      map.getBoundingClientRect = () => testRect({ left: 0, top: 0, width: 200, height: 130 });
      const surface = screen.getByTestId('workspace-surface');
      fireEvent.wheel(map, { deltaY: -100, ctrlKey: true });
      fireEvent.pointerDown(map, { button: 0, pointerId: 1, clientX: 180, clientY: 65 });
      expect(editor).toHaveValue('draft');
      expect(editor).toHaveFocus();
      expect(cell).toHaveAttribute('data-active-cell', 'true');
      expect(surface).toHaveAttribute('data-viewport-scale', '1');
    } finally { vi.unstubAllGlobals(); }
  });
  it('navigates the real canvas without zoom and includes virtualized sheets', () => {
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    try {
      const workbook = workbookWithSheets([
        smallSheetDocument({ id: 'near', name: 'Near' }),
        smallSheetDocument({ id: 'far', name: 'Far', position: { x: 4000, y: 0 } }),
      ]);
      const { unmount } = render(<App initialWorkbook={workbook} />);
      const map = screen.getByRole('img', { name: 'Workspace map' });
      map.getBoundingClientRect = () => testRect({ left: 0, top: 0, width: 200, height: 130 });
      expect(map.querySelectorAll('.workspace-minimap-sheet')).toHaveLength(2);
      const surface = screen.getByTestId('workspace-surface');
      const scale = surface.dataset.viewportScale;
      fireEvent.pointerDown(map, { button: 0, pointerId: 1, clientX: 180, clientY: 65 });
      expect(Number(surface.dataset.viewportX)).toBeLessThan(-1000);
      expect(surface.dataset.viewportScale).toBe(scale);
      unmount();
    } finally { vi.unstubAllGlobals(); }
  });
  it('tracks live frame movement and resizing, including cancellation and settlement', () => {
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    try {
      render(<App initialWorkbook={workbookWithSheets([
        smallSheetDocument({ id: 'near', name: 'Near', position: { x: 100, y: 100 } }),
        smallSheetDocument({ id: 'far', name: 'Far', position: { x: 4000, y: 0 } }),
      ])} />);
      const map = screen.getByRole('img', { name: 'Workspace map' });
      const rectangle = map.querySelector('.workspace-minimap-sheet')!;
      const frame = screen.getByRole('article', { name: 'Sheet Near' });
      const header = within(frame).getByTestId('sheet-frame-header');
      const initialX = rectangle.getAttribute('x');
      fireEvent.pointerDown(header, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(header, { pointerId: 1, clientX: 300, clientY: 100 });
      expect(Number(rectangle.getAttribute('x'))).toBeGreaterThan(Number(initialX));
      fireEvent.pointerCancel(header, { pointerId: 1 });
      expect(rectangle.getAttribute('x')).toBe(initialX);
      fireEvent.pointerDown(header, { button: 0, pointerId: 2, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(header, { pointerId: 2, clientX: 300, clientY: 100 });
      const movedX = rectangle.getAttribute('x');
      fireEvent.pointerUp(header, { pointerId: 2, clientX: 300, clientY: 100 });
      expect(rectangle.getAttribute('x')).toBe(movedX);

      const handle = resizeHandle(frame, 'right');
      const initialWidth = Number(rectangle.getAttribute('width'));
      fireEvent.pointerDown(handle, { button: 0, pointerId: 3, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(handle, { pointerId: 3, clientX: 300, clientY: 100 });
      expect(Number(rectangle.getAttribute('width'))).toBeGreaterThan(initialWidth);
      fireEvent.pointerCancel(handle, { pointerId: 3 });
      expect(Number(rectangle.getAttribute('width'))).toBe(initialWidth);
      fireEvent.pointerDown(handle, { button: 0, pointerId: 4, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(handle, { pointerId: 4, clientX: 300, clientY: 100 });
      const resizedWidth = rectangle.getAttribute('width');
      fireEvent.pointerUp(handle, { pointerId: 4, clientX: 300, clientY: 100 });
      expect(rectangle.getAttribute('width')).toBe(resizedWidth);
    } finally { vi.unstubAllGlobals(); }
  });
  it('drags the real viewport without changing zoom and stops after capture loss', () => {
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    try {
      render(<App initialWorkbook={workbookWithSheets([
        smallSheetDocument({ id: 'near', name: 'Near' }),
        smallSheetDocument({ id: 'far', name: 'Far', position: { x: 4000, y: 0 } }),
      ])} />);
      const map = screen.getByRole('img', { name: 'Workspace map' });
      map.getBoundingClientRect = () => testRect({ left: 0, top: 0, width: 200, height: 130 });
      Object.assign(map, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => true });
      const outline = map.querySelector('.workspace-minimap-viewport')!;
      const x = Number(outline.getAttribute('x')) + Number(outline.getAttribute('width')) / 2;
      const y = Number(outline.getAttribute('y')) + Number(outline.getAttribute('height')) / 2;
      const surface = screen.getByTestId('workspace-surface');
      fireEvent.pointerDown(map, { button: 0, pointerId: 5, clientX: x, clientY: y });
      fireEvent.pointerMove(map, { pointerId: 5, clientX: x + 30, clientY: y });
      const moved = surface.dataset.viewportX;
      expect(Number(moved)).toBeLessThan(0);
      expect(surface.dataset.viewportScale).toBe('1');
      fireEvent.lostPointerCapture(map, { pointerId: 5 });
      fireEvent.pointerMove(map, { pointerId: 5, clientX: x + 60, clientY: y });
      expect(surface.dataset.viewportX).toBe(moved);
    } finally { vi.unstubAllGlobals(); }
  });
  it.each(['inside', 'outside'])('keeps the real drag owner when a second touch starts %s', (location) => {
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    try {
      render(<App initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'near', name: 'Near' }), smallSheetDocument({ id: 'far', name: 'Far', position: { x: 4000, y: 0 } })])} />);
      const map = screen.getByRole('img', { name: 'Workspace map' });
      map.getBoundingClientRect = () => testRect({ left: 0, top: 0, width: 200, height: 130 });
      Object.assign(map, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => true });
      const outline = map.querySelector('.workspace-minimap-viewport')!;
      const x = Number(outline.getAttribute('x')) + Number(outline.getAttribute('width')) / 2;
      const y = Number(outline.getAttribute('y')) + Number(outline.getAttribute('height')) / 2;
      const surface = screen.getByTestId('workspace-surface');
      fireEvent.pointerDown(map, { button: 0, pointerId: 1, clientX: x, clientY: y });
      fireEvent.pointerDown(map, { button: 0, pointerId: 2, clientX: location === 'inside' ? x : 190, clientY: y });
      expect(Number(surface.dataset.viewportX)).toBe(0);
      fireEvent.pointerUp(map, { pointerId: 2 });
      fireEvent.pointerMove(map, { pointerId: 1, clientX: x + 20, clientY: y });
      const moved = Number(surface.dataset.viewportX);
      expect(moved).toBeLessThan(0);
      expect(surface.dataset.viewportScale).toBe('1');
      fireEvent.pointerUp(map, { pointerId: 1, clientX: x + 20, clientY: y });
      expect(Number(surface.dataset.viewportX)).toBe(moved);
      fireEvent.pointerDown(map, { button: 0, pointerId: 3, clientX: 190, clientY: y });
      expect(Number(surface.dataset.viewportX)).not.toBe(moved);
    } finally { vi.unstubAllGlobals(); }
  });
  it('centers on a click inside the viewport without recentering after a drag', () => {
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    try {
      render(<App initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'near', name: 'Near' }), smallSheetDocument({ id: 'far', name: 'Far', position: { x: 4000, y: 0 } })])} />);
      const map = screen.getByRole('img', { name: 'Workspace map' });
      map.getBoundingClientRect = () => testRect({ left: 0, top: 0, width: 200, height: 130 });
      Object.assign(map, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => true });
      const outline = map.querySelector('.workspace-minimap-viewport')!;
      const x = Number(outline.getAttribute('x')) + Number(outline.getAttribute('width')) * 0.75;
      const y = Number(outline.getAttribute('y')) + Number(outline.getAttribute('height')) / 2;
      const surface = screen.getByTestId('workspace-surface');
      fireEvent.pointerDown(map, { button: 0, pointerId: 1, clientX: x, clientY: y });
      fireEvent.pointerUp(map, { pointerId: 1, clientX: x, clientY: y });
      expect(Number(surface.dataset.viewportX)).toBeLessThan(0);
      const nextX = Number(outline.getAttribute('x')) + Number(outline.getAttribute('width')) / 2;
      const nextY = Number(outline.getAttribute('y')) + Number(outline.getAttribute('height')) / 2;
      fireEvent.pointerDown(map, { button: 0, pointerId: 2, clientX: nextX, clientY: nextY });
      fireEvent.pointerMove(map, { pointerId: 2, clientX: nextX + 20, clientY: nextY });
      const moved = surface.dataset.viewportX;
      fireEvent.pointerUp(map, { pointerId: 2, clientX: nextX + 20, clientY: nextY });
      expect(surface.dataset.viewportX).toBe(moved);
    } finally { vi.unstubAllGlobals(); }
  });
  it.each([true, false])('ignores captured minimap moves and release after a wheel zoom interrupts the drag (moved: %s)', (moved) => {
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    const callbacks = new Map<number, FrameRequestCallback>();
    let next = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callbacks.set(++next, callback); return next; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { callbacks.delete(id); });
    const frame = () => act(() => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach((callback) => callback(performance.now())); });
    try {
      render(<App initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'near', name: 'Near' }), smallSheetDocument({ id: 'far', name: 'Far', position: { x: 4000, y: 0 } })])} />);
      const map = screen.getByRole('img', { name: 'Workspace map' });
      map.getBoundingClientRect = () => testRect({ left: 0, top: 0, width: 200, height: 130 });
      Object.assign(map, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => true });
      const outline = map.querySelector('.workspace-minimap-viewport')!;
      const x = Number(outline.getAttribute('x')) + Number(outline.getAttribute('width')) / 2;
      const y = Number(outline.getAttribute('y')) + Number(outline.getAttribute('height')) / 2;
      const surface = screen.getByTestId('workspace-surface');
      fireEvent.pointerDown(map, { button: 0, pointerId: 3, clientX: x, clientY: y });
      if (moved) fireEvent.pointerMove(map, { pointerId: 3, clientX: x + 10, clientY: y });
      fireEvent.wheel(surface, { ctrlKey: true, deltaY: -100, clientX: 300, clientY: 200 });
      frame();
      const zoomed = { ...surface.dataset };
      expect(Number(zoomed.viewportScale)).toBeGreaterThan(1);
      if (moved) fireEvent.pointerMove(map, { pointerId: 3, clientX: x + 30, clientY: y });
      fireEvent.pointerUp(map, { pointerId: 3, clientX: x + 30, clientY: y });
      expect(surface.dataset.viewportX).toBe(zoomed.viewportX);
      expect(surface.dataset.viewportScale).toBe(zoomed.viewportScale);
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });
  it('tracks real wheel previews and disables navigation while a dialog owns the workspace', () => {
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    const callbacks = new Map<number, FrameRequestCallback>();
    let next = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callbacks.set(++next, callback); return next; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { callbacks.delete(id); });
    const frame = () => act(() => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach((callback) => callback(performance.now())); });
    try {
      render(<App initialWorkbook={workbookWithSheets([
        smallSheetDocument({ id: 'near', name: 'Near' }),
        smallSheetDocument({ id: 'far', name: 'Far', position: { x: 4000, y: 0 } }),
      ])} />);
      const map = screen.getByRole('img', { name: 'Workspace map' });
      map.getBoundingClientRect = () => testRect({ left: 0, top: 0, width: 200, height: 130 });
      const outline = map.querySelector('.workspace-minimap-viewport')!;
      const before = outline.getAttribute('x');
      const surface = screen.getByTestId('workspace-surface');
      fireEvent.pointerDown(surface, { button: 1, buttons: 4, pointerId: 9, clientX: 300, clientY: 100 });
      fireEvent.pointerMove(surface, { buttons: 4, pointerId: 9, clientX: 100, clientY: 100 });
      frame();
      expect(outline.getAttribute('x')).not.toBe(before);
      fireEvent.pointerUp(surface, { button: 1, pointerId: 9, clientX: 100, clientY: 100 });
      const width = outline.getAttribute('width');
      fireEvent.wheel(surface, { ctrlKey: true, deltaY: -100, clientX: 300, clientY: 200 });
      frame();
      expect(outline.getAttribute('width')).not.toBe(width);
      fireEvent.click(screen.getByRole('button', { name: 'New sheet' }));
      expect(screen.getByRole('button', { name: 'Hide workspace map' })).toBeDisabled();
      const position = surface.dataset.viewportX;
      fireEvent.pointerDown(map, { button: 0, pointerId: 1, clientX: 190, clientY: 65 });
      expect(surface.dataset.viewportX).toBe(position);
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });
  it('conceals the map during maximised presentation and restores its visibility preference', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    try {
      render(<App initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'near', name: 'Near' })])} />);
      const frame = screen.getByRole('article', { name: 'Sheet Near' });
      fireEvent.click(within(frame).getByRole('cell', { name: 'Near A1 empty cell' }));
      fireEvent.click(within(frame).getByRole('button', { name: 'Maximise Near' }));
      expect(screen.queryByRole('img', { name: 'Workspace map' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Restore to workspace' }));
      expect(screen.getByRole('img', { name: 'Workspace map' })).toBeInTheDocument();
    } finally { vi.unstubAllGlobals(); }
  });
  it('updates rectangles when sheets are created and deleted', async () => {
    const workbook = workbookWithSheets([smallSheetDocument({ id: 'near', name: 'Near' })]);
    render(<App apiClient={persistedWorkbookClient(workbook)} initialWorkbook={workbook} />);
    const map = screen.getByRole('img', { name: 'Workspace map' });
    const count = () => map.querySelectorAll('.workspace-minimap-sheet').length;
    expect(count()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'New sheet' }));
    fireEvent.change(screen.getByLabelText('Sheet name'), { target: { value: 'Created' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(count()).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
    fireEvent.click(screen.getByRole('button', { name: /Delete sheet/ }));
    await waitFor(() => expect(count()).toBe(1));
  });
});
