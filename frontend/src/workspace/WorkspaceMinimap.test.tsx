import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testRect } from '@test-support/domGeometry';
import { WorkspaceMinimap } from './WorkspaceMinimap';

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
}
vi.stubGlobal('PointerEvent', TestPointerEvent);

const viewport = { x: 0, y: 0, scale: 1 };
const frames = [{ id: 'one', name: 'One', position: { x: 1200, y: 0 }, size: { width: 200, height: 100 }, visualScale: 2, zIndex: 1 }];
function setup(disabled = false) {
  const surfaceRef = createRef<HTMLElement>();
  const begin = vi.fn(() => viewport);
  const move = vi.fn();
  const props = { frames, surface: { width: 1000, height: 800 }, viewport, surfaceRef, disabled, concealed: false, begin, move, finish: vi.fn() };
  const result = render(<section ref={surfaceRef}><WorkspaceMinimap {...props} /></section>);
  const map = screen.getByRole('img', { name: 'Workspace map' });
  map.getBoundingClientRect = () => testRect({ left: 0, top: 0, width: 200, height: 130 });
  Object.assign(map, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => true });
  return { ...result, props, map, move, begin, surfaceRef };
}
afterEach(cleanup);
describe('workspace map', () => {
  it('shows sheet geometry, hides and restores without losing the preference during concealment', () => {
    const { map, rerender, props, surfaceRef } = setup();
    expect(map.querySelectorAll('.workspace-minimap-sheet')).toHaveLength(1);
    expect(map.querySelector('.workspace-minimap-viewport')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide workspace map' }));
    rerender(<section ref={surfaceRef}><WorkspaceMinimap {...props} concealed /></section>);
    rerender(<section ref={surfaceRef}><WorkspaceMinimap {...props} /></section>);
    fireEvent.click(screen.getByRole('button', { name: 'Show workspace map' }));
    expect(screen.getByRole('img', { name: 'Workspace map' })).toBeInTheDocument();
  });
  it('centers on a click outside the viewport and isolates events', () => {
    const { map, move, begin } = setup();
    fireEvent.pointerDown(map, { button: 0, pointerId: 1, clientX: 185, clientY: 65 });
    expect(begin).toHaveBeenCalledOnce();
    expect(move).toHaveBeenCalledOnce();
    expect(move.mock.calls[0][0].scale).toBe(1);
  });
  it('captures a viewport drag with stable mapping and cancels it', () => {
    const { map, move } = setup();
    fireEvent.pointerDown(map, { button: 0, pointerId: 1, clientX: 50, clientY: 60 });
    fireEvent.pointerMove(map, { pointerId: 1, clientX: 70, clientY: 70 });
    expect(map.setPointerCapture).toHaveBeenCalledWith(1);
    expect(move).toHaveBeenCalledOnce();
    expect(move.mock.calls[0][0].x).toBeLessThan(0);
    fireEvent.pointerCancel(map, { pointerId: 1 });
    fireEvent.pointerMove(map, { pointerId: 1, clientX: 90, clientY: 90 });
    expect(move).toHaveBeenCalledOnce();
  });
  it('reflects preview events without parent publication and ignores disabled input', () => {
    const { map, begin, surfaceRef } = setup(true);
    const outline = map.querySelector('.workspace-minimap-viewport')!;
    const initial = outline.getAttribute('width');
    act(() => surfaceRef.current!.dispatchEvent(new CustomEvent('workspace-viewport', { detail: { x: -300, y: 0, scale: 1 } })));
    expect(outline.getAttribute('width')).not.toBe(initial);
    fireEvent.pointerDown(map, { button: 0, pointerId: 1, clientX: 185, clientY: 65 });
    expect(begin).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Hide workspace map' })).toBeDisabled();
  });
});
