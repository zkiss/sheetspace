import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testRect } from '@test-support/domGeometry';
import { WorkspaceMinimap } from './WorkspaceMinimap';

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; this.pointerType = init.pointerType ?? ''; this.isPrimary = init.isPrimary ?? false; }
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
  it.each([50, 185])('retains the captured touch owner when another contact begins at %i', (secondX) => {
    const { map, props, begin, move } = setup();
    for (const button of [1, 2]) fireEvent.pointerDown(map, { button, pointerId: 9, clientX: 50, clientY: 60 });
    expect(begin).not.toHaveBeenCalled();
    fireEvent.pointerDown(map, { button: 0, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 50, clientY: 60 });
    fireEvent.pointerDown(map, { button: 0, pointerId: 2, pointerType: 'touch', clientX: secondX, clientY: 60 });
    fireEvent.pointerDown(map, { button: 0, pointerId: 1, clientX: 50, clientY: 60 });
    fireEvent.pointerMove(map, { pointerId: 2, clientX: 100, clientY: 60 });
    fireEvent.pointerUp(map, { pointerId: 2 });
    fireEvent.pointerCancel(map, { pointerId: 2 });
    fireEvent.lostPointerCapture(map, { pointerId: 2 });
    expect(begin).toHaveBeenCalledOnce();
    expect(map.setPointerCapture).toHaveBeenCalledOnce();
    expect(map.releasePointerCapture).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    expect(props.finish).not.toHaveBeenCalled();
    fireEvent.pointerMove(map, { pointerId: 1, clientX: 70, clientY: 60 });
    const moved = move.mock.calls[0][0];
    fireEvent.pointerMove(map, { pointerId: 1, clientX: 50, clientY: 60 });
    expect(moved.x).toBeLessThan(0);
    fireEvent.pointerUp(map, { pointerId: 1, clientX: 50, clientY: 60 });
    fireEvent.lostPointerCapture(map, { pointerId: 1 });
    expect(move).toHaveBeenCalledTimes(2);
    expect(props.finish).toHaveBeenCalledOnce();
    fireEvent.pointerDown(map, { button: 0, pointerId: 3, clientX: 185, clientY: 65 });
    expect(begin).toHaveBeenCalledTimes(2);
    expect(props.finish).toHaveBeenCalledTimes(2);
  });
  it.each(['disabled', 'concealed', 'hidden', 'unmount'])('ends an active drag on %s without clicking', (transition) => {
    const { map, props, rerender, surfaceRef, unmount, move } = setup();
    fireEvent.pointerDown(map, { button: 0, pointerId: 1, clientX: 50, clientY: 60 });
    if (transition === 'unmount') unmount();
    else if (transition === 'hidden') fireEvent.click(screen.getByRole('button', { name: 'Hide workspace map' }));
    else rerender(<section ref={surfaceRef}><WorkspaceMinimap {...props} disabled={transition === 'disabled'} concealed={transition === 'concealed'} /></section>);
    expect(props.finish).toHaveBeenCalledOnce();
    expect(move).not.toHaveBeenCalled();
    if (transition === 'disabled' || transition === 'concealed') expect(map.releasePointerCapture).toHaveBeenCalledWith(1);
    fireEvent.pointerUp(map, { pointerId: 1, clientX: 50, clientY: 60 });
    expect(props.finish).toHaveBeenCalledOnce();
  });
  it('ends captured drags once on release, capture loss, concealment and unmount', () => {
    const { map, props, rerender, surfaceRef, unmount } = setup();
    const start = () => fireEvent.pointerDown(map, { button: 0, pointerId: 1, clientX: 50, clientY: 60 });
    start();
    fireEvent.pointerUp(map, { pointerId: 1 });
    fireEvent.lostPointerCapture(map, { pointerId: 1 });
    expect(props.finish).toHaveBeenCalledTimes(1);
    start();
    fireEvent.lostPointerCapture(map, { pointerId: 1 });
    expect(props.finish).toHaveBeenCalledTimes(2);
    start();
    rerender(<section ref={surfaceRef}><WorkspaceMinimap {...props} concealed /></section>);
    expect(props.finish).toHaveBeenCalledTimes(3);
    rerender(<section ref={surfaceRef}><WorkspaceMinimap {...props} /></section>);
    start();
    unmount();
    expect(props.finish).toHaveBeenCalledTimes(4);
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
