import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceSurface } from './WorkspaceSurface';
import { useWorkspaceController } from './useWorkspaceController';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (document as unknown as { timeline?: unknown }).timeline; });

function pointer(target: Element | Window, type: string, props: MouseEventInit = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...props });
  Object.defineProperty(event, 'pointerId', { value: 7 });
  fireEvent(target, event);
}

function setup(onBeforeUserMovement?: () => void) {
  vi.stubGlobal('KeyframeEffect', class {});
  Object.defineProperty(document, 'timeline', { configurable: true, value: { currentTime: 1000 } });
  let controller!: ReturnType<typeof useWorkspaceController>;
  function Harness() {
    controller = useWorkspaceController({ onCreateSheet: vi.fn(), onClearSelection: vi.fn(), onBeforeUserMovement });
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

it.each(['reset', 'freeze', 'interrupt'] as const)('does not cancel a successor started by the user-movement callback during %s', (action) => {
  let startSuccessor = () => {};
  const app = setup(() => startSuccessor());
  const successorCancelled = vi.fn();
  act(() => { app.controller.restoreViewport({ x: 300, y: 200, scale: 2 }); });
  startSuccessor = () => {
    app.controller.restoreViewport({ x: 600, y: 400, scale: 1 }, vi.fn(), successorCancelled);
    app.animation.cancel.mockClear();
  };
  act(() => {
    if (action === 'reset') app.controller.resetViewport();
    else if (action === 'freeze') app.controller.freezeDisplayedViewport();
    else app.controller.panWorkspace(1, 0);
  });
  expect(app.animation.cancel).not.toHaveBeenCalled();
  expect(successorCancelled).not.toHaveBeenCalled();
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

it('does not cancel a reused animation through its previous disposer', () => {
  const app = setup();
  const Effect = class { setKeyframes = vi.fn(); updateTiming = vi.fn(); };
  vi.stubGlobal('KeyframeEffect', Effect);
  const effect = new Effect();
  Object.assign(app.animation, { effect });
  let cancel!: () => void;
  act(() => { cancel = app.controller.restoreViewport({ x:  300, y: 200, scale: 2 }); });
  app.animation.cancel.mockClear();
  act(() => { app.controller.restoreViewport({ x: 600, y: 400, scale: 1 }); });
  act(cancel);
  expect(app.animation.cancel).not.toHaveBeenCalled();
  expect(effect.setKeyframes).toHaveBeenCalledOnce();
});

it('notifies cancellation on unmount', () => {
  const app = setup();
  const cancelled = vi.fn();
  act(() => { app.controller.restoreViewport({ x: 300, y: 200, scale: 2 }, vi.fn(), cancelled); });
  app.view.unmount();
  expect(cancelled).toHaveBeenCalledOnce();
});

it.each(['reset', 'freeze', 'interrupt'] as const)('does not cancel a successor started during %s cancellation', (action) => {
  const app = setup();
  let successorCancelled = false;
  act(() => {
    app.controller.restoreViewport({ x: 300, y: 200, scale: 2 }, vi.fn(), () => {
      app.controller.restoreViewport({ x: 600, y: 400, scale: 1 }, vi.fn(), () => { successorCancelled = true; });
      app.animation.cancel.mockClear();
    });
  });
  act(() => {
    if (action === 'reset') app.controller.resetViewport();
    else if (action === 'freeze') app.controller.freezeDisplayedViewport(true);
    else app.controller.panWorkspace(1, 0);
  });
  expect(app.animation.cancel).not.toHaveBeenCalled();
  expect(successorCancelled).toBe(false);
});

it.each(['movement', 'cancellation'] as const)('preserves the settled destination of a successor started by the %s callback during pan', (source) => {
  let startSuccessor = () => {};
  const app = setup(() => { if (source === 'movement') startSuccessor(); });
  const settled = vi.fn();
  const cancelled = vi.fn();
  act(() => {
    app.controller.restoreViewport({ x: 300, y: 200, scale: 2 }, vi.fn(), () => {
      if (source === 'cancellation') startSuccessor();
    });
  });
  startSuccessor = () => {
    app.controller.restoreViewport({ x: 600, y: 400, scale: 1 }, settled, cancelled);
    app.animation.cancel.mockClear();
  };
  act(() => app.controller.panWorkspace(10, 20));
  expect(app.animation.cancel).not.toHaveBeenCalled();
  expect(app.controller.viewport).toEqual({ x: 600, y: 400, scale: 1 });
  act(() => app.animation.onfinish?.());
  expect(settled).toHaveBeenCalledOnce();
  expect(cancelled).not.toHaveBeenCalled();
  expect(app.controller.viewport).toEqual({ x: 600, y: 400, scale: 1 });
});

it('rejects a successor started by unmount cancellation', () => {
  const app = setup();
  const successorCancelled = vi.fn();
  act(() => {
    app.controller.restoreViewport({ x: 300, y: 200, scale: 2 }, vi.fn(), () => {
      app.controller.restoreViewport({ x: 600, y: 400, scale: 1 }, vi.fn(), successorCancelled);
    });
  });
  app.view.unmount();
  expect(successorCancelled).toHaveBeenCalledOnce();
});

it.each([
  ['movement', 0], ['movement', 1], ['cancellation', 0], ['cancellation', 1],
] as const)('rejects pointer pan when %s starts a successor with button %s', (source, button) => {
  let startSuccessor = () => {};
  const app = setup(() => { if (source === 'movement') startSuccessor(); });
  const surface = app.plane.parentElement!;
  surface.setPointerCapture = vi.fn();
  const settled = vi.fn();
  const cancelled = vi.fn();
  act(() => { app.controller.restoreViewport({ x: 300, y: 200, scale: 2 }, vi.fn(), () => {
    if (source === 'cancellation') startSuccessor();
  }); });
  const oldFinish = app.animation.onfinish!;
  startSuccessor = () => { app.controller.restoreViewport({ x: 600, y: 400, scale: 1 }, settled, cancelled); };
  pointer(surface, 'pointerdown', { button, buttons: button === 1 ? 4 : 1 });
  pointer(window, 'pointermove', { button, buttons: button === 1 ? 4 : 1, clientX: 50, clientY: 30 });
  pointer(window, 'pointerup', { button, buttons: 0 });
  act(oldFinish);
  expect(surface.setPointerCapture).not.toHaveBeenCalled();
  expect(app.controller.isPanningWorkspace).toBe(false);
  expect(app.controller.viewport).toEqual({ x: 600, y: 400, scale: 1 });
  expect(settled).not.toHaveBeenCalled();
  act(() => app.animation.onfinish?.());
  expect(settled).toHaveBeenCalledOnce();
  expect(cancelled).not.toHaveBeenCalled();
  expect(app.controller.viewport).toEqual({ x: 600, y: 400, scale: 1 });
});

it('retains stale pointer ownership across a second interruption and ignores queued preview frames', () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const app = setup();
  const surface = app.plane.parentElement!;
  pointer(surface, 'pointerdown');
  pointer(window, 'pointermove', { clientX: 10, clientY: 20 });
  const staleFrame = frames[frames.length - 1];
  const settled = vi.fn();
  act(() => app.controller.restoreViewport({ x: 700, y: 400, scale: 1 }, settled));
  const gesture = new Event('gesturestart', { bubbles: true, cancelable: true });
  Object.assign(gesture, { scale: 1, clientX: 0, clientY: 0 });
  fireEvent(surface, gesture);
  act(() => app.controller.restoreViewport({ x: 600, y: 400, scale: 1 }, settled));
  pointer(window, 'pointermove', { clientX: 50, clientY: 60 });
  pointer(window, 'pointerup', { buttons: 0 });
  act(() => staleFrame(1000));
  expect(app.controller.viewport).toEqual({ x: 600, y: 400, scale: 1 });
  act(() => app.animation.onfinish?.());
  expect(settled).toHaveBeenCalledOnce();
});

it('preserves a reduced-motion successor against a rejected pointer session', () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  let startSuccessor = () => {};
  const app = setup(() => startSuccessor());
  const settled = vi.fn();
  act(() => { app.controller.restoreViewport({ x: 300, y: 200, scale: 2 }); });
  startSuccessor = () => { app.controller.restoreViewport({ x: 600, y: 400, scale: 1 }, settled); };
  pointer(app.plane.parentElement!, 'pointerdown');
  pointer(window, 'pointermove', { clientX: 50 });
  pointer(window, 'pointerup', { buttons: 0 });
  act(() => vi.runAllTimers());
  expect(settled).toHaveBeenCalledOnce();
  expect(app.controller.viewport).toEqual({ x: 600, y: 400, scale: 1 });
});
