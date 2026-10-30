import { createElement, useLayoutEffect } from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceController } from '@workspace/useWorkspaceController';
import { measuredElementGeometry } from '@test-support/domGeometry';

function workspaceElement(width: number, height: number) {
  const element = document.createElement('section');
  Object.defineProperty(element, 'clientWidth', { value: width });
  Object.defineProperty(element, 'clientHeight', { value: height });
  return element;
}

describe('useWorkspaceController', () => {
  afterEach(() => vi.useRealTimers());
  it('tracks the outer surface measurement and ResizeObserver changes', () => {
    let currentController: ReturnType<typeof useWorkspaceController> | undefined;

    function Harness() {
      const controller = useWorkspaceController({ onCreateSheet: vi.fn(), onClearSelection: vi.fn() });
      useLayoutEffect(() => {
        currentController = controller;
      });
      return createElement('section', { ref: controller.workspaceSurfaceRef });
    }

    render(createElement(Harness));
    const surface = currentController?.workspaceSurfaceRef.current;
    expect(surface).toBeInstanceOf(HTMLElement);

    let geometry: ReturnType<typeof measuredElementGeometry> | undefined;
    act(() => {
      geometry = measuredElementGeometry(surface!, { height: 600, width: 800 });
    });
    expect(currentController?.workspaceSurfaceSize).toEqual({ height: 600, width: 800 });

    act(() => geometry!.resize({ height: 480, width: 640 }));
    expect(currentController?.workspaceSurfaceSize).toEqual({ height: 480, width: 640 });
  });

  it('pans, compounds multiplicative zoom around an origin, clamps zoom, and resets viewport state', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWorkspaceController({ onCreateSheet: vi.fn(), onClearSelection: vi.fn() }));

    act(() => result.current.panWorkspace(80, -40));
    expect(result.current.viewport).toEqual({ x: 80, y: -40, scale: 1 });

    act(() => result.current.zoomWorkspace(1.5, { x: 100, y: 100 }));
    expect(result.current.viewport).toEqual({ x: 70, y: -110, scale: 1.5 });

    act(() => {
      result.current.zoomWorkspaceBy(1.2);
      result.current.zoomWorkspaceBy(1.2);
    });
    act(() => vi.advanceTimersByTime(150));
    expect(result.current.viewport.scale).toBeCloseTo(2.16);

    act(() => result.current.zoomWorkspace(10));
    expect(result.current.viewport.scale).toBe(8);

    act(() => result.current.resetViewport());
    expect(result.current.viewport).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it('retires pending navigation work before every outer user viewport change', () => {
    const onBeforeUserMovement = vi.fn();
    const { result } = renderHook(() => useWorkspaceController({
      onBeforeUserMovement,
      onCreateSheet: vi.fn(),
      onClearSelection: vi.fn(),
    }));

    act(() => result.current.panWorkspace(80, -40));
    act(() => result.current.zoomWorkspaceBy(1.2));
    act(() => result.current.resetViewport());

    expect(onBeforeUserMovement).toHaveBeenCalledTimes(3);
  });

  it('saturates repeated finite pans before viewport coordinates overflow', () => {
    const { result } = renderHook(() => useWorkspaceController({ onCreateSheet: vi.fn(), onClearSelection: vi.fn() }));

    act(() => {
      result.current.panWorkspace(Number.MAX_VALUE, -Number.MAX_VALUE);
      result.current.panWorkspace(Number.MAX_VALUE, -Number.MAX_VALUE);
    });

    expect(result.current.viewport).toEqual({
      x: Number.MAX_VALUE,
      y: -Number.MAX_VALUE,
      scale: 1,
    });
    expect(Number.isFinite(result.current.viewport.x)).toBe(true);
    expect(Number.isFinite(result.current.viewport.y)).toBe(true);
  });

  it('uses the surface center as the toolbar zoom origin', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWorkspaceController({ onCreateSheet: vi.fn(), onClearSelection: vi.fn() }));
    act(() => { result.current.workspaceSurfaceRef.current = workspaceElement(1000, 800); });
    act(() => result.current.zoomWorkspaceBy(1.2));
    act(() => vi.advanceTimersByTime(150));

    expect(result.current.viewport).toEqual({ x: -100, y: -80, scale: 1.2 });
  });

  it('creates sheets at the current viewport center and clears an open sheet menu', () => {
    const onCreateSheet = vi.fn();
    const { result } = renderHook(() => useWorkspaceController({ onCreateSheet, onClearSelection: vi.fn() }));

    act(() => result.current.panWorkspace(100, 50));
    act(() => {
      result.current.workspaceSurfaceRef.current = workspaceElement(1000, 800);
      result.current.createSheetAtViewportCenter();
    });

    expect(onCreateSheet).toHaveBeenCalledWith({ x: 280, y: 270 }, 1, 'Create sheet at viewport center', expect.any(Function));
    expect(result.current.pendingSheetMenu).toBeNull();
  });

  it('preserves fractional placement after viewport geometry is resolved', () => {
    const onCreateSheet = vi.fn();
    const { result } = renderHook(() => useWorkspaceController({ onCreateSheet, onClearSelection: vi.fn() }));

    act(() => {
      result.current.workspaceSurfaceRef.current = workspaceElement(1001, 801);
      result.current.zoomWorkspaceBy(1.2);
      result.current.createSheetAtViewportCenter();
    });

    expect(onCreateSheet).toHaveBeenCalledWith({ x: 400.50000000000006, y: 333.8333333333333 }, 1.2, 'Create sheet at viewport center', expect.any(Function));
  });
  it('continues confirmed creations but resets after movement away and back', () => {
    const onCreateSheet = vi.fn();
    const { result, rerender } = renderHook(() => useWorkspaceController({ onCreateSheet, onClearSelection: vi.fn() }));
    result.current.workspaceSurfaceRef.current = workspaceElement(1000, 800);
    act(() => result.current.createSheetAtViewportCenter());
    act(() => onCreateSheet.mock.calls[0][3]());
    rerender();
    act(() => result.current.createSheetAtViewportCenter());
    expect(onCreateSheet.mock.calls[1][0]).toEqual({ x: 416, y: 356 });
    act(() => onCreateSheet.mock.calls[1][3]());
    act(() => result.current.panWorkspace(30, 0));
    act(() => result.current.panWorkspace(-30, 0));
    act(() => result.current.createSheetAtViewportCenter());
    expect(onCreateSheet.mock.calls[2][0]).toEqual({ x: 380, y: 320 });
  });

  it('does not advance a cancelled intent and resets after zoom preview', () => {
    const onCreateSheet = vi.fn();
    const { result } = renderHook(() => useWorkspaceController({ onCreateSheet, onClearSelection: vi.fn() }));
    result.current.workspaceSurfaceRef.current = workspaceElement(1000, 800);
    act(() => result.current.createSheetAtViewportCenter());
    act(() => result.current.createSheetAtViewportCenter());
    expect(onCreateSheet.mock.calls[1][0]).toEqual(onCreateSheet.mock.calls[0][0]);
    act(() => onCreateSheet.mock.calls[1][3]());
    act(() => result.current.zoomWorkspaceBy(1.2));
    act(() => result.current.createSheetAtViewportCenter());
    expect(onCreateSheet.mock.calls[2][0]).toEqual({ x: 400, y: 333.33333333333337 });
  });

});
