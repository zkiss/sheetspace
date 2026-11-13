import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PointerEvent } from 'react';
import type { SheetFrameLayoutCommands, SheetFrameResizeDirection } from './workspaceContracts';
import { Workbook } from '@workbook/core/model';
import { useSheetFrameInteractions } from '@workspace/useSheetFrameInteractions';
import { mountedWorkspaceFrameIds } from '@workspace/workspaceFrameVirtualization';
import { positionedSheet, workbookWithSheets } from '@test-support/workbookFactories';

let frame: HTMLElement;
beforeEach(() => {
  frame = document.createElement('article');
  frame.className = 'sheet-frame';
  Object.assign(frame.style, { left: '10px', top: '20px', width: '240px', height: '160px' });
});

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
  frame.append(currentTarget);
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
  it('ignores missing sheets, undefined-button non-primary starts, and stale handlers', () => {
    const { commands: testCommands, result } = renderInteractions({ workbook: workbookWithSheets([]) });
    const undefinedButton = pointerEvent({ clientX: 1, clientY: 2 }) as unknown as { button?: number };
    delete undefinedButton.button;

    act(() => {
      result.current.handleSheetFrameDragStart('missing', undefinedButton as PointerEvent<HTMLElement>);
      result.current.handleSheetFrameResizeStart('missing', { horizontal: 1, vertical: 1 }, undefinedButton as PointerEvent<HTMLElement>);
      result.current.handleSheetFrameScaleStart('missing', undefinedButton as PointerEvent<HTMLElement>);
      result.current.handleSheetFrameDragMove(pointerEvent({ clientX: 2, clientY: 3 }));
      result.current.stopSheetFrameDrag(pointerEvent({ clientX: 2, clientY: 3 }));
      result.current.cancelSheetFrameDrag(pointerEvent({ clientX: 2, clientY: 3 }));
      result.current.handleSheetFrameResizeMove(pointerEvent({ clientX: 2, clientY: 3 }));
      result.current.stopSheetFrameResize(pointerEvent({ clientX: 2, clientY: 3 }));
      result.current.cancelSheetFrameResize(pointerEvent({ clientX: 2, clientY: 3 }));
      result.current.handleSheetFrameScaleMove(pointerEvent({ clientX: 2, clientY: 3 }));
      result.current.stopSheetFrameScale(pointerEvent({ clientX: 2, clientY: 3 }));
      result.current.cancelSheetFrameScalePointer(pointerEvent({ clientX: 2, clientY: 3 }));
    });

    expect(result.current.interactionPinnedSheetId).toBeNull();
    expect(testCommands.moveSheetFrame).not.toHaveBeenCalled();
    expect(testCommands.resizeSheetFrame).not.toHaveBeenCalled();
    expect(testCommands.setSheetVisualScale).not.toHaveBeenCalled();
  });

  it('abandons previews and commits when an active sheet disappears', () => {
    const sheetWorkbook = workbookWithSheets([positionedSheet('sheet-inputs', 'Inputs', { x: 10, y: 20 })]);
    const emptyWorkbook = workbookWithSheets([]);
    const testCommands = commands();
    const { result, rerender } = renderHook(
      ({ workbook }: { workbook: Workbook }) => useSheetFrameInteractions({ commands: testCommands, viewportScale: 1, workbook }),
      { initialProps: { workbook: sheetWorkbook } },
    );

    act(() => result.current.handleSheetFrameDragStart('sheet-inputs', pointerEvent({ clientX: 0, clientY: 0 })));
    rerender({ workbook: emptyWorkbook });
    act(() => result.current.handleSheetFrameDragMove(pointerEvent({ clientX: 10, clientY: 10 })));
    expect(result.current.frameLayoutPreview).toBeNull();

    rerender({ workbook: sheetWorkbook });
    act(() => result.current.handleSheetFrameResizeStart(
      'sheet-inputs', { horizontal: 1, vertical: 1 }, pointerEvent({ clientX: 0, clientY: 0 }),
    ));
    rerender({ workbook: emptyWorkbook });
    act(() => {
      result.current.handleSheetFrameResizeMove(pointerEvent({ clientX: 10, clientY: 10 }));
      result.current.stopSheetFrameResize(pointerEvent({ clientX: 10, clientY: 10 }));
    });
    expect(testCommands.resizeSheetFrame).not.toHaveBeenCalled();

    rerender({ workbook: sheetWorkbook });
    act(() => result.current.handleSheetFrameScaleStart('sheet-inputs', pointerEvent({ clientX: 0, clientY: 0 })));
    rerender({ workbook: emptyWorkbook });
    act(() => result.current.stopSheetFrameScale(pointerEvent({ clientX: 240, clientY: 0 })));
    expect(result.current.interactionPinnedSheetId).toBeNull();
    expect(testCommands.setSheetVisualScale).not.toHaveBeenCalled();
  });

  it('keeps scale ownership against stale events and releases captured cancellation', () => {
    const { commands: testCommands, result } = renderInteractions();
    const start = pointerEvent({ clientX: 100, clientY: 0, pointerId: 1 });
    start.currentTarget.hasPointerCapture = vi.fn().mockReturnValue(true);
    act(() => result.current.handleSheetFrameScaleStart('sheet-inputs', start));

    const stale = pointerEvent({ clientX: 200, clientY: 0, pointerId: 2 });
    act(() => {
      result.current.handleSheetFrameScaleMove(stale);
      result.current.stopSheetFrameScale(stale);
      result.current.cancelSheetFrameScalePointer(stale);
    });
    expect(result.current.frameScalePreview).toEqual({ sheetId: 'sheet-inputs', visualScale: 1, position: { x: 10, y: 20 } });

    const cancel = pointerEvent({ clientX: 100, clientY: 0, pointerId: 1 });
    cancel.currentTarget.hasPointerCapture = vi.fn().mockReturnValue(true);
    act(() => result.current.cancelSheetFrameScalePointer(cancel));
    expect(start.currentTarget.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(result.current.frameScalePreview).toBeNull();
    expect(testCommands.setSheetVisualScale).not.toHaveBeenCalled();
  });

  it('does not save an unchanged pointer scale and cancels on Escape', () => {
    const { commands: testCommands, result } = renderInteractions();

    act(() => {
      result.current.handleSheetFrameScaleStart('sheet-inputs', pointerEvent({ clientX: 100, clientY: 0 }));
      result.current.stopSheetFrameScale(pointerEvent({ clientX: 100, clientY: 0 }));
      result.current.handleSheetFrameScaleStart('sheet-inputs', pointerEvent({ clientX: 100, clientY: 0 }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(result.current.interactionPinnedSheetId).toBeNull();
    expect(testCommands.setSheetVisualScale).not.toHaveBeenCalled();
  });

  it('rejects non-primary resize and scale pointers', () => {
    const { commands: testCommands, result } = renderInteractions();
    act(() => {
      result.current.handleSheetFrameResizeStart(
        'sheet-inputs', { horizontal: 1, vertical: 1 }, pointerEvent({ button: 2, clientX: 0, clientY: 0 }),
      );
      result.current.handleSheetFrameScaleStart(
        'sheet-inputs', pointerEvent({ button: 2, clientX: 0, clientY: 0 }),
      );
    });

    expect(result.current.interactionPinnedSheetId).toBeNull();
    expect(testCommands.resizeSheetFrame).not.toHaveBeenCalled();
  });

  it('previews scaled drag movement and commits the final frame position once', () => {
    const { commands: testCommands, result } = renderInteractions({ viewportScale: 2 });

    act(() => {
      result.current.handleSheetFrameDragStart(
        'sheet-inputs',
        pointerEvent({ clientX: 100, clientY: 120 }),
      );
      result.current.handleSheetFrameDragMove(pointerEvent({ clientX: 140, clientY: 150 }));
    });

    expect(frame).toHaveStyle({ left: '30px', top: '35px' });
    expect(frame.dataset).toMatchObject({ positionX: '30', positionY: '35' });
    expect(result.current.frameLayoutPreview).toBeNull();
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

    expect(frame).toHaveStyle({ left: '15px', top: '20px' });
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

    expect(frame).toHaveStyle({ left: '10px', top: '20px', width: '270px', height: '180px' });
    expect(frame.dataset).toMatchObject({ frameWidth: '270', frameHeight: '180' });
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
    expect(frame.style.left === '50px' || frame.style.width === '280px').toBe(true);
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
    expect(frame).toHaveStyle({ width: '280px', height: '190px' });
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
    expect(frame).toHaveStyle({ width: '340px' });
    act(() => result.current.cancelSheetFrameResize(pointerEvent({ clientX: 100, clientY: 0 })));
    act(() => {
      result.current.handleSheetFrameScaleStart('sheet-inputs', pointerEvent({ clientX: 100, clientY: 0 }));
      result.current.handleSheetFrameScaleMove(pointerEvent({ clientX: 340, clientY: 0 }));
    });
    expect(result.current.frameScalePreview).toEqual({ sheetId: 'sheet-inputs', visualScale: 1, position: { x: 10, y: 20 } });
    expect(testCommands.setSheetVisualScale).not.toHaveBeenCalled();
    act(() => result.current.stopSheetFrameScale(pointerEvent({ clientX: 340, clientY: 0 })));
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

    expect(frame).toHaveStyle({ left: '30px', top: '35px', width: '200px', height: '130px' });

    act(() => result.current.stopSheetFrameResize(pointerEvent({ clientX: 40, clientY: 30 })));
    expect(testCommands.resizeSheetFrame).toHaveBeenCalledWith(
      'sheet-inputs',
      { x: 30, y: 35 },
      { width: 200, height: 130 },
    );
  });

  it('pins pointer scale previews until cancellation or an explicit commit', () => {
    const { commands: testCommands, result } = renderInteractions();

    act(() => {
      result.current.handleSheetFrameScaleStart('sheet-inputs', pointerEvent({ clientX: 0, clientY: 0 }));
      result.current.handleSheetFrameScaleMove(pointerEvent({ clientX: -216, clientY: 0 }));
    });

    expect(result.current.frameScalePreview?.visualScale).toBeCloseTo(0.1);
    expect(result.current.frameScalePreview?.position).toEqual({ x: 10, y: 20 });
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
      result.current.handleSheetFrameScaleStart('sheet-inputs', pointerEvent({ clientX: 0, clientY: 0 }));
      result.current.stopSheetFrameScale(pointerEvent({ clientX: 240, clientY: 0 }));
    });
    expect(result.current.interactionPinnedSheetId).toBeNull();
    expect(testCommands.setSheetVisualScale).toHaveBeenCalledWith('sheet-inputs', 2);
  });

  it('rejects competing pointers and stale cancellation during a pointer scale session', () => {
    const { commands: testCommands, result } = renderInteractions();

    act(() => {
      result.current.handleSheetFrameScaleStart('sheet-inputs', pointerEvent({ clientX: 100, clientY: 0, pointerId: 2 }));
      result.current.handleSheetFrameScaleStart('sheet-inputs', pointerEvent({ clientX: 300, clientY: 0, pointerId: 3 }));
      result.current.cancelSheetFrameScalePointer(pointerEvent({ clientX: 300, clientY: 0, pointerId: 3 }));
      result.current.handleSheetFrameScaleMove(pointerEvent({ clientX: 340, clientY: 0, pointerId: 2 }));
    });

    expect(result.current.frameScalePreview).toEqual({ sheetId: 'sheet-inputs', visualScale: 2, position: { x: 10, y: 20 } });
    expect(result.current.interactionPinnedSheetId).toBe('sheet-inputs');
    act(() => result.current.stopSheetFrameScale(pointerEvent({ clientX: 340, clientY: 0, pointerId: 2 })));
    expect(testCommands.setSheetVisualScale).toHaveBeenCalledTimes(1);
    expect(testCommands.setSheetVisualScale).toHaveBeenCalledWith('sheet-inputs', 2);
  });

  it('keeps drag and resize ownership against competing pointers', () => {
    const { commands: testCommands, result } = renderInteractions();

    act(() => {
      result.current.handleSheetFrameDragStart('sheet-inputs', pointerEvent({ clientX: 100, clientY: 120, pointerId: 2 }));
      result.current.handleSheetFrameDragStart('sheet-inputs', pointerEvent({ clientX: 300, clientY: 300, pointerId: 3 }));
      result.current.handleSheetFrameDragMove(pointerEvent({ clientX: 140, clientY: 150, pointerId: 2 }));
    });

    expect(result.current.frameScalePreview).toBeNull();
    expect(frame).toHaveStyle({ left: '50px', top: '50px' });
    expect(result.current.interactionPinnedSheetId).toBe('sheet-inputs');
    act(() => result.current.stopSheetFrameDrag(pointerEvent({ clientX: 140, clientY: 150, pointerId: 2 })));
    expect(testCommands.moveSheetFrame).toHaveBeenCalledWith('sheet-inputs', { x: 50, y: 50 });
    expect(result.current.interactionPinnedSheetId).toBeNull();

    act(() => {
      result.current.handleSheetFrameResizeStart(
        'sheet-inputs', { horizontal: 1, vertical: 1 }, pointerEvent({ clientX: 100, clientY: 120, pointerId: 3 }),
      );
      result.current.handleSheetFrameResizeStart(
        'sheet-inputs', { horizontal: -1, vertical: -1 }, pointerEvent({ clientX: 300, clientY: 300, pointerId: 4 }),
      );
      result.current.handleSheetFrameResizeMove(pointerEvent({ clientX: 140, clientY: 150, pointerId: 3 }));
    });

    expect(result.current.interactionPinnedSheetId).toBe('sheet-inputs');
    act(() => result.current.stopSheetFrameResize(pointerEvent({ clientX: 140, clientY: 150, pointerId: 3 })));
    expect(frame.style.width).toBe('280px');
    expect(frame.style.height).toBe('190px');
    expect(testCommands.resizeSheetFrame).toHaveBeenCalledWith(
      'sheet-inputs', { x: 10, y: 20 }, { width: 280, height: 190 },
    );
    expect(result.current.interactionPinnedSheetId).toBeNull();
  });
});

it('cancels a captured frame scale with the rebound chord before editor bubbling', async () => {
  const { keymap } = await import('@shared/keyboard/keymap');
  const map = keymap as unknown as Record<string, import('@shared/keyboard/keymap').Binding>;
  const original = map.cancel; map.cancel = [{ key: 'q', alt: true }];
  try {
    const { commands: testCommands, result } = renderInteractions();
    const start = pointerEvent({ clientX: 100, clientY: 0 });
    start.currentTarget.hasPointerCapture = vi.fn().mockReturnValue(true);
    act(() => result.current.handleSheetFrameScaleStart('sheet-inputs', start));
    const input = document.createElement('input'); document.body.append(input);
    input.addEventListener('keydown', (e) => e.stopPropagation());
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true })); });
    expect(result.current.interactionPinnedSheetId).toBe('sheet-inputs');
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', altKey: true, bubbles: true })); result.current.stopSheetFrameScale(pointerEvent({ clientX: 200, clientY: 0 })); });
    expect(result.current.interactionPinnedSheetId).toBeNull();
    expect(start.currentTarget.releasePointerCapture).toHaveBeenCalledOnce();
    expect(testCommands.setSheetVisualScale).not.toHaveBeenCalled();
    input.remove();
  } finally { map.cancel = original; }
});

it.each(['cancel', 'escape', 'blur', 'rejection', 'return to origin'])(
  'settles a direct drag preview after %s', (ending) => {
    const { commands: testCommands, result } = renderInteractions();
    if (ending === 'rejection') testCommands.moveSheetFrame.mockReturnValue({ ok: false, reason: 'not-found' } as never);
    act(() => {
      result.current.handleSheetFrameDragStart('sheet-inputs', pointerEvent({ clientX: 0, clientY: 0 }));
      result.current.handleSheetFrameDragMove(pointerEvent({ clientX: 40, clientY: 30 }));
    });
    expect(frame.dataset).toMatchObject({ positionX: '50', positionY: '50' });
    act(() => {
      if (ending === 'cancel') result.current.cancelSheetFrameDrag(pointerEvent({ clientX: 40, clientY: 30 }));
      if (ending === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      if (ending === 'blur') window.dispatchEvent(new Event('blur'));
      if (ending === 'rejection') result.current.stopSheetFrameDrag(pointerEvent({ clientX: 40, clientY: 30 }));
      if (ending === 'return to origin') result.current.stopSheetFrameDrag(pointerEvent({ clientX: 0, clientY: 0 }));
    });
    expect(frame.dataset).toMatchObject({ positionX: '10', positionY: '20' });
    expect(result.current.interactionPinnedSheetId).toBeNull();
  },
);

it('restores moved position and size when a top-left resize is rejected', () => {
  const { commands: testCommands, result } = renderInteractions();
  testCommands.resizeSheetFrame.mockReturnValue({ ok: false, reason: 'not-found' } as never);
  act(() => {
    result.current.handleSheetFrameResizeStart('sheet-inputs', { horizontal: -1, vertical: -1 }, pointerEvent({ clientX: 0, clientY: 0 }));
    result.current.handleSheetFrameResizeMove(pointerEvent({ clientX: 20, clientY: 30 }));
  });
  expect(frame.dataset).toMatchObject({ positionX: '30', positionY: '50', frameWidth: '220', frameHeight: '130' });
  act(() => result.current.stopSheetFrameResize(pointerEvent({ clientX: 20, clientY: 30 })));
  expect(frame.dataset).toMatchObject({ positionX: '10', positionY: '20', frameWidth: '240', frameHeight: '160' });
});

