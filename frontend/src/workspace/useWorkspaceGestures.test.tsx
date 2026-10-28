import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceController } from './useWorkspaceController';
import { measuredElementGeometry } from '@test-support/domGeometry';

afterEach(() => vi.useRealTimers());

function setup() {
  const childAction = vi.fn();
  const clearSelection = vi.fn();
  const renders = vi.fn();
  let controller: ReturnType<typeof useWorkspaceController>;
  function Harness() {
    renders();
    controller = useWorkspaceController({ onCreateSheet: vi.fn(), onClearSelection: clearSelection });
    return <section ref={controller.workspaceSurfaceRef} data-testid="surface">
      <div className="workspace-grid" data-testid="grid" />
      <div ref={controller.workspacePlaneRef} data-testid="plane" />
      <div data-sheet-id="sheet" data-workspace-sheet-frame onContextMenu={(event) => controller.openSheetMenu('sheet', event)} onPointerDown={childAction} onWheel={(event) => event.stopPropagation()}>
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
  return { ...view, surface, childAction, clearSelection, capture, renders, state: () => controller! };
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
  it('bounds controller renders during a coalesced wheel preview', () => {
    vi.useFakeTimers();
    const { surface, renders, state } = setup();
    renders.mockClear();
    act(() => {
      for (let i = 0; i < 20; i++) wheel(surface, { ctrlKey: true, deltaY: -2, clientX: 120, clientY: 80 });
    });
    expect(renders.mock.calls.length).toBeLessThanOrEqual(2);
    renders.mockClear();
    act(() => vi.advanceTimersByTime(16));
    expect(renders).not.toHaveBeenCalled();
    expect(state().viewport.scale).toBe(1);
    expect(Number(surface.dataset.viewportScale)).toBeGreaterThan(1);
    act(() => vi.advanceTimersByTime(150));
    expect(renders.mock.calls.length).toBeLessThanOrEqual(4);
    expect(state().viewport.scale).toBeGreaterThan(1);
  });

  it('coalesces wheel zoom previews and commits the exact anchored burst', () => {
    vi.useFakeTimers();
    const { surface, state } = setup();
    const frame = vi.spyOn(window, 'requestAnimationFrame');
    act(() => {
      for (let i = 0; i < 4; i++) wheel(surface, { ctrlKey: true, deltaY: -2, clientX: 120, clientY: 80 });
    });
    expect(frame).toHaveBeenCalledTimes(1);
    expect(state().viewport).toEqual({ x: 0, y: 0, scale: 1 });
    act(() => vi.advanceTimersByTime(16));
    expect(state().viewport).toEqual({ x: 0, y: 0, scale: 1 });
    const x = Number(surface.dataset.viewportX);
    const y = Number(surface.dataset.viewportY);
    const scale = Math.exp(64 / 500);
    expect(x).toBeCloseTo(120 * (1 - scale));
    expect(y).toBeCloseTo(80 * (1 - scale));
    expect(screen.getByTestId('grid').style.transform).toContain(`${x}px`);
    act(() => vi.advanceTimersByTime(150));
    expect(state().viewport.scale).toBeCloseTo(scale);
    expect(state().viewport.x).toBeCloseTo(x);
    expect(state().viewport.y).toBeCloseTo(y);
    frame.mockRestore();
  });

  it.each([[0, 32, 0], [1, 0, 3], [2, 0.04, 0.08]])('keeps ordinary mode %s scrolling inert on the background', (deltaMode, deltaX, deltaY) => {
    const { surface, state } = setup();
    expect(wheel(surface, { deltaMode, deltaX, deltaY }).defaultPrevented).toBe(true);
    expect(state().viewport).toEqual({ x: 0, y: 0, scale: 1 });
    expect(state().navigationInterrupted).toBe(false);
  });

  it('leaves ordinary grid, editor and control wheel defaults alone, including grid edges', () => {
    const { state } = setup();
    for (const target of [screen.getByRole('cell'), screen.getByText('Header'), screen.getByRole('separator'), screen.getByRole('textbox'), screen.getByRole('button')]) {
      expect(wheel(target, { deltaX: 80, deltaY: 100 }).defaultPrevented).toBe(false);
    }
    expect(state().viewport).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it('preserves the menu, focused cell and selection when scrolling with Space held', () => {
    const { surface, state, clearSelection } = setup();
    const cell = screen.getByRole('cell');
    cell.focus();
    fireEvent.contextMenu(cell, { clientX: 40, clientY: 60 });
    const menu = state().pendingSheetMenu;
    expect(menu).not.toBeNull();
    fireEvent.keyDown(cell, { code: 'Space' });
    wheel(surface, { deltaX: 80, deltaY: 100 });
    wheel(cell, { deltaX: 80, deltaY: 100 });
    expect(state().pendingSheetMenu).toBe(menu);
    expect(cell).toHaveFocus();
    expect(clearSelection).not.toHaveBeenCalled();
    expect(state().isPanningWorkspace).toBe(false);
    expect(state().navigationInterrupted).toBe(false);
    expect(state().viewport).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it.each(['ctrlKey', 'metaKey'] as const)('anchors rapid %s zoom across sheet propagation boundaries', (modifier) => {
    vi.useFakeTimers();
    const { state } = setup();
    act(() => {
      wheel(screen.getByRole('cell'), { [modifier]: true, deltaY: -100, clientX: 120, clientY: 80 });
      wheel(screen.getByRole('textbox'), { [modifier]: true, deltaY: -100, clientX: 120, clientY: 80 });
    });
    act(() => vi.advanceTimersByTime(150));
    const { x, y, scale } = state().viewport;
    expect(scale).toBeGreaterThan(1.2);
    expect((120 - x) / scale).toBeCloseTo(120);
    expect((80 - y) / scale).toBeCloseTo(80);
  });

  it('preserves the small Ctrl-wheel synthetic-pinch sensitivity and pointer anchor', () => {
    vi.useFakeTimers();
    const { surface, state } = setup();
    expect(wheel(surface, { ctrlKey: true, deltaY: -2, clientX: 120, clientY: 80 }).defaultPrevented).toBe(true);
    act(() => vi.advanceTimersByTime(150));
    const { x, y, scale } = state().viewport;
    expect(scale).toBeCloseTo(Math.exp(16 / 500));
    expect((120 - x) / scale).toBeCloseTo(120);
    expect((80 - y) / scale).toBeCloseTo(80);
  });

  it('composes cumulative native gesture scales without applying the full scale twice', () => {
    vi.useFakeTimers();
    const { state } = setup();
    for (const [type, scale] of [['gesturestart', 1], ['gesturechange', 1.5], ['gesturechange', 2], ['gestureend', 2]] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { scale, clientX: 100, clientY: 100 });
      fireEvent(screen.getByRole('cell'), event);
      expect(event.defaultPrevented).toBe(true);
    }
    act(() => vi.advanceTimersByTime(150));
    expect(state().viewport).toEqual({ x: -100, y: -100, scale: 2 });
  });

  it('preserves reference motion through extreme repeated ordinary wheel input', () => {
    const { surface, state } = setup();
    act(() => state().zoomWorkspaceBy(2));
    act(() => state().navigateToTarget({ left: 1e9, top: -1e9, right: 1e9 + 200, bottom: -1e9 + 100 }));
    expect(state().navigationInterrupted).toBe(false);
    const destination = state().viewport;
    act(() => {
      wheel(surface, { deltaX: Number.MAX_VALUE, deltaY: -Number.MAX_VALUE, deltaMode: 2 });
      wheel(surface, { deltaX: Number.MAX_VALUE, deltaY: -Number.MAX_VALUE, deltaMode: 2 });
    });
    expect(Object.values(state().viewport).every(Number.isFinite)).toBe(true);
    expect(state().viewport).toEqual(destination);
    expect(state().navigationInterrupted).toBe(false);
  });

  it('keeps extreme explicit wheel zoom finite and interrupts reference motion', () => {
    const { surface, state } = setup();
    act(() => state().navigateToTarget({ left: 1e9, top: -1e9, right: 1e9 + 200, bottom: -1e9 + 100 }));
    act(() => {
      wheel(surface, { ctrlKey: true, deltaY: -Number.MAX_VALUE, deltaMode: 2 });
      wheel(surface, { ctrlKey: true, deltaY: Number.MAX_VALUE, deltaMode: 2 });
    });
    expect(Object.values(state().viewport).every(Number.isFinite)).toBe(true);
    expect(state().navigationInterrupted).toBe(true);
  });
});

describe('workspace pointer ownership and lifecycle', () => {
  it('coalesces drag previews, aligns the grid, and commits the final unpainted move', () => {
    vi.useFakeTimers();
    const { surface, state } = setup();
    fireEvent.keyDown(screen.getByRole('cell'), { code: 'Space' });
    pointer(screen.getByRole('cell'), 'pointerdown');
    const frame = vi.spyOn(window, 'requestAnimationFrame');
    act(() => {
      pointer(surface, 'pointermove', { clientX: 10, clientY: 5 });
      pointer(surface, 'pointermove', { clientX: 25, clientY: 15 });
      pointer(surface, 'pointermove', { clientX: 35, clientY: 25 });
    });
    expect(frame).toHaveBeenCalledTimes(1);
    expect(state().viewport).toEqual({ x: 0, y: 0, scale: 1 });
    act(() => vi.advanceTimersByTime(16));
    expect(state().viewport).toEqual({ x: 0, y: 0, scale: 1 });
    expect(screen.getByTestId('plane').style.transform).toContain('35px');
    expect(screen.getByTestId('grid').style.transform).toBe('translate(35px, 25px)');
    pointer(surface, 'pointermove', { clientX: 49, clientY: 33 });
    pointer(surface, 'pointerup');
    expect(state().viewport).toEqual({ x: 49, y: 33, scale: 1 });
    expect(screen.getByTestId('grid').style.transform).toBe('translate(9px, 33px)');
    frame.mockRestore();
  });

  it('ends a focused-cell Space pan on keyup before pointerup and releases capture', () => {
    const { surface, state, capture, clearSelection } = setup();
    const cell = screen.getByRole('cell');
    cell.focus();
    fireEvent.keyDown(cell, { key: ' ', code: 'Space' });
    pointer(cell, 'pointerdown');
    expect(cell).not.toHaveFocus();
    expect(clearSelection).toHaveBeenCalledOnce();
    expect(capture.has(7)).toBe(true);
    pointer(surface, 'pointermove', { clientX: 10 });
    fireEvent.keyUp(document.body, { key: ' ', code: 'Space' });
    expect(state().isPanningWorkspace).toBe(false);
    expect(capture.size).toBe(0);
    expect(surface.releasePointerCapture).toHaveBeenCalledWith(7);
    pointer(surface, 'pointermove', { clientX: 30 });
    expect(state().viewport.x).toBe(10);
  });

  it('retains held Space through cell blur and pointerup for a second focused-cell drag', () => {
    const { surface, state, capture } = setup();
    const cell = screen.getByRole('cell');
    cell.focus();
    fireEvent.keyDown(cell, { key: ' ', code: 'Space' });
    for (let index = 0; index < 2; index++) {
      cell.focus();
      expect(pointer(cell, 'pointerdown').defaultPrevented).toBe(true);
      expect(cell).not.toHaveFocus();
      expect(capture.has(7)).toBe(true);
      pointer(surface, 'pointermove', { clientX: 10 });
      pointer(surface, 'pointerup');
      expect(capture.size).toBe(0);
    }
    expect(state().viewport.x).toBe(20);
    fireEvent.keyUp(document.body, { code: 'Space' });
    expect(pointer(cell, 'pointerdown').defaultPrevented).toBe(false);
  });

  it('ignores element blur during a pan but cancels capture and held Space on window focus loss', () => {
    const { surface, state, capture } = setup();
    const cell = screen.getByRole('cell');
    cell.focus();
    fireEvent.keyDown(cell, { code: 'Space' });
    pointer(cell, 'pointerdown');
    cell.focus();
    cell.blur();
    expect(state().isPanningWorkspace).toBe(true);
    expect(capture.has(7)).toBe(true);
    fireEvent(window, new Event('blur'));
    expect(state().isPanningWorkspace).toBe(false);
    expect(capture.size).toBe(0);
    pointer(surface, 'pointermove', { clientX: 30 });
    expect(state().viewport.x).toBe(0);
    expect(pointer(cell, 'pointerdown').defaultPrevented).toBe(false);
  });

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

  it.each(['pointerup', 'pointercancel', 'lostpointercapture', 'blur', 'visibility', 'keyup', 'buttons', 'escape'])('releases pan on %s and permits a fresh gesture', (ending) => {
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
    else if (ending === 'escape') expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(false);
    else if (ending === 'buttons') pointer(surface, 'pointermove', { buttons: 0, clientX: 100 });
    else pointer(surface, ending);
    expect(state().isPanningWorkspace).toBe(false);
    expect(capture.size).toBe(0);
    pointer(surface, 'pointermove', { clientX: 100 });
    expect(state().viewport.x).toBe(0);
    pointer(surface, 'pointerdown', { button: 1, buttons: 4 });
    pointer(surface, 'pointermove', { buttons: 4, clientX: 25 });
    pointer(surface, 'pointerup', { button: 1 });
    expect(state().viewport.x).toBe(25);
  });

  it('leaves idle Escape native but cancels held Space without invoking grid actions', () => {
    const { childAction, clearSelection, state } = setup();
    const cell = screen.getByRole('cell');
    expect(fireEvent.keyDown(cell, { key: 'Escape' })).toBe(true);
    childAction.mockClear();
    fireEvent.keyDown(cell, { code: 'Space' });
    expect(fireEvent.keyDown(cell, { key: 'Escape' })).toBe(false);
    expect(childAction).not.toHaveBeenCalled();
    expect(clearSelection).not.toHaveBeenCalled();
    expect(pointer(cell, 'pointerdown').defaultPrevented).toBe(false);
    expect(state().isPanningWorkspace).toBe(false);
  });

  it('cancels a native pinch on Escape and ignores subsequent gesture changes until a new start', () => {
    const { surface, state } = setup();
    const gesture = (type: string, scale: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { scale, clientX: 100, clientY: 100 });
      fireEvent(surface, event);
    };
    gesture('gesturestart', 1);
    gesture('gesturechange', 1.5);
    const viewport = state().viewport;
    expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(false);
    gesture('gesturechange', 2);
    gesture('gesturechange', 3);
    expect(state().viewport).toEqual(viewport);
  });

  it('coalesces native pinch changes and commits the last anchored preview', () => {
    vi.useFakeTimers();
    const { surface, state } = setup();
    const frame = vi.spyOn(window, 'requestAnimationFrame');
    const gesture = (type: string, scale: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { scale, clientX: 100, clientY: 100 });
      fireEvent(surface, event);
    };

    act(() => {
      gesture('gesturestart', 1);
      gesture('gesturechange', 1.1);
      gesture('gesturechange', 1.3);
      gesture('gesturechange', 1.5);
    });
    expect(frame).toHaveBeenCalledTimes(1);
    expect(state().viewport).toEqual({ x: 0, y: 0, scale: 1 });
    act(() => vi.advanceTimersByTime(16));
    expect(Number(surface.dataset.viewportScale)).toBeCloseTo(1.5);
    expect(Number(surface.dataset.viewportX)).toBeCloseTo(-50);
    expect(Number(surface.dataset.viewportY)).toBeCloseTo(-50);
    expect(screen.getByTestId('grid').style.transform).toContain(`${surface.dataset.viewportX}px`);
    act(() => gesture('gestureend', 1.5));
    act(() => vi.advanceTimersByTime(150));
    expect(state().viewport.scale).toBeCloseTo(1.5);
    expect(state().viewport.x).toBeCloseTo(-50);
    expect(state().viewport.y).toBeCloseTo(-50);
    frame.mockRestore();
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
