import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { measuredElementGeometry, testRect } from '@test-support/domGeometry';
import { WorkspaceMinimap } from './WorkspaceMinimap';
import { WorkspaceSurface } from './WorkspaceSurface';
import { useWorkspaceController } from './useWorkspaceController';

it('tracks interpolated controller navigation and interrupts it from the map', () => {
  vi.stubGlobal('KeyframeEffect', class {});
  Object.defineProperty(document, 'timeline', { configurable: true, value: { currentTime: 1000 } });
  const animation = { playState: 'running', cancel: vi.fn(), currentTime: 40, effect: null, onfinish: null as (() => void) | null };
  const callbacks = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callbacks.set(++sequence, callback); return sequence; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { callbacks.delete(id); });
  let controller: ReturnType<typeof useWorkspaceController>;
  function Harness() {
    controller = useWorkspaceController({ onCreateSheet: vi.fn(), onClearSelection: vi.fn(), shouldRenderPanViewport: () => false });
    return <WorkspaceSurface hasSheets isPanningWorkspace={controller.isPanningWorkspace}
      navigationMotion={controller.navigationMotion} viewport={controller.viewport}
      workspacePlaneRef={controller.workspacePlaneRef} workspaceSurfaceRef={controller.workspaceSurfaceRef}
      overlay={<WorkspaceMinimap frames={[{ id: 'near', name: 'Near', position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, visualScale: 1, zIndex: 1 }, { id: 'far', name: 'Far', position: { x: 4000, y: 0 }, size: { width: 200, height: 100 }, visualScale: 1, zIndex: 1 }]} surface={controller.workspaceSurfaceSize} viewport={controller.viewport}
        surfaceRef={controller.workspaceSurfaceRef} concealed={false} disabled={false}
        begin={controller.beginMinimapNavigation} move={controller.moveMinimapViewport} finish={controller.endMinimapNavigation} />}>
      {null}
    </WorkspaceSurface>;
  }
  try {
    render(<Harness />);
    const surface = screen.getByTestId('workspace-surface');
    act(() => { measuredElementGeometry(surface, { width: 800, height: 600 }); });
    const plane = screen.getByTestId('workspace-plane');
    Object.defineProperty(plane, 'animate', { configurable: true, value: () => animation });
    Object.defineProperty(plane, 'getAnimations', { configurable: true, value: () => [animation] });
    let transform = 'matrix(1, 0, 0, 1, 0, 0)';
    const computed = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = computed(element);
      if (element === plane) Object.defineProperty(style, 'transform', { configurable: true, value: transform });
      return style;
    });
    act(() => { controller.restoreViewport({ x: -800, y: 0, scale: 1 }, vi.fn()); });
    const map = screen.getByRole('img', { name: 'Workspace map' });
    map.getBoundingClientRect = () => testRect({ left: 0, top: 0, width: 200, height: 130 });
    const outline = map.querySelector('.workspace-minimap-viewport')!;
    const initial = outline.getAttribute('x');
    transform = 'matrix(1, 0, 0, 1, -300, 0)';
    act(() => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach((callback) => callback(16)); });
    expect(outline.getAttribute('x')).not.toBe(initial);
    fireEvent.pointerDown(map, { button: 0, pointerId: 1, clientX: 190, clientY: 65 });
    expect(animation.cancel).toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (document as unknown as { timeline?: unknown }).timeline;
  }
});
