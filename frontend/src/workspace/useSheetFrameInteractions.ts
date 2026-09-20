import { PointerEvent, useEffect, useRef, useState } from 'react';
import type { SheetFrameDrag, SheetFrameLayoutCommands, SheetFrameResize, SheetFrameResizeDirection, SheetFrameScale } from './workspaceContracts';
import { findSheetById } from '@workbook/read/queries';
import { type SheetFrameSize, type Workbook, type WorkspacePosition } from '@workbook/core/model';
import { clampSheetVisualScale, logicalDeltaFromClient, resizeSheetFrame, workspaceDeltaFromClient } from '@workspace/workspaceGeometry';

export type SheetFrameLayoutPreview = {
  sheetId: string;
  position: WorkspacePosition;
  size: SheetFrameSize;
};

type SheetFrameScaleSession =
  | ({ owner: 'pointer' } & SheetFrameScale)
  | { owner: 'numeric'; sheetId: string; startVisualScale: number };

export function useSheetFrameInteractions({
  commands,
  viewportScale,
  workbook,
}: {
  commands: SheetFrameLayoutCommands;
  viewportScale: number;
  workbook: Workbook;
}) {
  const sheetFrameDrag = useRef<SheetFrameDrag | null>(null);
  const sheetFrameResize = useRef<SheetFrameResize | null>(null);
  const sheetFrameScaleSession = useRef<SheetFrameScaleSession | null>(null);
  const [frameLayoutPreview, setFrameLayoutPreview] = useState<SheetFrameLayoutPreview | null>(null);
  const [frameScalePreview, setFrameScalePreview] = useState<{ sheetId: string; visualScale: number } | null>(null);
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
    event.currentTarget?.releasePointerCapture?.(event.pointerId);
  }

  function cancelSheetFrameDrag(event: PointerEvent<HTMLElement>) {
    if (!sheetFrameDrag.current || sheetFrameDrag.current.pointerId !== event.pointerId) return;
    sheetFrameDrag.current = null;
    setFrameLayoutPreview(null);
    setInteractionPinnedSheetId(null);
    event.currentTarget?.releasePointerCapture?.(event.pointerId);
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
      startVisualScale: sheet.frame.visualScale,
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
    const sheet = findSheetById(workbook, resize.sheetId);
    if (!sheet) return;
    const nextLayout = resizeSheetFrame(resize, logicalDeltaFromClient(
      { x: resize.startClientX, y: resize.startClientY },
      { x: event.clientX, y: event.clientY },
      viewportScale,
      resize.startVisualScale,
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
    const sheet = findSheetById(workbook, resize.sheetId);
    if (!sheet) return;
    const nextLayout = resizeSheetFrame(resize, logicalDeltaFromClient(
      { x: resize.startClientX, y: resize.startClientY },
      { x: event.clientX, y: event.clientY },
      viewportScale,
      resize.startVisualScale,
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
    event.currentTarget?.releasePointerCapture?.(event.pointerId);
  }

  function cancelSheetFrameResize(event: PointerEvent<HTMLElement>) {
    if (!sheetFrameResize.current || sheetFrameResize.current.pointerId !== event.pointerId) return;
    sheetFrameResize.current = null;
    setFrameLayoutPreview(null);
    setInteractionPinnedSheetId(null);
    event.currentTarget?.releasePointerCapture?.(event.pointerId);
  }

  function clearSheetFrameScaleSession() {
    sheetFrameScaleSession.current = null;
    setFrameScalePreview(null);
    setInteractionPinnedSheetId(null);
  }

  function cancelSheetFrameScale() {
    clearSheetFrameScaleSession();
  }

  function cancelSheetFrameScalePointer(event: PointerEvent<HTMLElement>) {
    const current = sheetFrameScaleSession.current;
    if (current?.owner !== 'pointer' || current.pointerId !== event.pointerId) return;
    clearSheetFrameScaleSession();
    if (event.currentTarget?.hasPointerCapture?.(current.pointerId)) {
      event.currentTarget.releasePointerCapture(current.pointerId);
    }
  }

  function cancelSheetFrameScaleInput(sheetId: string) {
    const current = sheetFrameScaleSession.current;
    if (current?.owner !== 'numeric' || current.sheetId !== sheetId) return;
    clearSheetFrameScaleSession();
  }

  function handleSheetFrameScaleStart(sheetId: string, event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 && event.button !== undefined) return;
    const sheet = findSheetById(workbook, sheetId);
    if (!sheet) return;
    sheetFrameScaleSession.current = {
      owner: 'pointer', pointerId: event.pointerId, sheetId, startClientX: event.clientX, startVisualScale: sheet.frame.visualScale,
    };
    setFrameScalePreview({ sheetId, visualScale: sheet.frame.visualScale });
    setInteractionPinnedSheetId(sheetId);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault(); event.stopPropagation();
  }

  function handleSheetFrameScaleMove(event: PointerEvent<HTMLElement>) {
    const current = sheetFrameScaleSession.current;
    if (current?.owner !== 'pointer' || current.pointerId !== event.pointerId) return;
    // 100 device pixels is one doubling; this keeps the drag useful at every sheet scale.
    const visualScale = clampSheetVisualScale(current.startVisualScale * Math.pow(2, (event.clientX - current.startClientX) / 100));
    setFrameScalePreview({ sheetId: current.sheetId, visualScale });
  }

  function stopSheetFrameScale(event: PointerEvent<HTMLElement>) {
    const current = sheetFrameScaleSession.current;
    if (current?.owner !== 'pointer' || current.pointerId !== event.pointerId) return;
    handleSheetFrameScaleMove(event);
    const visualScale = clampSheetVisualScale(current.startVisualScale * Math.pow(2, (event.clientX - current.startClientX) / 100));
    if (visualScale !== current.startVisualScale) commands.setSheetVisualScale(current.sheetId, visualScale);
    cancelSheetFrameScalePointer(event);
  }

  function previewSheetFrameScale(sheetId: string, visualScale: number) {
    const current = sheetFrameScaleSession.current;
    if (current?.owner !== 'numeric' || current.sheetId !== sheetId) return;
    setFrameScalePreview({ sheetId, visualScale: clampSheetVisualScale(visualScale) });
  }

  function startSheetFrameScaleInput(sheetId: string) {
    const sheet = findSheetById(workbook, sheetId);
    if (!sheet) return;
    sheetFrameScaleSession.current = { owner: 'numeric', sheetId, startVisualScale: sheet.frame.visualScale };
    setFrameScalePreview({ sheetId, visualScale: sheet.frame.visualScale });
    setInteractionPinnedSheetId(sheetId);
  }

  function commitSheetFrameScale(sheetId: string, visualScale: number) {
    const current = sheetFrameScaleSession.current;
    if (current?.owner !== 'numeric' || current.sheetId !== sheetId) return;
    const sheet = findSheetById(workbook, sheetId);
    const next = clampSheetVisualScale(visualScale);
    clearSheetFrameScaleSession();
    if (sheet && sheet.frame.visualScale !== next) commands.setSheetVisualScale(sheetId, next);
  }

  useEffect(() => {
    const cancel = () => { cancelSheetFrameDrag({ pointerId: sheetFrameDrag.current?.pointerId } as PointerEvent<HTMLElement>); cancelSheetFrameResize({ pointerId: sheetFrameResize.current?.pointerId } as PointerEvent<HTMLElement>); cancelSheetFrameScale(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('blur', cancel); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('blur', cancel); window.removeEventListener('keydown', key, true); cancel(); };
  }, []);

  return {
    cancelSheetFrameDrag,
    cancelSheetFrameResize,
    cancelSheetFrameScale,
    cancelSheetFrameScaleInput,
    cancelSheetFrameScalePointer,
    frameLayoutPreview,
    frameScalePreview,
    handleSheetFrameDragMove,
    handleSheetFrameDragStart,
    handleSheetFrameResizeMove,
    handleSheetFrameResizeStart,
    handleSheetFrameScaleMove,
    handleSheetFrameScaleStart,
    interactionPinnedSheetId,
    stopSheetFrameDrag,
    stopSheetFrameResize,
    stopSheetFrameScale,
    previewSheetFrameScale,
    startSheetFrameScaleInput,
    commitSheetFrameScale,
  };
}
