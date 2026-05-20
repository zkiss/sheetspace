import { PointerEvent, useRef } from 'react';
import type { SheetFrameDrag, SheetFrameResize, SheetFrameResizeDirection } from './appTypes';
import type { Workbook } from './workbook';
import type { WorkbookCommands } from './useWorkbookController';
import { resizeSheetFrame } from './workspaceGeometry';

export function useSheetFrameInteractions({
  commands,
  viewportScale,
  workbook,
}: {
  commands: Pick<WorkbookCommands, 'moveSheetFrame' | 'previewSheetFrameLayout' | 'resizeSheetFrame'>;
  viewportScale: number;
  workbook: Workbook;
}) {
  const sheetFrameDrag = useRef<SheetFrameDrag | null>(null);
  const sheetFrameResize = useRef<SheetFrameResize | null>(null);

  function handleSheetFrameDragStart(sheetId: string, event: PointerEvent<HTMLElement>) {
    if (
      (event.button !== 0 && event.button !== undefined) ||
      (event.target as HTMLElement).closest('button, input, textarea, select')
    ) {
      return;
    }

    const sheet = workbook.sheets.find((candidate) => candidate.id === sheetId);
    if (!sheet) {
      return;
    }

    sheetFrameDrag.current = {
      pointerId: event.pointerId,
      sheetId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition: sheet.position,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handleSheetFrameDragMove(event: PointerEvent<HTMLElement>) {
    if (!sheetFrameDrag.current || sheetFrameDrag.current.pointerId !== event.pointerId) {
      return;
    }

    const nextPosition = {
      x: Math.round(
        sheetFrameDrag.current.startPosition.x +
          (event.clientX - sheetFrameDrag.current.startClientX) / viewportScale,
      ),
      y: Math.round(
        sheetFrameDrag.current.startPosition.y +
          (event.clientY - sheetFrameDrag.current.startClientY) / viewportScale,
      ),
    };
    commands.previewSheetFrameLayout(sheetFrameDrag.current.sheetId, nextPosition);
  }

  function stopSheetFrameDrag(event: PointerEvent<HTMLElement>) {
    if (!sheetFrameDrag.current || sheetFrameDrag.current.pointerId !== event.pointerId) {
      return;
    }

    const finishedDrag = sheetFrameDrag.current;
    const position = {
      x: Math.round(finishedDrag.startPosition.x + (event.clientX - finishedDrag.startClientX) / viewportScale),
      y: Math.round(finishedDrag.startPosition.y + (event.clientY - finishedDrag.startClientY) / viewportScale),
    };
    if (position.x !== finishedDrag.startPosition.x || position.y !== finishedDrag.startPosition.y) {
      commands.moveSheetFrame(finishedDrag.sheetId, position);
    }

    sheetFrameDrag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function handleSheetFrameResizeStart(
    sheetId: string,
    direction: SheetFrameResizeDirection,
    event: PointerEvent<HTMLElement>,
  ) {
    if (event.button !== 0 && event.button !== undefined) {
      return;
    }

    const sheet = workbook.sheets.find((candidate) => candidate.id === sheetId);
    if (!sheet) {
      return;
    }

    sheetFrameResize.current = {
      pointerId: event.pointerId,
      sheetId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition: sheet.position,
      startFrameSize: sheet.frameSize,
      direction,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function handleSheetFrameResizeMove(event: PointerEvent<HTMLElement>) {
    if (!sheetFrameResize.current || sheetFrameResize.current.pointerId !== event.pointerId) {
      return;
    }

    const resize = sheetFrameResize.current;
    const nextLayout = resizeSheetFrame(resize, {
      x: (event.clientX - resize.startClientX) / viewportScale,
      y: (event.clientY - resize.startClientY) / viewportScale,
    });
    commands.previewSheetFrameLayout(resize.sheetId, nextLayout.position, nextLayout.frameSize);
  }

  function stopSheetFrameResize(event: PointerEvent<HTMLElement>) {
    if (!sheetFrameResize.current || sheetFrameResize.current.pointerId !== event.pointerId) {
      return;
    }

    const resize = sheetFrameResize.current;
    const nextLayout = resizeSheetFrame(resize, {
      x: (event.clientX - resize.startClientX) / viewportScale,
      y: (event.clientY - resize.startClientY) / viewportScale,
    });

    if (
      nextLayout.position.x !== resize.startPosition.x ||
      nextLayout.position.y !== resize.startPosition.y ||
      nextLayout.frameSize.width !== resize.startFrameSize.width ||
      nextLayout.frameSize.height !== resize.startFrameSize.height
    ) {
      commands.resizeSheetFrame(resize.sheetId, nextLayout.position, nextLayout.frameSize);
    }

    sheetFrameResize.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  return {
    handleSheetFrameDragMove,
    handleSheetFrameDragStart,
    handleSheetFrameResizeMove,
    handleSheetFrameResizeStart,
    stopSheetFrameDrag,
    stopSheetFrameResize,
  };
}
