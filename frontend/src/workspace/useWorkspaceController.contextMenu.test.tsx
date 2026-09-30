import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkspaceController } from './useWorkspaceController';

function setup() {
  const create = vi.fn();
  const clear = vi.fn();
  let controller: ReturnType<typeof useWorkspaceController>;
  function Harness() {
    controller = useWorkspaceController({ onCreateSheet: create, onClearSelection: clear });
    return <section ref={controller.workspaceSurfaceRef} data-testid="surface" onContextMenu={controller.handleWorkspaceContextMenu}>
      <div data-testid="plane" />
      <input data-testid="input" /><textarea data-testid="textarea" /><select data-testid="select" />
      <div data-testid="editable" contentEditable /><div data-testid="textbox" role="textbox" />
      <button data-testid="control"><span data-testid="control-label">Control</span></button>
      <a data-testid="link" href="#">Link</a>
      <div data-testid="menu" role="menu"><span data-testid="menu-label">Menu text</span></div>
      <section data-testid="inspector" data-workspace-native-content><code data-testid="code">Formula text</code></section>
      <article data-testid="sheet" data-sheet-id="owned" data-workspace-sheet-frame />
      <div data-testid="consumed" onContextMenu={(event) => event.preventDefault()} />
    </section>;
  }
  render(<Harness />);
  return { create, clear, state: () => controller!, target: (name: string) => screen.getByTestId(name) };
}

function contextMenu(target: Element, consumed = false) {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 60 });
  if (consumed) event.preventDefault();
  fireEvent(target, event);
  return event;
}

describe('canvas context-menu eligibility', () => {
  it.each(['input', 'textarea', 'select', 'editable', 'textbox', 'control', 'control-label', 'link', 'menu', 'menu-label', 'inspector', 'code', 'sheet'])(
    'does not consume or create on %s', (name) => {
      const { create, clear, state, target } = setup();
      expect(contextMenu(target(name)).defaultPrevented).toBe(false);
      expect(create).not.toHaveBeenCalled();
      expect(clear).not.toHaveBeenCalled();
      expect(state().viewport).toEqual({ x: 0, y: 0, scale: 1 });
    },
  );

  it.each(['surface', 'plane'])('creates exactly once from background %s', (name) => {
    const { create, target } = setup();
    expect(contextMenu(target(name)).defaultPrevented).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({ x: 40, y: 60 }, 1, 'Create sheet here');
  });

  it('honors pre-consumed events and consumption by a descendant before any side effects', () => {
    const { create, clear, target } = setup();
    contextMenu(target('surface'), true);
    contextMenu(target('consumed'));
    expect(create).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });
});
