import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkspaceGestures } from './useWorkspaceGestures';

const NATIVE_TARGETS = ['input', 'textarea', 'select', 'editable', 'textbox', 'control', 'link', 'menu', 'menu-label', 'menu-unit', 'inspector'];
const OWNERS = [...NATIVE_TARGETS, 'sheet', 'portal', 'surface', 'plane'];

function setup() {
  const actions = { start: vi.fn(), pan: vi.fn(), zoom: vi.fn(), closeMenu: vi.fn(), clearSelection: vi.fn() };
  const competingAction = vi.fn();
  function Harness() {
    const ref = useRef<HTMLElement>(null);
    useWorkspaceGestures(ref, actions);
    return <>
      <section ref={ref} data-testid="surface" onPointerDown={competingAction} onWheel={competingAction}>
        <div data-testid="plane" />
        <article data-workspace-sheet-frame data-sheet-id="owned" data-testid="sheet" />
        <input data-testid="input" />
        <textarea data-testid="textarea" />
        <select data-testid="select"><option>Choice</option></select>
        <div data-testid="editable" contentEditable suppressContentEditableWarning>Editable</div>
        <div data-testid="textbox" role="textbox" tabIndex={0}>Custom editor</div>
        <button data-testid="control">Control</button>
        <a data-testid="link" href="#">Link</a>
        <div data-testid="menu" role="menu">
          <label data-testid="menu-label">Label</label><span data-testid="menu-unit">%</span>
        </div>
        <section data-testid="inspector" data-workspace-native-content>Formula</section>
      </section>
      <textarea data-testid="portal" data-workspace-sheet-editor="owned" />
      <textarea data-testid="foreign" data-workspace-sheet-editor="foreign" />
    </>;
  }
  const view = render(<Harness />);
  return { ...view, actions, competingAction, target: (name: string) => screen.getByTestId(name) };
}

function pointer(target: Element | Window, type: string, button = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button, buttons: button === 1 ? 4 : 1, clientX: 40, clientY: 60 });
  Object.assign(event, { pointerId: 17 });
  fireEvent(target, event);
  return event;
}

function gesture(target: Element, type: string, scale: number, consumed = false) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { scale, clientX: 40, clientY: 60 });
  if (consumed) event.preventDefault();
  fireEvent(target, event);
  return event;
}

describe('workspace target × native-event ownership', () => {
  it.each([...NATIVE_TARGETS, 'sheet', 'portal'])('leaves ordinary %s pointer/wheel native without canvas effects', (name) => {
    const { actions, target } = setup();
    expect(pointer(target(name), 'pointerdown').defaultPrevented).toBe(false);
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
    fireEvent(target(name), wheel);
    expect(wheel.defaultPrevented).toBe(false);
    for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
  });

  it.each(['surface', 'plane'])('keeps %s ordinary pan and wheel canvas-owned', (name) => {
    const { actions, competingAction, target } = setup();
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 30, deltaY: 50 });
    fireEvent(target(name), wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(actions.pan).toHaveBeenCalledOnce();
    expect(actions.pan).toHaveBeenCalledWith(-30, -50);
    expect(pointer(target(name), 'pointerdown').defaultPrevented).toBe(true);
    expect(actions.start).toHaveBeenCalledOnce();
    expect(actions.clearSelection).toHaveBeenCalledOnce();
    expect(actions.closeMenu).toHaveBeenCalledOnce();
    expect(competingAction).not.toHaveBeenCalled();
  });

  describe.each(OWNERS)('explicit gestures over %s', (name) => {
    it.each(['ctrlKey', 'metaKey'] as const)('consumes %s wheel and dispatches zoom exactly once', (modifier) => {
      const { actions, competingAction, target } = setup();
      const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, [modifier]: true, deltaY: -100, clientX: 40, clientY: 60 });
      fireEvent(target(name), wheel);
      expect(wheel.defaultPrevented).toBe(true);
      expect(actions.zoom).toHaveBeenCalledOnce();
      expect(actions.zoom).toHaveBeenCalledWith(expect.any(Number), { x: 40, y: 60 });
      expect(actions.zoom.mock.calls[0][0]).toBeGreaterThan(1);
      expect(actions.clearSelection).not.toHaveBeenCalled();
      expect(actions.closeMenu).not.toHaveBeenCalled();
      expect(competingAction).not.toHaveBeenCalled();
    });

    it.each(['middle', 'space'])('consumes %s pan before competing handlers and blurs exactly once', (kind) => {
      const { actions, competingAction, target } = setup();
      const blur = vi.fn();
      const editor = target('portal');
      editor.addEventListener('blur', blur);
      editor.focus();
      if (kind === 'space') fireEvent.keyDown(document.body, { code: 'Space' });
      expect(pointer(target(name), 'pointerdown', kind === 'middle' ? 1 : 0).defaultPrevented).toBe(true);
      expect(blur).toHaveBeenCalledOnce();
      expect(actions.clearSelection).toHaveBeenCalledOnce();
      expect(actions.closeMenu).toHaveBeenCalledOnce();
      expect(actions.start).toHaveBeenCalledOnce();
      expect(competingAction).not.toHaveBeenCalled();
      const context = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      fireEvent(target(name), context);
      expect(context.defaultPrevented).toBe(true);
      pointer(window, 'pointerup', kind === 'middle' ? 1 : 0);
      for (const type of ['click', 'auxclick', 'dblclick']) {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, detail: 1 });
        fireEvent(target(name), event);
        expect(event.defaultPrevented).toBe(true);
      }
    });

    it('consumes pinch once per event without clearing focus/selection, resets and removes listeners', () => {
      const { actions, target, unmount } = setup();
      const editor = target('portal');
      editor.focus();
      for (const [type, scale] of [['gesturestart', 1], ['gesturechange', 1.5], ['gesturechange', 2], ['gestureend', 2]] as const) {
        expect(gesture(target(name), type, scale).defaultPrevented).toBe(true);
      }
      expect(actions.start).toHaveBeenCalledOnce();
      expect(actions.zoom.mock.calls).toEqual([[1.5, { x: 40, y: 60 }], [2 / 1.5, { x: 40, y: 60 }]]);
      expect(actions.clearSelection).not.toHaveBeenCalled();
      expect(editor).toHaveFocus();
      expect(gesture(target(name), 'gestureend', 2).defaultPrevented).toBe(false);
      const previousTarget = target(name);
      unmount();
      expect(gesture(previousTarget, 'gesturestart', 1).defaultPrevented).toBe(false);
      expect(actions.start).toHaveBeenCalledOnce();
    });
  });

  it.each([...NATIVE_TARGETS, 'portal'])('does not turn focused %s Space into pan', (name) => {
    const { actions, target } = setup();
    expect(fireEvent.keyDown(target(name), { code: 'Space', cancelable: true })).toBe(true);
    expect(pointer(target(name), 'pointerdown').defaultPrevented).toBe(false);
    expect(actions.clearSelection).not.toHaveBeenCalled();
  });

  it('does not forward any explicit event from a foreign editor or let it alter an owned pinch', () => {
    const { actions, target } = setup();
    expect(gesture(target('portal'), 'gesturestart', 1).defaultPrevented).toBe(true);
    expect(pointer(target('foreign'), 'pointerdown', 1).defaultPrevented).toBe(false);
    for (const modifier of ['ctrlKey', 'metaKey']) {
      const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, [modifier]: true, deltaY: -100 });
      fireEvent(target('foreign'), wheel);
      expect(wheel.defaultPrevented).toBe(false);
    }
    for (const [type, scale] of [['gesturestart', 1], ['gesturechange', 3], ['gestureend', 3]] as const) {
      expect(gesture(target('foreign'), type, scale).defaultPrevented).toBe(false);
    }
    expect(actions.clearSelection).not.toHaveBeenCalled();
    expect(actions.zoom).not.toHaveBeenCalled();
    gesture(target('portal'), 'gesturechange', 1.5);
    expect(actions.zoom).toHaveBeenCalledOnce();
    expect(actions.zoom).toHaveBeenCalledWith(1.5, { x: 40, y: 60 });
  });

  it('honors consumed explicit events without disturbing an active pinch', () => {
    const { actions, target } = setup();
    const surface = target('surface');
    for (const event of [
      new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 }),
      new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 1 }),
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: 'Space' }),
    ]) {
      event.preventDefault();
      fireEvent(surface, event);
    }
    gesture(surface, 'gesturestart', 1, true);
    expect(actions.start).not.toHaveBeenCalled();
    expect(actions.zoom).not.toHaveBeenCalled();
    expect(actions.clearSelection).not.toHaveBeenCalled();
    gesture(surface, 'gesturestart', 1);
    gesture(surface, 'gesturechange', 3, true);
    gesture(surface, 'gestureend', 3, true);
    gesture(surface, 'gesturechange', 1.5);
    expect(actions.zoom).toHaveBeenCalledOnce();
    expect(actions.zoom).toHaveBeenCalledWith(1.5, { x: 40, y: 60 });
    fireEvent(window, new Event('blur'));
    expect(gesture(surface, 'gestureend', 1.5).defaultPrevented).toBe(false);
  });
});
