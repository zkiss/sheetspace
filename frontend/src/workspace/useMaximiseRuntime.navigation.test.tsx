import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceSurface } from './WorkspaceSurface';
import { useMaximiseRuntime } from './useMaximiseRuntime';
import { useWorkspaceController } from './useWorkspaceController';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (document as unknown as { timeline?: unknown }).timeline; });

it('leaves a successor navigation running when it interrupts the restore flyover', async () => {
  let now = 0;
  let tick: FrameRequestCallback = () => {};
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { tick = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('KeyframeEffect', class {});
  Object.defineProperty(document, 'timeline', { configurable: true, value: { currentTime: 1000 } });
  const animation = { cancel: vi.fn(), currentTime: 40, effect: null, onfinish: null as (() => void) | null };
  let controller!: ReturnType<typeof useWorkspaceController>;
  let maximise!: ReturnType<typeof useMaximiseRuntime>;
  function Harness() {
    controller = useWorkspaceController({ onCreateSheet: vi.fn(), onClearSelection: vi.fn() });
    maximise = useMaximiseRuntime(controller, { width: 800, height: 600 }, false, () => true);
    return <WorkspaceSurface hasSheets isPanningWorkspace={controller.isPanningWorkspace}
      navigationMotion={controller.navigationMotion} onContextMenu={controller.handleWorkspaceContextMenu}
      viewport={controller.viewport} workspacePlaneRef={controller.workspacePlaneRef}
      workspaceSurfaceRef={controller.workspaceSurfaceRef}>{null}</WorkspaceSurface>;
  }
  render(<Harness />);
  const plane = screen.getByTestId('workspace-plane');
  Object.defineProperty(plane, 'animate', { configurable: true, value: () => animation });
  Object.defineProperty(plane, 'getAnimations', { configurable: true, value: () => [animation] });
  const saved = { position: { x: 100, y: 200 }, size: { width: 400, height: 300 }, visualScale: 1 };
  act(() => maximise.enter('one', saved));
  now = 475;
  act(() => tick(now));
  act(() => maximise.toggle());
  const interruptedTick = tick;
  const completion = maximise.ensureCanvas();
  const settled = vi.fn();
  const target = { x: -600, y: -200, scale: 1.2 };
  act(() => controller.restoreViewport(target, settled));
  expect(await completion).toBe('cancelled');
  expect(maximise!.currentState().mode).toBe('canvas');
  animation.cancel.mockClear();
  now = 950;
  act(() => interruptedTick(now));
  expect(animation.cancel).not.toHaveBeenCalled();
  act(() => animation.onfinish!());
  expect(settled).toHaveBeenCalledOnce();
  expect(controller!.viewport).toEqual(target);
});
