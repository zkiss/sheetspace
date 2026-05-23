import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PointerEvent } from 'react';
import type { SheetFrameResizeDirection } from './appTypes';
import { createSheet, type Workbook, type WorkspacePosition } from './workbook';
import type { WorkbookCommands } from './useWorkbookController';
import { useSheetFrameInteractions } from './useSheetFrameInteractions';

function workbookWithSheets(sheets: Workbook['sheets']): Workbook {
  return {
    version: 1,
    sheets,
  };
}

function positionedSheet(id: string, name: string, position: WorkspacePosition) {
  const result = createSheet({ id, name, position });
  if (!result.ok) {
    throw new Error(`Failed to create test sheet ${name}`);
  }

  return result.value;
}

function commands() {
  return {
    moveSheetFrame: vi.fn(),
    previewSheetFrameLayout: vi.fn(),
    resizeSheetFrame: vi.fn(),
  } satisfies Pick<WorkbookCommands, 'moveSheetFrame' | 'previewSheetFrameLayout' | 'resizeSheetFrame'>;
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
      result.current.stopSheetFrameDrag(pointerEvent({ clientX: 140, clientY: 150 }));
    });

    expect(testCommands.previewSheetFrameLayout).toHaveBeenCalledWith('sheet-inputs', { x: 30, y: 35 });
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

      result.current.stopSheetFrameDrag(pointerEvent({ clientX: 110, clientY: 120 }));
    });

    expect(testCommands.previewSheetFrameLayout).toHaveBeenLastCalledWith('sheet-inputs', { x: 15, y: 20 });
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

  it('ignores drag starts from form controls inside the header', () => {
    const target = document.createElement('button');
    const { commands: testCommands, result } = renderInteractions();

    act(() => {
      result.current.handleSheetFrameDragStart(
        'sheet-inputs',
        pointerEvent({ clientX: 100, clientY: 120, target }),
      );
      result.current.handleSheetFrameDragMove(pointerEvent({ clientX: 140, clientY: 150 }));
      result.current.stopSheetFrameDrag(pointerEvent({ clientX: 140, clientY: 150 }));
    });

    expect(testCommands.previewSheetFrameLayout).not.toHaveBeenCalled();
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
      result.current.stopSheetFrameResize(pointerEvent({ clientX: 160, clientY: 160 }));
    });

    expect(testCommands.previewSheetFrameLayout).toHaveBeenCalledWith(
      'sheet-inputs',
      { x: 10, y: 20 },
      { width: 270, height: 180 },
    );
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
});
