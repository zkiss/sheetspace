import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceSurface } from './WorkspaceSurface';
import { useWorkspaceController } from './useWorkspaceController';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (document as unknown as { timeline?: unknown }).timeline; });

function setup() {
  vi.stubGlobal('KeyframeEffect', class {});
  Object.defineProperty(document, 'timeline', { configurable: true, value: { currentTime: 1000 } });
  let controller!: ReturnType<typeof useWorkspaceController>;
  function Harness() {
    controller = useWorkspaceController({ onCreateSheet: vi.fn(), onClearSelection: vi.fn() });
    return <WorkspaceSurface hasSheets isPanningWorkspace={controller.isPanningWorkspace}
      navigationMotion={controller.navigationMotion} onContextMenu={controller.handleWorkspaceContextMenu}
      viewport={controller.viewport} workspacePlaneRef={controller.workspacePlaneRef}
      workspaceSurfaceRef={controller.workspaceSurfaceRef}>{null}</WorkspaceSurface>;
  }
  const view = render(<Harness />);
  const plane = screen.getByTestId('workspace-plane');
  const animation = { cancel: vi.fn(), currentTime: 40, effect: null, onfinish: null as (() => void) | null };
  Object.defineProperty(plane, 'animate', { configurable: true, value: () => animation });
  Object.defineProperty(plane, 'getAnimations', { configurable: true, value: () => [animation] });
  return { get controller() { return controller; }, animation, plane, view };
}

it('cancels only its motion and commits the displayed viewport', () => {
  const app = setup();
  const cancelled = vi.fn();
  let cancel!: () => void;
  act(() => { cancel = app.controller.restoreViewport({ x: 300, y: 200, scale: 2 }, vi.fn(), cancelled); });
  const original = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    const style = original(element);
    if (element === app.plane) Object.defineProperty(style, 'transform', { configurable: true, value: 'matrix(1.5, 0, 0, 1.5, 12, 34)' });
    return style;
  });
  app.animation.cancel.mockClear();
  act(cancel);
  expect(app.animation.cancel).toHaveBeenCalledOnce();
  expect(cancelled).toHaveBeenCalledOnce();
  expect(app.controller.viewport).toEqual({ x: 12, y: 34, scale: 1.5 });
  act(cancel);
  expect(cancelled).toHaveBeenCalledOnce();
});

it('notifies replacement and ignores an obsolete disposer', () => {
  const app = setup();
  const cancelled = vi.fn();
  let cancel!: () => void;
  act(() => { cancel = app.controller.restoreViewport({ x: 300, y: 200, scale: 2 }, vi.fn(), cancelled); });
  act(() => { app.controller.restoreViewport({ x: 600, y: 400, scale: 1 }, vi.fn()); });
  expect(cancelled).toHaveBeenCalledOnce();
  app.animation.cancel.mockClear();
  act(cancel);
  expect(app.animation.cancel).not.toHaveBeenCalled();
});

it('notifies cancellation on unmount', () => {
  const app = setup();
  const cancelled = vi.fn();
  act(() => { app.controller.restoreViewport({ x: 300, y: 200, scale: 2 }, vi.fn(), cancelled); });
  app.view.unmount();
  expect(cancelled).toHaveBeenCalledOnce();
});
