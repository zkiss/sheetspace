import { act, renderHook } from '@testing-library/react';
import type { PointerEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useSheetFrameInteractions } from './useSheetFrameInteractions';
import type { SheetFrameResizeDirection } from './workspaceContracts';

function pointer(x: number, y: number, modifier: 'ctrlKey' | 'metaKey' = 'ctrlKey') {
  const element = document.createElement('div');
  element.setPointerCapture = vi.fn();
  element.hasPointerCapture = vi.fn(() => true);
  element.releasePointerCapture = vi.fn();
  return { pointerId: 1, button: 0, clientX: x, clientY: y, [modifier]: true,
    currentTarget: element, preventDefault: vi.fn(), stopPropagation: vi.fn(),
  } as unknown as PointerEvent<HTMLElement>;
}

function setup(viewportScale = 2) {
  const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', position: { x: 50, y: 60 }, visualScale: 0.5 });
  const workbook = workbookWithSheets([sheet]);
  const commands = { moveSheetFrame: vi.fn(), resizeSheetFrame: vi.fn(), setSheetVisualScale: vi.fn() };
  return { sheet, commands, ...renderHook(({ scale }) => useSheetFrameInteractions({ workbook, commands, viewportScale: scale }), { initialProps: { scale: viewportScale } }) };
}

const directions: SheetFrameResizeDirection[] = [
  { horizontal: 0, vertical: -1 }, { horizontal: 1, vertical: 0 },
  { horizontal: 0, vertical: 1 }, { horizontal: -1, vertical: 0 },
  { horizontal: -1, vertical: -1 }, { horizontal: 1, vertical: -1 },
  { horizontal: 1, vertical: 1 }, { horizontal: -1, vertical: 1 },
];

describe('modifier resize scaling', () => {
  it.each(directions)('scales from edge/corner $horizontal,$vertical without drifting its opposite anchor', (direction) => {
    const { result, commands, sheet } = setup();
    const end = pointer(direction.horizontal * sheet.frame.size.width, direction.vertical * sheet.frame.size.height, 'metaKey');
    act(() => {
      result.current.handleSheetFrameResizeStart('inputs', direction, pointer(0, 0, 'metaKey'));
      result.current.handleSheetFrameResizeMove(end);
    });
    const expectedPosition = {
      x: direction.horizontal === -1 ? 50 - sheet.frame.size.width / 2 : 50,
      y: direction.vertical === -1 ? 60 - sheet.frame.size.height / 2 : 60,
    };
    expect(result.current.frameScalePreview).toEqual({ sheetId: 'inputs', visualScale: 1, position: expectedPosition });
    expect(result.current.frameLayoutPreview?.size).toEqual(sheet.frame.size);
    expect(commands.resizeSheetFrame).not.toHaveBeenCalled();
    act(() => result.current.stopSheetFrameResize(end));
    expect(commands.setSheetVisualScale).toHaveBeenCalledOnce();
    expect(commands.setSheetVisualScale).toHaveBeenCalledWith('inputs', 1);
    if (direction.horizontal === -1 || direction.vertical === -1) expect(commands.moveSheetFrame).toHaveBeenCalledWith('inputs', expectedPosition);
    else expect(commands.moveSheetFrame).not.toHaveBeenCalled();
    expect(result.current.interactionPinnedSheetId).toBeNull();
  });

  it('clamps scale without moving the opposite anchor past its clamped size', () => {
    const { result, sheet } = setup();
    const direction = { horizontal: -1, vertical: -1 } as const;
    act(() => {
      result.current.handleSheetFrameResizeStart('inputs', direction, pointer(0, 0));
      result.current.handleSheetFrameResizeMove(pointer(-100_000, -100_000));
    });
    expect(result.current.frameScalePreview?.visualScale).toBe(8);
    const position = result.current.frameScalePreview!.position;
    expect(position.x + sheet.frame.size.width * 8).toBe(50 + sheet.frame.size.width * 0.5);
    expect(position.y + sheet.frame.size.height * 8).toBe(60 + sheet.frame.size.height * 0.5);
  });

  it('uses the gesture starting zoom for subsequent displacements and releases capture on Escape', () => {
    const { result, rerender, commands } = setup();
    const start = pointer(0, 0);
    act(() => result.current.handleSheetFrameResizeStart('inputs', { horizontal: 1, vertical: 0 }, start));
    rerender({ scale: 4 });
    act(() => result.current.handleSheetFrameResizeMove(pointer(240, 0)));
    expect(result.current.frameScalePreview?.visualScale).toBe(1);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(start.currentTarget.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(result.current.interactionPinnedSheetId).toBeNull();
    expect(commands.setSheetVisualScale).not.toHaveBeenCalled();
  });

  it('routes modifier-resize cancellation and ignores stale releases after losing capture', () => {
    const { result, commands } = setup();
    const start = pointer(0, 0);
    act(() => {
      result.current.handleSheetFrameResizeStart('inputs', { horizontal: -1, vertical: 0 }, start);
      result.current.handleSheetFrameResizeMove(pointer(-100, 0));
      result.current.cancelSheetFrameResize(start);
      result.current.stopSheetFrameResize(pointer(-100, 0));
    });
    expect(result.current.frameScalePreview).toBeNull();
    expect(start.currentTarget.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(commands.setSheetVisualScale).not.toHaveBeenCalled();
    expect(commands.moveSheetFrame).not.toHaveBeenCalled();
  });
});
