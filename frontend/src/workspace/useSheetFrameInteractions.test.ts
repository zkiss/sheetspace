import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PointerEvent } from 'react';
import type { SheetFrameLayoutCommands, SheetFrameResizeDirection } from './workspaceContracts';
import { Workbook } from '@workbook/core/model';
import { useSheetFrameInteractions } from '@workspace/useSheetFrameInteractions';
import { mountedWorkspaceFrameIds } from '@workspace/workspaceFrameVirtualization';
import { positionedSheet, workbookWithSheets } from '@test-support/workbookFactories';

function commands() {
  return {
    moveSheetFrame: vi.fn(),
    resizeSheetFrame: vi.fn(),
    setSheetVisualScale: vi.fn(),
  } satisfies SheetFrameLayoutCommands;
}

function pointerEvent({
  button = 0,
  clientX,
  clientY,
  pointerId = 1,
  target,
}: {
  button?: number;
  clientX: number;
  clientY: number;
  pointerId?: number;
  target?: Element;
}) {
  const currentTarget = document.createElement('div');
  currentTarget.setPointerCapture = vi.fn();
  currentTarget.releasePointerCapture = vi.fn();

  return {
    button,
    clientX,
    clientY,
    currentTarget,
    pointerId,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    target: target ?? currentTarget,
  } as unknown as PointerEvent<HTMLElement>;
}

function renderInteractions({
  viewportScale = 1,
  workbook = workbookWithSheets([positionedSheet('sheet-inputs', 'Inputs', { x: 10, y: 20 })]),
}: {
  viewportScale?: number;
  workbook?: Workbook;
} = {}) {
  const testCommands = commands();
  const hook = renderHook(() =>
    useSheetFrameInteractions({
      commands: testCommands,
      viewportScale,
      workbook,
    }),
  );

  return {
    ...hook,
    commands: testCommands,
  };
}

describe('useSheetFrameInteractions', () => {
  it('previews scaled drag movement and commits the final frame position once', () => {
    const { commands: testCommands, result } = renderInteractions({ viewportScale: 2 });

    act(() => {
      result.current.handleSheetFrameDragStart(
        'sheet-inputs',
        pointerEvent({ clientX: 100, clientY: 120 }),
      );
      result.current.handleSheetFrameDragMove(pointerEvent({ clientX: 140, clientY: 150 }));
    });

    expect(result.current.frameLayoutPreview).toMatchObject({
      sheetId: 'sheet-inputs', position: { x: 30, y: 35 },
    });
    expect(result.current.interactionPinnedSheetId).toBe('sheet-inputs');
    expect(testCommands.moveSheetFrame).not.toHaveBeenCalled();

    act(() => {
      result.current.stopSheetFrameDrag(pointerEvent({ clientX: 140, clientY: 150 }));
    });

    expect(result.current.frameLayoutPreview).toBeNull();
    expect(result.current.interactionPinnedSheetId).toBeNull();
    expect(testCommands.moveSheetFrame).toHaveBeenCalledTimes(1);
    expect(testCommands.moveSheetFrame).toHaveBeenCalledWith('sheet-inputs', { x: 30, y: 35 });
  });

  it('accumulates scaled drag movement from total pointer displacement', () => {
    const { commands: testCommands, result } = renderInteractions({ viewportScale: 2 });

    act(() => {
      result.current.handleSheetFrameDragStart(
        'sheet-inputs',
        pointerEvent({ clientX: 100, clientY: 120 }),
      );

      for (let clientX = 101; clientX <= 110; clientX += 1) {
        result.current.handleSheetFrameDragMove(pointerEvent({ clientX, clientY: 120 }));
      }
    });

    expect(result.current.frameLayoutPreview).toMatchObject({ position: { x: 15, y: 20 } });
    act(() => {
      result.current.stopSheetFrameDrag(pointerEvent({ clientX: 110, clientY: 120 }));
    });
    expect(testCommands.moveSheetFrame).toHaveBeenCalledWith('sheet-inputs', { x: 15, y: 20 });
  });

  it('does not commit an unchanged drag', () => {
    const { commands: testCommands, result } = renderInteractions();

    act(() => {
      result.current.handleSheetFrameDragStart(
        'sheet-inputs',
        pointerEvent({ clientX: 100, clientY: 120 }),
      );
      result.current.stopSheetFrameDrag(pointerEvent({ clientX: 100, clientY: 120 }));
    });

    expect(testCommands.moveSheetFrame).not.toHaveBeenCalled();
  });

  it('ignores non-primary drag starts', () => {
    const { commands: testCommands, result } = renderInteractions();

    act(() => {
      result.current.handleSheetFrameDragStart(
        'sheet-inputs',
        pointerEvent({ button: 2, clientX: 100, clientY: 120 }),
      );
      result.current.handleSheetFrameDragMove(pointerEvent({ clientX: 140, clientY: 150 }));
      result.current.stopSheetFrameDrag(pointerEvent({ clientX: 140, clientY: 150 }));
    });

    expect(result.current.frameLayoutPreview).toBeNull();
    expect(testCommands.moveSheetFrame).not.toHaveBeenCalled();
  });

  it('previews scaled resize movement and commits the final frame layout once', () => {
    const { commands: testCommands, result } = renderInteractions({ viewportScale: 2 });
    const direction: SheetFrameResizeDirection = { horizontal: 1, vertical: 1 };

    act(() => {
      result.current.handleSheetFrameResizeStart(
        'sheet-inputs',
        direction,
        pointerEvent({ clientX: 100, clientY: 120 }),
      );
      result.current.handleSheetFrameResizeMove(pointerEvent({ clientX: 160, clientY: 160 }));
    });

    expect(result.current.frameLayoutPreview).toEqual({
      sheetId: 'sheet-inputs',
      position: { x: 10, y: 20 },
      size: { width: 270, height: 180 },
    });
    expect(result.current.interactionPinnedSheetId).toBe('sheet-inputs');
    expect(testCommands.resizeSheetFrame).not.toHaveBeenCalled();

    act(() => {
      result.current.stopSheetFrameResize(pointerEvent({ clientX: 160, clientY: 160 }));
    });

    expect(result.current.frameLayoutPreview).toBeNull();
    expect(result.current.interactionPinnedSheetId).toBeNull();
    expect(testCommands.resizeSheetFrame).toHaveBeenCalledTimes(1);
    expect(testCommands.resizeSheetFrame).toHaveBeenCalledWith(
      'sheet-inputs',
      { x: 10, y: 20 },
      { width: 270, height: 180 },
    );
  });

  it('does not commit an unchanged resize', () => {
    const { commands: testCommands, result } = renderInteractions();
    const direction: SheetFrameResizeDirection = { horizontal: 1, vertical: 1 };

    act(() => {
      result.current.handleSheetFrameResizeStart(
        'sheet-inputs',
        direction,
        pointerEvent({ clientX: 100, clientY: 120 }),
      );
      result.current.stopSheetFrameResize(pointerEvent({ clientX: 100, clientY: 120 }));
    });

    expect(testCommands.resizeSheetFrame).not.toHaveBeenCalled();
  });

  it('discards drag and resize previews on pointer cancel without committing', () => {
    const { commands: testCommands, result } = renderInteractions();

    act(() => {
      result.current.handleSheetFrameDragStart('sheet-inputs', pointerEvent({ clientX: 100, clientY: 120 }));
      result.current.handleSheetFrameDragMove(pointerEvent({ clientX: 140, clientY: 150 }));
    });
    expect(result.current.frameLayoutPreview).not.toBeNull();
    expect(result.current.interactionPinnedSheetId).toBe('sheet-inputs');
    act(() => result.current.cancelSheetFrameDrag(pointerEvent({ clientX: 140, clientY: 150 })));
    expect(result.current.frameLayoutPreview).toBeNull();
    expect(result.current.interactionPinnedSheetId).toBeNull();
    expect(testCommands.moveSheetFrame).not.toHaveBeenCalled();

    act(() => {
      result.current.handleSheetFrameResizeStart(
        'sheet-inputs',
        { horizontal: 1, vertical: 1 },
        pointerEvent({ clientX: 100, clientY: 120 }),
      );
      result.current.handleSheetFrameResizeMove(pointerEvent({ clientX: 140, clientY: 150 }));
    });
    expect(result.current.frameLayoutPreview).not.toBeNull();
    expect(result.current.interactionPinnedSheetId).toBe('sheet-inputs');
    act(() => result.current.cancelSheetFrameResize(pointerEvent({ clientX: 140, clientY: 150 })));
    expect(result.current.frameLayoutPreview).toBeNull();
    expect(result.current.interactionPinnedSheetId).toBeNull();
    expect(testCommands.resizeSheetFrame).not.toHaveBeenCalled();
  });

  it('keeps active gesture ownership with its starting pointer', () => {
    const { commands: testCommands, result } = renderInteractions();
    act(() => {
      result.current.handleSheetFrameDragStart('sheet-inputs', pointerEvent({ clientX: 100, clientY: 120 }));
      result.current.handleSheetFrameDragMove(pointerEvent({ clientX: 140, clientY: 150, pointerId: 2 }));
      result.current.stopSheetFrameDrag(pointerEvent({ clientX: 140, clientY: 150, pointerId: 2 }));
    });
    expect(result.current.frameLayoutPreview).toBeNull();
    expect(testCommands.moveSheetFrame).not.toHaveBeenCalled();
  });

  it('previews combined-scale resizing and commits scale only when the scale handle stops', () => {
    const workbook = workbookWithSheets([{
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 10, y: 20 }),
      frame: { ...positionedSheet('sheet-inputs', 'Inputs', { x: 10, y: 20 }).frame, visualScale: 0.5 },
    }]);
    const { commands: testCommands, result } = renderInteractions({ viewportScale: 2, workbook });
    act(() => {
      result.current.handleSheetFrameResizeStart('sheet-inputs', { horizontal: 1, vertical: 0 }, pointerEvent({ clientX: 0, clientY: 0 }));
      result.current.handleSheetFrameResizeMove(pointerEvent({ clientX: 100, clientY: 0 }));
    });
    expect(result.current.frameLayoutPreview?.size.width).toBe(340);
    act(() => {
      result.current.handleSheetFrameScaleStart('sheet-inputs', pointerEvent({ clientX: 100, clientY: 0 }));
      result.current.handleSheetFrameScaleMove(pointerEvent({ clientX: 200, clientY: 0 }));
    });
    expect(result.current.frameScalePreview).toEqual({ sheetId: 'sheet-inputs', visualScale: 1 });
    expect(testCommands.setSheetVisualScale).not.toHaveBeenCalled();
    act(() => result.current.stopSheetFrameScale(pointerEvent({ clientX: 200, clientY: 0 })));
    expect(testCommands.setSheetVisualScale).toHaveBeenCalledWith('sheet-inputs', 1);
  });

  it('keeps the opposite scaled corner fixed while resizing from the top left', () => {
    const sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 10, y: 20 });
    const workbook = workbookWithSheets([{
      ...sheet,
      frame: { ...sheet.frame, visualScale: 0.5 },
    }]);
    const { commands: testCommands, result } = renderInteractions({ viewportScale: 2, workbook });

    act(() => {
      result.current.handleSheetFrameResizeStart(
        'sheet-inputs',
        { horizontal: -1, vertical: -1 },
        pointerEvent({ clientX: 0, clientY: 0 }),
      );
      result.current.handleSheetFrameResizeMove(pointerEvent({ clientX: 40, clientY: 30 }));
    });

    expect(result.current.frameLayoutPreview).toEqual({
      sheetId: 'sheet-inputs',
      position: { x: 30, y: 35 },
      size: { width: 200, height: 130 },
    });

    act(() => result.current.stopSheetFrameResize(pointerEvent({ clientX: 40, clientY: 30 })));
    expect(testCommands.resizeSheetFrame).toHaveBeenCalledWith(
      'sheet-inputs',
      { x: 30, y: 35 },
      { width: 200, height: 130 },
    );
  });

  it('pins numeric scale previews until cancellation or an explicit commit', () => {
    const { commands: testCommands, result } = renderInteractions();

    act(() => {
      result.current.startSheetFrameScaleInput('sheet-inputs');
      result.current.previewSheetFrameScale('sheet-inputs', 0.1);
    });

    expect(result.current.frameScalePreview).toEqual({ sheetId: 'sheet-inputs', visualScale: 0.1 });
    expect(result.current.interactionPinnedSheetId).toBe('sheet-inputs');
    const projectedFrame = {
      id: 'sheet-inputs', name: 'Inputs', position: { x: -500, y: 40 }, size: { width: 240, height: 160 }, visualScale: 0.1, zIndex: 1,
    };
    expect([...mountedWorkspaceFrameIds({
      frames: [projectedFrame], pins: {}, surfaceSize: { width: 800, height: 600 }, viewport: { scale: 1, x: 0, y: 0 },
    })]).toEqual([]);
    expect([...mountedWorkspaceFrameIds({
      frames: [projectedFrame], pins: { interactionSheetId: result.current.interactionPinnedSheetId }, surfaceSize: { width: 800, height: 600 }, viewport: { scale: 1, x: 0, y: 0 },
    })]).toEqual(['sheet-inputs']);

    act(() => result.current.cancelSheetFrameScale());
    expect(result.current.frameScalePreview).toBeNull();
    expect(result.current.interactionPinnedSheetId).toBeNull();
    expect(testCommands.setSheetVisualScale).not.toHaveBeenCalled();

    act(() => {
      result.current.startSheetFrameScaleInput('sheet-inputs');
      result.current.previewSheetFrameScale('sheet-inputs', 2);
      result.current.commitSheetFrameScale('sheet-inputs', 2);
    });
    expect(result.current.interactionPinnedSheetId).toBeNull();
    expect(testCommands.setSheetVisualScale).toHaveBeenCalledWith('sheet-inputs', 2);
  });

  it('preserves a pointer scale session when stale numeric cancellation follows handle takeover', () => {
    const { commands: testCommands, result } = renderInteractions();

    act(() => {
      result.current.startSheetFrameScaleInput('sheet-inputs');
      result.current.previewSheetFrameScale('sheet-inputs', 1.5);
      result.current.handleSheetFrameScaleStart('sheet-inputs', pointerEvent({ clientX: 100, clientY: 0, pointerId: 2 }));
      result.current.cancelSheetFrameScaleInput('sheet-inputs');
      result.current.handleSheetFrameScaleMove(pointerEvent({ clientX: 200, clientY: 0, pointerId: 2 }));
    });

    expect(result.current.frameScalePreview).toEqual({ sheetId: 'sheet-inputs', visualScale: 2 });
    expect(result.current.interactionPinnedSheetId).toBe('sheet-inputs');
    act(() => result.current.stopSheetFrameScale(pointerEvent({ clientX: 200, clientY: 0, pointerId: 2 })));
    expect(testCommands.setSheetVisualScale).toHaveBeenCalledTimes(1);
    expect(testCommands.setSheetVisualScale).toHaveBeenCalledWith('sheet-inputs', 2);
  });
});
