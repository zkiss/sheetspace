import { StrictMode, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { measuredElementGeometry } from '@test-support/domGeometry';
import { WorkspaceSurface } from './WorkspaceSurface';
import { useWorkspaceController } from './useWorkspaceController';

afterEach(() => vi.restoreAllMocks());

function setup(transform = 'matrix(1.25, 0, 0, 1.25, -500, -200)') {
  let controller: ReturnType<typeof useWorkspaceController>;
  let reveal: () => void;
  let finishMotion: () => void;
  function Harness() {
    controller = useWorkspaceController({ onCreateSheet: vi.fn() });
    const [moving, setMoving] = useState(false);
    reveal = () => {
      setMoving(true);
      controller.navigateToTarget({ left: 2000, top: 1000, right: 2200, bottom: 1100 });
    };
    finishMotion = () => setMoving(false);
    return <WorkspaceSurface
      hasSheets
      isPanningWorkspace={controller.isPanningWorkspace}
      navigationMotion={moving && !controller.navigationInterrupted && !controller.isPanningWorkspace}
      onContextMenu={controller.handleWorkspaceContextMenu}
      viewport={controller.viewport}
      workspacePlaneRef={controller.workspacePlaneRef}
      workspaceSurfaceRef={controller.workspaceSurfaceRef}
    ><div data-sheet-id="sheet"><div role="cell" tabIndex={0}>Cell</div></div></WorkspaceSurface>;
  }
  render(<StrictMode><Harness /></StrictMode>);
  const surface = screen.getByTestId('workspace-surface');
  const plane = screen.getByTestId('workspace-plane');
  act(() => { measuredElementGeometry(surface, { width: 800, height: 600 }); });
  act(() => reveal());
  expect(plane).toHaveAttribute('data-navigation-motion', 'smooth');
  expect(controller!.viewport).not.toEqual({ x: -500, y: -200, scale: 1.25 });
  const computedStyle = window.getComputedStyle;
  const sample = vi.fn(() => transform);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    const style = computedStyle(element);
    if (element === plane) Object.defineProperty(style, 'transform', { get: sample, configurable: true });
    return style;
  });
  return { surface, plane, sample, reveal: () => reveal(), finishMotion: () => finishMotion(), state: () => controller! };
}

function pointer(target: Element, type: string, button: number, clientX = 100, clientY = 80) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button,
    buttons: button === 1 ? 4 : 1, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: 7 });
  fireEvent(target, event);
}

function gesture(type: string, scale: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { scale, clientX: 100, clientY: 80 });
  fireEvent(screen.getByRole('cell'), event);
}

describe('interrupting displayed reference navigation motion', () => {
  it.each([0, 1])('freezes the visible position on pan button %s without movement, then drags from it', (button) => {
    const { surface, plane, state, sample } = setup();
    const cell = screen.getByRole('cell');
    if (button === 0) fireEvent.keyDown(cell, { code: 'Space' });
    pointer(cell, 'pointerdown', button);
    expect(state().viewport).toEqual({ x: -500, y: -200, scale: 1.25 });
    expect(plane).toHaveAttribute('data-navigation-motion', 'instant');
    expect(plane.style.transform).toBe('translate(-500px, -200px) scale(1.25)');
    pointer(surface, 'pointermove', button, 130, 60);
    expect(state().viewport).toEqual({ x: -470, y: -220, scale: 1.25 });
    pointer(surface, 'pointerup', button, 130, 60);
    expect(state().isPanningWorkspace).toBe(false);
    expect(sample).toHaveBeenCalledOnce();
  });

  it('composes batched wheel pans from the visible position and samples again for a new reveal', () => {
    const { surface, plane, state, sample, reveal } = setup();
    act(() => {
      fireEvent.wheel(surface, { deltaX: 10, deltaY: 20 });
      fireEvent.wheel(surface, { deltaX: 30, deltaY: -5 });
    });
    expect(state().viewport).toEqual({ x: -540, y: -215, scale: 1.25 });
    expect(plane).toHaveAttribute('data-navigation-motion', 'instant');
    expect(sample).toHaveBeenCalledOnce();
    act(() => reveal());
    fireEvent.wheel(surface, { deltaX: 5, deltaY: 10 });
    expect(state().viewport).toEqual({ x: -505, y: -210, scale: 1.25 });
    expect(sample).toHaveBeenCalledTimes(2);
  });

  it.each(['ctrlKey', 'metaKey', 'pinch', 'toolbar'] as const)('anchors %s zoom to the visible workspace point across rapid inputs', (input) => {
    const { plane, state, sample } = setup();
    act(() => {
      if (input === 'pinch') {
        gesture('gesturestart', 1);
        gesture('gesturechange', 1.5);
        gesture('gesturechange', 2);
      } else if (input === 'toolbar') {
        state().zoomWorkspace(1.875, { x: 100, y: 80 });
        state().zoomWorkspaceBy(4 / 3, { x: 100, y: 80 });
      } else {
        fireEvent.wheel(screen.getByRole('cell'), { [input]: true, deltaY: -100, clientX: 100, clientY: 80 });
        fireEvent.wheel(screen.getByRole('cell'), { [input]: true, deltaY: -100, clientX: 100, clientY: 80 });
      }
    });
    const { x, y, scale } = state().viewport;
    expect(scale).toBeGreaterThan(1.25);
    expect((100 - x) / scale).toBeCloseTo((100 + 500) / 1.25);
    expect((80 - y) / scale).toBeCloseTo((80 + 200) / 1.25);
    if (input === 'pinch' || input === 'toolbar') expect(scale).toBeCloseTo(2.5);
    expect(plane).toHaveAttribute('data-navigation-motion', 'instant');
    expect(sample).toHaveBeenCalledOnce();
  });

  it('freezes at native pinch start before its first scale change', () => {
    const { plane, state } = setup();
    gesture('gesturestart', 1);
    expect(state().viewport).toEqual({ x: -500, y: -200, scale: 1.25 });
    expect(plane).toHaveAttribute('data-navigation-motion', 'instant');
  });

  it('accepts browser matrix3d serialization of translation and scale', () => {
    const { surface, state } = setup('matrix3d(1.25, 0, 0, 0, 0, 1.25, 0, 0, 0, 0, 1, 0, -500, -200, 0, 1)');
    fireEvent.wheel(surface, { deltaX: 10, deltaY: 20 });
    expect(state().viewport).toEqual({ x: -510, y: -220, scale: 1.25 });
  });

  it('keeps the destination when motion has already ended', () => {
    const { surface, state, sample, finishMotion } = setup();
    const destination = state().viewport;
    act(() => finishMotion());
    fireEvent.wheel(surface, { deltaX: 10, deltaY: 20 });
    expect(state().viewport).toEqual({ ...destination, x: destination.x - 10, y: destination.y - 20 });
    expect(sample).not.toHaveBeenCalled();
  });

  it.each(['none', 'matrix(NaN, 0, 0, 1, 0, 0)', 'matrix(0, 0, 0, 0, 0, 0)', 'matrix(1, 0)'])(
    'keeps finite logical geometry when no usable displayed transform is available: %s', (transform) => {
      const { surface, state } = setup(transform);
      const destination = state().viewport;
      fireEvent.wheel(surface, { deltaX: 10, deltaY: 20 });
      expect(state().viewport).toEqual({ ...destination, x: destination.x - 10, y: destination.y - 20 });
    },
  );
});
