import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { measuredElementGeometry } from '@test-support/domGeometry';
import * as motion from './navigationViewportMotion';
import { WorkspaceSurface } from './WorkspaceSurface';
import { useWorkspaceController } from './useWorkspaceController';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (document as unknown as { timeline?: unknown }).timeline; });

it('retargets the same animation at the sampled clock and ignores its stale finish callback', () => {
  const setKeyframes = vi.fn();
  const updateTiming = vi.fn();
  class Effect { setKeyframes = setKeyframes; updateTiming = updateTiming; }
  vi.stubGlobal('KeyframeEffect', Effect);
  Object.defineProperty(document, 'timeline', { configurable: true, value: { currentTime: 1234 } });
  const animation = { effect: new Effect(), currentTime: 80, startTime: 0, onfinish: null as (() => void) | null, cancel: vi.fn() };
  const animate = vi.fn(() => animation);
  let controller: ReturnType<typeof useWorkspaceController>;
  function Harness() {
    controller = useWorkspaceController({ onCreateSheet: vi.fn(), onClearSelection: vi.fn() });
    return <WorkspaceSurface hasSheets isPanningWorkspace={controller.isPanningWorkspace}
      navigationMotion={controller.navigationMotion} onContextMenu={controller.handleWorkspaceContextMenu}
      viewport={controller.viewport} workspacePlaneRef={controller.workspacePlaneRef}
      workspaceSurfaceRef={controller.workspaceSurfaceRef}>{null}</WorkspaceSurface>;
  }
  render(<Harness />);
  const surface = screen.getByTestId('workspace-surface');
  const plane = screen.getByTestId('workspace-plane');
  measuredElementGeometry(surface, { width: 800, height: 600 });
  Object.defineProperty(plane, 'animate', { configurable: true, value: animate });
  Object.defineProperty(plane, 'getAnimations', { configurable: true, value: () => [animation] });
  const createMotion = vi.spyOn(motion, 'navigationViewportMotion');
  const firstSettled = vi.fn();
  const secondSettled = vi.fn();
  act(() => controller.restoreViewport({ x: -300, y: -100, scale: 1.1 }, firstSettled));
  const firstMotion = createMotion.mock.results[0].value;
  const incoming = firstMotion.sample(80);
  const computedStyle = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    const style = computedStyle(element);
    if (element === plane) Object.defineProperty(style, 'transform', { configurable: true, value: `matrix(${incoming.viewport.scale}, 0, 0, ${incoming.viewport.scale}, ${incoming.viewport.x}, ${incoming.viewport.y})` });
    return style;
  });
  const staleFinish = animation.onfinish!;
  act(() => controller.restoreViewport({ x: -600, y: -200, scale: 1.2 }, secondSettled));
  animation.cancel.mockClear();
  expect(animate).toHaveBeenCalledOnce();
  expect(setKeyframes).toHaveBeenCalledOnce();
  expect(updateTiming).toHaveBeenCalledOnce();
  expect(animation.startTime).toBe(1234);
  expect(createMotion.mock.calls[1][0]).toEqual(incoming.viewport);
  expect(createMotion.mock.calls[1][1]).toEqual({ x: -600, y: -200, scale: 1.2 });
  expect(createMotion.mock.calls[1][2]).toEqual(incoming.velocity);
  expect(createMotion.mock.calls[1][3]).toEqual(incoming.acceleration);
  act(() => staleFinish());
  expect(animation.cancel).not.toHaveBeenCalled();
  expect(secondSettled).not.toHaveBeenCalled();
  act(() => animation.onfinish!());
  expect(animation.cancel).toHaveBeenCalledOnce();
  expect(firstSettled).not.toHaveBeenCalled();
  expect(secondSettled).toHaveBeenCalledOnce();
  expect(controller!.viewport).toEqual({ x: -600, y: -200, scale: 1.2 });
});

it('cancels the active animation and its settlement when a pan interrupts navigation', () => {
  vi.stubGlobal('KeyframeEffect', class {});
  Object.defineProperty(document, 'timeline', { configurable: true, value: { currentTime: 1000 } });
  const animation = { cancel: vi.fn(), currentTime: 40, effect: null, onfinish: null as (() => void) | null };
  let controller: ReturnType<typeof useWorkspaceController>;
  function Harness() {
    controller = useWorkspaceController({ onCreateSheet: vi.fn(), onClearSelection: vi.fn() });
    return <WorkspaceSurface hasSheets isPanningWorkspace={controller.isPanningWorkspace}
      navigationMotion={controller.navigationMotion} onContextMenu={controller.handleWorkspaceContextMenu}
      viewport={controller.viewport} workspacePlaneRef={controller.workspacePlaneRef}
      workspaceSurfaceRef={controller.workspaceSurfaceRef}>{null}</WorkspaceSurface>;
  }
  render(<Harness />);
  const surface = screen.getByTestId('workspace-surface');
  const plane = screen.getByTestId('workspace-plane');
  measuredElementGeometry(surface, { width: 800, height: 600 });
  Object.defineProperty(plane, 'animate', { configurable: true, value: () => animation });
  Object.defineProperty(plane, 'getAnimations', { configurable: true, value: () => [animation] });
  const settled = vi.fn();
  act(() => controller.restoreViewport({ x: -300, y: -100, scale: 1.1 }, settled));
  animation.cancel.mockClear();
  const finish = animation.onfinish!;
  const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 1, buttons: 4, clientX: 100, clientY: 80 });
  Object.defineProperty(down, 'pointerId', { value: 7 });
  fireEvent(surface, down);
  expect(animation.cancel).toHaveBeenCalled();
  const interruptedViewport = controller!.viewport;
  act(() => finish());
  expect(settled).not.toHaveBeenCalled();
  expect(controller!.viewport).toEqual(interruptedViewport);
  expect(controller!.navigationInterrupted).toBe(true);
});

it('starts a fresh creation sequence after navigation continues and settles', () => {
  vi.stubGlobal('KeyframeEffect', class {});
  Object.defineProperty(document, 'timeline', { configurable: true, value: { currentTime: 1000 } });
  const animation = { cancel: vi.fn(), currentTime: 40, effect: null, onfinish: null as (() => void) | null };
  const onCreateSheet = vi.fn();
  let controller: ReturnType<typeof useWorkspaceController>;
  function Harness() {
    controller = useWorkspaceController({ onCreateSheet, onClearSelection: vi.fn() });
    return <WorkspaceSurface hasSheets isPanningWorkspace={controller.isPanningWorkspace}
      navigationMotion={controller.navigationMotion} onContextMenu={controller.handleWorkspaceContextMenu}
      viewport={controller.viewport} workspacePlaneRef={controller.workspacePlaneRef}
      workspaceSurfaceRef={controller.workspaceSurfaceRef}>{null}</WorkspaceSurface>;
  }
  render(<Harness />);
  const surface = screen.getByTestId('workspace-surface');
  const plane = screen.getByTestId('workspace-plane');
  measuredElementGeometry(surface, { width: 800, height: 600 });
  Object.defineProperty(plane, 'animate', { configurable: true, value: () => animation });
  Object.defineProperty(plane, 'getAnimations', { configurable: true, value: () => [animation] });
  act(() => controller.restoreViewport({ x: -300, y: -100, scale: 1 }));
  act(() => controller.createSheetAtViewportCenter());
  act(() => onCreateSheet.mock.calls[0][3]());
  animation.currentTime = 80;
  act(() => controller.createSheetAtViewportCenter());
  expect(onCreateSheet.mock.calls[1][0]).toEqual(onCreateSheet.mock.calls[0][0]);
  animation.currentTime = 100;
  act(() => onCreateSheet.mock.calls[1][3]());
  act(() => controller.createSheetAtViewportCenter());
  expect(onCreateSheet.mock.calls[2][0]).toEqual(onCreateSheet.mock.calls[0][0]);
  act(() => onCreateSheet.mock.calls[2][3]());
  animation.currentTime = 120;
  act(() => animation.onfinish!());
  act(() => controller.createSheetAtViewportCenter());
  expect(onCreateSheet.mock.calls[3][0]).toEqual({ x: 580, y: 320 });
});
