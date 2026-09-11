import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkspaceController } from './useWorkspaceController';
import { measuredElementGeometry } from '@test-support/domGeometry';

function setup() {
  const childAction = vi.fn();
  let controller: ReturnType<typeof useWorkspaceController>;
  function Harness() {
    controller = useWorkspaceController({ onCreateSheet: vi.fn() });
    return <section ref={controller.workspaceSurfaceRef} data-testid="surface">
      <div data-sheet-id="sheet" onPointerDown={childAction} onWheel={(event) => event.stopPropagation()}>
        <div role="cell" tabIndex={0} onKeyDown={childAction} onClick={childAction}>Cell</div>
        <header>Header</header><div role="separator">Resize</div>
        <textarea aria-label="Editor" onKeyDown={childAction} />
      </div>
      <button>Control</button>
    </section>;
  }
  const view = render(<StrictMode><Harness /></StrictMode>);
  const surface = screen.getByTestId('surface');
  act(() => { measuredElementGeometry(surface, { width: 800, height: 600 }); });
  const capture = new Set<number>();
  surface.setPointerCapture = vi.fn((id) => { capture.add(id); });
  surface.hasPointerCapture = (id) => capture.has(id);
  surface.releasePointerCapture = vi.fn((id) => { capture.delete(id); });
  return { ...view, surface, childAction, capture, state: () => controller! };
}

function pointer(target: Element | Window, type: string, props: MouseEventInit & { pointerId?: number } = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...props });
  Object.defineProperty(event, 'pointerId', { value: props.pointerId ?? 7 });
  fireEvent(target, event);
  return event;
}

function wheel(target: Element, props: WheelEventInit = {}) {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...props });
  fireEvent(target, event);
  return event;
}

describe('workspace wheel and gesture routing', () => {
  it.each([[0, 32, 48], [1, 2, 3], [2, 0.04, 0.08]])('normalizes mode %s into two-axis canvas pan', (deltaMode, deltaX, deltaY) => {
    const { surface, state } = setup();
    expect(wheel(surface, { deltaMode, deltaX, deltaY }).defaultPrevented).toBe(true);
    expect(state().viewport).toEqual({ x: -32, y: -48, scale: 1 });
  });

  it('leaves ordinary grid, editor and control wheel defaults alone, including grid edges', () => {
    const { state } = setup();
    for (const target of [screen.getByRole('cell'), screen.getByRole('textbox'), screen.getByRole('button')]) {
      expect(wheel(target, { deltaY: 100 }).defaultPrevented).toBe(false);
    }
    expect(state().viewport).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it.each(['ctrlKey', 'metaKey'] as const)('anchors rapid %s zoom across sheet propagation boundaries', (modifier) => {
    const { state } = setup();
    act(() => {
      wheel(screen.getByRole('cell'), { [modifier]: true, deltaY: -100, clientX: 120, clientY: 80 });
      wheel(screen.getByRole('textbox'), { [modifier]: true, deltaY: -100, clientX: 120, clientY: 80 });
    });
    const { x, y, scale } = state().viewport;
    expect(scale).toBeGreaterThan(1.2);
    expect((120 - x) / scale).toBeCloseTo(120);
    expect((80 - y) / scale).toBeCloseTo(80);
  });

  it('composes cumulative native gesture scales without applying the full scale twice', () => {
    const { state } = setup();
    for (const [type, scale] of [['gesturestart', 1], ['gesturechange', 1.5], ['gesturechange', 2], ['gestureend', 2]] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { scale, clientX: 100, clientY: 100 });
      fireEvent(screen.getByRole('cell'), event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(state().viewport).toEqual({ x: -100, y: -100, scale: 2 });
  });

  it('keeps extreme repeated wheel input finite and interrupts reference motion', () => {
    const { surface, state } = setup();
    act(() => state().navigateToTarget({ left: 1e9, top: -1e9, right: 1e9 + 200, bottom: -1e9 + 100 }));
    expect(state().navigationInterrupted).toBe(false);
    act(() => {
      wheel(surface, { deltaX: Number.MAX_VALUE, deltaY: -Number.MAX_VALUE, deltaMode: 2 });
      wheel(surface, { deltaX: Number.MAX_VALUE, deltaY: -Number.MAX_VALUE, deltaMode: 2 });
    });
    expect(Object.values(state().viewport).every(Number.isFinite)).toBe(true);
    expect(state().navigationInterrupted).toBe(true);
  });
});

describe('workspace pointer ownership and lifecycle', () => {
  it.each(['cell', 'header', 'separator'])('Space drag owns %s before sheet handlers and suppresses its click', (kind) => {
    const { surface, state, childAction } = setup();
    const target = kind === 'header' ? screen.getByText('Header') : screen.getByRole(kind);
    const cell = screen.getByRole('cell');
    cell.focus();
    fireEvent.keyDown(cell, { key: ' ', code: 'Space' });
    expect(pointer(target, 'pointerdown').defaultPrevented).toBe(true);
    pointer(surface, 'pointermove', { clientX: 50, clientY: -30 });
    pointer(surface, 'pointerup');
    fireEvent.click(target, { detail: 1 });
    expect(state().viewport).toEqual({ x: 50, y: -30, scale: 1 });
    expect(state().isPanningWorkspace).toBe(false);
    expect(childAction).not.toHaveBeenCalled();
    fireEvent.keyUp(cell, { code: 'Space' });
    pointer(cell, 'pointerdown');
    fireEvent.click(cell, { detail: 1 });
    expect(childAction).toHaveBeenCalledTimes(2);
  });

  it('preserves active editor Space and normal sheet pointers while middle drag works over an editor', () => {
    const { surface, state, childAction } = setup();
    const editor = screen.getByRole('textbox');
    editor.focus();
    expect(fireEvent.keyDown(editor, { key: ' ', code: 'Space' })).toBe(true);
    expect(pointer(editor, 'pointerdown').defaultPrevented).toBe(false);
    expect(childAction).toHaveBeenCalledTimes(2);
    expect(pointer(editor, 'pointerdown', { button: 1, buttons: 4 }).defaultPrevented).toBe(true);
    pointer(surface, 'pointermove', { buttons: 4, clientX: 40, clientY: 20 });
    pointer(surface, 'pointerup', { button: 1 });
    expect(state().viewport).toEqual({ x: 40, y: 20, scale: 1 });
  });

  it.each(['pointerup', 'pointercancel', 'lostpointercapture', 'blur', 'visibility', 'keyup', 'buttons'])('releases pan on %s and permits a fresh gesture', (ending) => {
    const { surface, state, capture } = setup();
    fireEvent.keyDown(document.body, { code: 'Space' });
    pointer(surface, 'pointerdown');
    expect(capture.has(7)).toBe(true);
    pointer(surface, 'pointermove', { pointerId: 99, clientX: 999 });
    pointer(surface, 'pointercancel', { pointerId: 99 });
    expect(state().isPanningWorkspace).toBe(true);
    expect(state().viewport.x).toBe(0);
    if (ending === 'blur') fireEvent(window, new Event('blur'));
    else if (ending === 'visibility') {
      const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      fireEvent(document, new Event('visibilitychange'));
      hidden.mockRestore();
    } else if (ending === 'keyup') fireEvent.keyUp(window, { code: 'Space' });
    else if (ending === 'buttons') pointer(surface, 'pointermove', { buttons: 0, clientX: 100 });
    else pointer(surface, ending);
    expect(state().isPanningWorkspace).toBe(false);
    expect(capture.size).toBe(0);
    pointer(surface, 'pointermove', { clientX: 100 });
    expect(state().viewport.x).toBe(0);
    pointer(surface, 'pointerdown', { button: 1, buttons: 4 });
    pointer(surface, 'pointermove', { buttons: 4, clientX: 25 });
    expect(state().viewport.x).toBe(25);
  });

  it('cleans up capture and listeners across repeated mount cycles', () => {
    for (let index = 0; index < 3; index++) {
      const { surface, unmount, capture } = setup();
      pointer(surface, 'pointerdown');
      expect(capture.size).toBe(1);
      unmount();
      expect(capture.size).toBe(0);
      expect(fireEvent.keyDown(document.body, { code: 'Space', cancelable: true })).toBe(true);
      expect(wheel(surface, { deltaY: 50 }).defaultPrevented).toBe(false);
    }
  });
});
