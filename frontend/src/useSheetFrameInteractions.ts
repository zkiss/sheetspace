import { PointerEvent, useRef, useState } from 'react';
import type { SheetFrameDrag, SheetFrameResize, SheetFrameResizeDirection } from './appTypes';
import { findSheetById, type SheetFrameSize, type Workbook, type WorkspacePosition } from './workbook';
import type { WorkbookCommands } from './useWorkbookController';
import { resizeSheetFrame, workspaceDeltaFromClient } from './workspaceGeometry';

export type SheetFrameLayoutPreview = {
  sheetId: string;
  position: WorkspacePosition;
  size: SheetFrameSize;
};

export function useSheetFrameInteractions({
  commands,
  viewportScale,
  workbook,
}: {
  commands: Pick<WorkbookCommands, 'moveSheetFrame' | 'resizeSheetFrame'>;
  viewportScale: number;
  workbook: Workbook;
}) {
  const sheetFrameDrag = useRef<SheetFrameDrag | null>(null);
  const sheetFrameResize = useRef<SheetFrameResize | null>(null);
  const [frameLayoutPreview, setFrameLayoutPreview] = useState<SheetFrameLayoutPreview | null>(null);
  const [interactionPinnedSheetId, setInteractionPinnedSheetId] = useState<string | null>(null);

  function handleSheetFrameDragStart(sheetId: string, event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 && event.button !== undefined) {
      return;
    }

    const sheet = findSheetById(workbook, sheetId);
    if (!sheet) {
      return;
    }

    sheetFrameDrag.current = {
      pointerId: event.pointerId,
      sheetId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition: sheet.frame.position,
    };
    setInteractionPinnedSheetId(sheetId);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handleSheetFrameDragMove(event: PointerEvent<HTMLElement>) {
    if (!sheetFrameDrag.current || sheetFrameDrag.current.pointerId !== event.pointerId) {
      return;
    }

    const drag = sheetFrameDrag.current;
    const delta = workspaceDeltaFromClient(
      { x: drag.startClientX, y: drag.startClientY },
      { x: event.clientX, y: event.clientY },
      viewportScale,
    );
    const sheet = findSheetById(workbook, drag.sheetId);
    if (!sheet) return;
    setFrameLayoutPreview({
      sheetId: drag.sheetId,
      position: {
        x: Math.round(drag.startPosition.x + delta.x),
        y: Math.round(drag.startPosition.y + delta.y),
      },
      size: sheet.frame.size,
    });
  }

  function stopSheetFrameDrag(event: PointerEvent<HTMLElement>) {
    if (!sheetFrameDrag.current || sheetFrameDrag.current.pointerId !== event.pointerId) {
      return;
    }

    const finishedDrag = sheetFrameDrag.current;
    const delta = workspaceDeltaFromClient(
      { x: finishedDrag.startClientX, y: finishedDrag.startClientY },
      { x: event.clientX, y: event.clientY },
      viewportScale,
    );
    const position = {
      x: Math.round(finishedDrag.startPosition.x + delta.x),
      y: Math.round(finishedDrag.startPosition.y + delta.y),
    };
    if (position.x !== finishedDrag.startPosition.x || position.y !== finishedDrag.startPosition.y) {
      commands.moveSheetFrame(finishedDrag.sheetId, position);
    }

    sheetFrameDrag.current = null;
    setFrameLayoutPreview(null);
    setInteractionPinnedSheetId(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function cancelSheetFrameDrag(event: PointerEvent<HTMLElement>) {
    if (!sheetFrameDrag.current || sheetFrameDrag.current.pointerId !== event.pointerId) return;
    sheetFrameDrag.current = null;
    setFrameLayoutPreview(null);
    setInteractionPinnedSheetId(null);
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

    const sheet = findSheetById(workbook, sheetId);
    if (!sheet) {
      return;
    }

    sheetFrameResize.current = {
      pointerId: event.pointerId,
      sheetId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition: sheet.frame.position,
      startFrameSize: sheet.frame.size,
      direction,
    };
    setInteractionPinnedSheetId(sheetId);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function handleSheetFrameResizeMove(event: PointerEvent<HTMLElement>) {
    if (!sheetFrameResize.current || sheetFrameResize.current.pointerId !== event.pointerId) {
      return;
    }

    const resize = sheetFrameResize.current;
    const nextLayout = resizeSheetFrame(resize, workspaceDeltaFromClient(
      { x: resize.startClientX, y: resize.startClientY },
      { x: event.clientX, y: event.clientY },
      viewportScale,
    ));
    setFrameLayoutPreview({
      sheetId: resize.sheetId,
      position: nextLayout.position,
      size: nextLayout.frameSize,
    });
  }

  function stopSheetFrameResize(event: PointerEvent<HTMLElement>) {
    if (!sheetFrameResize.current || sheetFrameResize.current.pointerId !== event.pointerId) {
      return;
    }

    const resize = sheetFrameResize.current;
    const nextLayout = resizeSheetFrame(resize, workspaceDeltaFromClient(
      { x: resize.startClientX, y: resize.startClientY },
      { x: event.clientX, y: event.clientY },
      viewportScale,
    ));

    if (
      nextLayout.position.x !== resize.startPosition.x ||
      nextLayout.position.y !== resize.startPosition.y ||
      nextLayout.frameSize.width !== resize.startFrameSize.width ||
      nextLayout.frameSize.height !== resize.startFrameSize.height
    ) {
      commands.resizeSheetFrame(resize.sheetId, nextLayout.position, nextLayout.frameSize);
    }

    sheetFrameResize.current = null;
    setFrameLayoutPreview(null);
    setInteractionPinnedSheetId(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function cancelSheetFrameResize(event: PointerEvent<HTMLElement>) {
    if (!sheetFrameResize.current || sheetFrameResize.current.pointerId !== event.pointerId) return;
    sheetFrameResize.current = null;
    setFrameLayoutPreview(null);
    setInteractionPinnedSheetId(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  return {
    cancelSheetFrameDrag,
    cancelSheetFrameResize,
    frameLayoutPreview,
    handleSheetFrameDragMove,
    handleSheetFrameDragStart,
    handleSheetFrameResizeMove,
    handleSheetFrameResizeStart,
    interactionPinnedSheetId,
    stopSheetFrameDrag,
    stopSheetFrameResize,
  };
}
