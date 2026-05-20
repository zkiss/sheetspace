import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkspaceController } from './useWorkspaceController';

function workspaceElement(width: number, height: number) {
  const element = document.createElement('section');
  Object.defineProperty(element, 'clientWidth', { value: width });
  Object.defineProperty(element, 'clientHeight', { value: height });
  return element;
}

describe('useWorkspaceController', () => {
  it('pans, zooms around an origin, clamps zoom, and resets viewport state', () => {
    const { result } = renderHook(() => useWorkspaceController({ onCreateSheet: vi.fn() }));

    act(() => result.current.panWorkspace(80, -40));
    expect(result.current.viewport).toEqual({ x: 80, y: -40, scale: 1 });

    act(() => result.current.zoomWorkspace(1.5, { x: 100, y: 100 }));
    expect(result.current.viewport).toEqual({ x: 70, y: -110, scale: 1.5 });

    act(() => result.current.zoomWorkspace(10));
    expect(result.current.viewport.scale).toBe(2);

    act(() => result.current.resetViewport());
    expect(result.current.viewport).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it('creates sheets at the current viewport center and clears an open sheet menu', () => {
    const onCreateSheet = vi.fn();
    const { result } = renderHook(() => useWorkspaceController({ onCreateSheet }));

    act(() => result.current.panWorkspace(100, 50));
    act(() => {
      result.current.createSheetAtViewportCenter(workspaceElement(1000, 800));
    });

    expect(onCreateSheet).toHaveBeenCalledWith({ x: 400, y: 350 }, 'Create sheet at viewport center');
    expect(result.current.pendingSheetMenu).toBeNull();
  });
});
