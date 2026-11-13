import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { PointerEvent } from 'react';
import { useReferenceViewports } from '@app/useReferenceViewports';
import { useSheetFrameInteractions } from '@workspace/useSheetFrameInteractions';
import { positionedSheet, workbookWithSheets } from '@test-support/workbookFactories';

let frame: HTMLElement;
beforeEach(() => {
  frame = document.createElement('article');
  frame.className = 'sheet-frame';
  Object.assign(frame.style, { left: '10px', top: '20px', width: '240px', height: '160px' });
});
function commands() {
  return { moveSheetFrame: vi.fn(), resizeSheetFrame: vi.fn(), setSheetVisualScale: vi.fn() };
}
function pointerEvent({ clientX, clientY }: { clientX: number; clientY: number }) {
  const currentTarget = document.createElement('div');
  frame.append(currentTarget);
  return { button: 0, clientX, clientY, currentTarget, pointerId: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as PointerEvent<HTMLElement>;
}

it.each(['cancel', 'escape', 'blur', 'removal'])('restores direct resize geometry on %s', (ending) => {
  const workbook = workbookWithSheets([positionedSheet('sheet-inputs', 'Inputs', { x: 10, y: 20 })]);
  const testCommands = commands();
  const { result, rerender } = renderHook(({ book }) => useSheetFrameInteractions({ commands: testCommands, viewportScale: 1, workbook: book }), { initialProps: { book: workbook } });
  act(() => {
    result.current.handleSheetFrameResizeStart('sheet-inputs', { horizontal: -1, vertical: -1 }, pointerEvent({ clientX: 0, clientY: 0 }));
    result.current.handleSheetFrameResizeMove(pointerEvent({ clientX: 20, clientY: 30 }));
  });
  expect(frame.dataset).toMatchObject({ positionX: '30', positionY: '50', frameWidth: '220', frameHeight: '130' });
  if (ending === 'removal') rerender({ book: workbookWithSheets([]) });
  else act(() => {
    if (ending === 'cancel') result.current.cancelSheetFrameResize(pointerEvent({ clientX: 20, clientY: 30 }));
    if (ending === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    if (ending === 'blur') window.dispatchEvent(new Event('blur'));
  });
  expect(frame.dataset).toMatchObject({ positionX: '10', positionY: '20', frameWidth: '240', frameHeight: '160' });
  expect([frame.style.left, frame.style.top, frame.style.width, frame.style.height]).toEqual(['10px', '20px', '240px', '160px']);
  expect(testCommands.resizeSheetFrame).not.toHaveBeenCalled();
});

it.each(['cancel', 'changed pointerup'])('measures settled resize on %s before deferred observer delivery', (ending) => {
  const workbook = workbookWithSheets([positionedSheet('sheet-inputs', 'Inputs', { x: 10, y: 20 })]);
  const testCommands = commands();
  const { result } = renderHook(() => {
    const interaction = useSheetFrameInteractions({ commands: testCommands, viewportScale: 1, workbook });
    const viewports = useReferenceViewports(interaction.interactionPinnedSheetId !== null);
    return { interaction, viewports };
  });
  const measure = () => ({ scrollLeft: 0, scrollTop: 0, width: parseInt(frame.style.width), height: parseInt(frame.style.height) });
  const report = () => result.current.viewports.reportReferenceViewport('sheet-inputs', measure(), measure);
  act(report);
  act(() => result.current.interaction.handleSheetFrameResizeStart('sheet-inputs', { horizontal: 1, vertical: 1 }, pointerEvent({ clientX: 0, clientY: 0 })));
  act(() => result.current.interaction.handleSheetFrameResizeMove(pointerEvent({ clientX: 40, clientY: 30 })));
  act(report);
  act(() => {
    if (ending === 'cancel') result.current.interaction.cancelSheetFrameResize(pointerEvent({ clientX: 40, clientY: 30 }));
    else result.current.interaction.stopSheetFrameResize(pointerEvent({ clientX: 60, clientY: 50 }));
  });
  const settled = result.current.viewports.referenceGridViewports;
  expect(settled['sheet-inputs']?.size).toEqual(ending === 'cancel' ? { width: 240, height: 160 } : { width: 300, height: 210 });
  act(report);
  expect(result.current.viewports.referenceGridViewports).toBe(settled);
});
