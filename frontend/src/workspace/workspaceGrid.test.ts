import { describe, expect, it, vi } from 'vitest';
import { drawWorkspaceGrid, workspaceGridGeometry } from './workspaceGrid';

describe('workspace grid geometry', () => {
  it.each([0.001, 0.125, 0.5, 1, 1.5, 2, 8])('keeps grid levels aligned to the world at scale %s', (scale) => {
    const grid = workspaceGridGeometry({ scale, x: -137, y: 89 });
    expect(grid.majorSize).toBeGreaterThanOrEqual(40);
    expect(grid.majorSize).toBeLessThanOrEqual(80);
    expect(grid.minorSize).toBe(grid.majorSize / 2);
    expect(grid.fineSize).toBe(grid.majorSize / 4);
    expect(grid.majorX).toBe(-137 % grid.majorSize);
    expect(grid.fineY).toBe(89 % grid.fineSize);
    expect(grid.minorOpacity).toBeGreaterThanOrEqual(0.35);
    expect(grid.minorOpacity).toBeLessThanOrEqual(1);
    expect(grid.fineOpacity).toBeGreaterThanOrEqual(0);
    expect(grid.fineOpacity).toBeLessThanOrEqual(0.35);
  });
});

describe('workspace canvas drawing', () => {
  it('scales the backing store and draws world-aligned lines', () => {
    const canvas = document.createElement('canvas');
    Object.defineProperties(canvas, { clientWidth: { value: 100 }, clientHeight: { value: 60 } });
    const context = { setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), strokeStyle: '', lineWidth: 0 };
    vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const ratio = vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2);
    drawWorkspaceGrid(canvas, { scale: 1, x: -5, y: 3 });
    expect([canvas.width, canvas.height]).toEqual([200, 120]);
    expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 100, 60);
    expect(context.moveTo).toHaveBeenCalledWith(35.5, 0);
    expect(context.moveTo).toHaveBeenCalledWith(0, 3.5);
    expect(context.stroke).toHaveBeenCalledTimes(2);
    ratio.mockRestore();
  });

  it('does nothing for an empty surface or unavailable context', () => {
    const canvas = document.createElement('canvas');
    const getContext = vi.spyOn(canvas, 'getContext').mockReturnValue(null);
    drawWorkspaceGrid(canvas, { scale: 1, x: 0, y: 0 });
    expect(getContext).not.toHaveBeenCalled();
    Object.defineProperties(canvas, { clientWidth: { value: 10 }, clientHeight: { value: 10 } });
    drawWorkspaceGrid(canvas, { scale: 1, x: 0, y: 0 });
    expect(getContext).toHaveBeenCalledOnce();
  });
});
