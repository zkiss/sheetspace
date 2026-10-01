import { PointerEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SheetFrameDrag, SheetFrameLayoutCommands, SheetFrameResize, SheetFrameResizeDirection, SheetFrameScale } from './workspaceContracts';
import { findSheetById } from '@workbook/read/queries';
import { type SheetFrameSize, type Workbook, type WorkspacePosition } from '@workbook/core/model';
import { clampSheetVisualScale, logicalDeltaFromClient, resizeSheetFrame, workspaceDeltaFromClient } from '@workspace/workspaceGeometry';

export type SheetFrameLayoutPreview = {
  sheetId: string;
  position: WorkspacePosition;
  size: SheetFrameSize;
};

type SheetFrameInteractionSession = (
  | { owner: 'drag'; interaction: SheetFrameDrag }
  | { owner: 'resize'; interaction: SheetFrameResize }
  | { owner: 'pointer-scale'; interaction: SheetFrameScale }
) & { captureElement: HTMLElement; viewportScale: number };

export function useSheetFrameInteractions({
  commands,
  interactionsEnabled = true,
  viewportScale,
  workbook,
}: {
  commands: SheetFrameLayoutCommands;
  interactionsEnabled?: boolean;
  viewportScale: number;
  workbook: Workbook;
}) {
  const sheetFrameInteractionSession = useRef<SheetFrameInteractionSession | null>(null);
  const [frameLayoutPreview, setFrameLayoutPreview] = useState<SheetFrameLayoutPreview | null>(null);
  const [frameScalePreview, setFrameScalePreview] = useState<{ sheetId: string; visualScale: number; position: WorkspacePosition } | null>(null);
  const [interactionPinnedSheetId, setInteractionPinnedSheetId] = useState<string | null>(null);

  function startInteraction(session: SheetFrameInteractionSession) {
    if (!interactionsEnabled || sheetFrameInteractionSession.current) return false;
    sheetFrameInteractionSession.current = session;
    setFrameLayoutPreview(null);
    setFrameScalePreview(null);
    // Keep the frame mounted for the complete pointer session. Workspace owns
    // detailed/overview rendering separately, so this pin does not reveal a grid.
    setInteractionPinnedSheetId(session.interaction.sheetId);
    return true;
  }

  function clearInteractionSession() {
    const previous = sheetFrameInteractionSession.current;
    sheetFrameInteractionSession.current = null;
    if (previous?.captureElement.hasPointerCapture?.(previous.interaction.pointerId)) {
      previous.captureElement.releasePointerCapture(previous.interaction.pointerId);
    }
    setFrameLayoutPreview(null);
    setFrameScalePreview(null);
    setInteractionPinnedSheetId(null);
  }

  function handleSheetFrameDragStart(sheetId: string, event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 && event.button !== undefined) {
      return;
    }

    const sheet = findSheetById(workbook, sheetId);
    if (!sheet) {
      return;
    }
    if (!startInteraction({ owner: 'drag', captureElement: event.currentTarget, viewportScale, interaction: {
      pointerId: event.pointerId,
      sheetId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition: sheet.frame.position,
    }})) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handleSheetFrameDragMove(event: PointerEvent<HTMLElement>) {
    const current = sheetFrameInteractionSession.current;
    if (current?.owner !== 'drag' || current.interaction.pointerId !== event.pointerId) {
      return;
    }

    const drag = current.interaction;
    const delta = workspaceDeltaFromClient(
      { x: drag.startClientX, y: drag.startClientY },
      { x: event.clientX, y: event.clientY },
      current.viewportScale,
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
    const current = sheetFrameInteractionSession.current;
    if (current?.owner !== 'drag' || current.interaction.pointerId !== event.pointerId) {
      return;
    }

    const finishedDrag = current.interaction;
    const delta = workspaceDeltaFromClient(
      { x: finishedDrag.startClientX, y: finishedDrag.startClientY },
      { x: event.clientX, y: event.clientY },
      current.viewportScale,
    );
    const position = {
      x: Math.round(finishedDrag.startPosition.x + delta.x),
      y: Math.round(finishedDrag.startPosition.y + delta.y),
    };
    if (position.x !== finishedDrag.startPosition.x || position.y !== finishedDrag.startPosition.y) {
      commands.moveSheetFrame(finishedDrag.sheetId, position);
    }

    clearInteractionSession();
  }

  function cancelSheetFrameDrag(event: PointerEvent<HTMLElement>) {
    const current = sheetFrameInteractionSession.current;
    if (current?.owner !== 'drag' || current.interaction.pointerId !== event.pointerId) return;
    clearInteractionSession();
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
    if (event.ctrlKey || event.metaKey) {
      handleSheetFrameScaleStart(sheetId, event, direction);
      return;
    }

    if (!startInteraction({ owner: 'resize', captureElement: event.currentTarget, viewportScale, interaction: {
      pointerId: event.pointerId,
      sheetId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition: sheet.frame.position,
      startFrameSize: sheet.frame.size,
      startVisualScale: sheet.frame.visualScale,
      direction,
    }})) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function handleSheetFrameResizeMove(event: PointerEvent<HTMLElement>) {
    const current = sheetFrameInteractionSession.current;
    if (current?.owner === 'pointer-scale' && current.interaction.pointerId === event.pointerId) {
      handleSheetFrameScaleMove(event);
      return;
    }
    if (current?.owner !== 'resize' || current.interaction.pointerId !== event.pointerId) {
      return;
    }

    const resize = current.interaction;
    const sheet = findSheetById(workbook, resize.sheetId);
    if (!sheet) return;
    const nextLayout = resizeSheetFrame(resize, logicalDeltaFromClient(
      { x: resize.startClientX, y: resize.startClientY },
      { x: event.clientX, y: event.clientY },
      current.viewportScale,
      resize.startVisualScale,
    ));
    setFrameLayoutPreview({
      sheetId: resize.sheetId,
      position: nextLayout.position,
      size: nextLayout.frameSize,
    });
  }

  function stopSheetFrameResize(event: PointerEvent<HTMLElement>) {
    const current = sheetFrameInteractionSession.current;
    if (current?.owner === 'pointer-scale' && current.interaction.pointerId === event.pointerId) {
      stopSheetFrameScale(event);
      return;
    }
    if (current?.owner !== 'resize' || current.interaction.pointerId !== event.pointerId) {
      return;
    }

    const resize = current.interaction;
    const sheet = findSheetById(workbook, resize.sheetId);
    if (!sheet) return;
    const nextLayout = resizeSheetFrame(resize, logicalDeltaFromClient(
      { x: resize.startClientX, y: resize.startClientY },
      { x: event.clientX, y: event.clientY },
      current.viewportScale,
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

    clearInteractionSession();
  }

  function cancelSheetFrameResize(event: PointerEvent<HTMLElement>) {
    const current = sheetFrameInteractionSession.current;
    if (current?.owner === 'pointer-scale' && current.interaction.pointerId === event.pointerId) {
      cancelSheetFrameScalePointer(event);
      return;
    }
    if (current?.owner !== 'resize' || current.interaction.pointerId !== event.pointerId) return;
    clearInteractionSession();
  }

  function cancelSheetFrameScale() {
    clearInteractionSession();
  }

  function cancelSheetFrameScalePointer(event: PointerEvent<HTMLElement>) {
    const current = sheetFrameInteractionSession.current;
    if (current?.owner !== 'pointer-scale' || current.interaction.pointerId !== event.pointerId) return;
    clearInteractionSession();
  }

  function handleSheetFrameScaleStart(sheetId: string, event: PointerEvent<HTMLElement>, direction: SheetFrameResizeDirection = { horizontal: 1, vertical: 0 }) {
    if (event.button !== 0 && event.button !== undefined) return;
    const sheet = findSheetById(workbook, sheetId);
    if (!sheet) return;
    if (!startInteraction({ owner: 'pointer-scale', captureElement: event.currentTarget, viewportScale, interaction: {
      pointerId: event.pointerId, sheetId, startClientX: event.clientX, startClientY: event.clientY, startVisualScale: sheet.frame.visualScale, direction,
      startPosition: sheet.frame.position, startFrameSize: sheet.frame.size,
    }})) return;
    setFrameScalePreview({ sheetId, visualScale: sheet.frame.visualScale, position: sheet.frame.position });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault(); event.stopPropagation();
  }

  function handleSheetFrameScaleMove(event: PointerEvent<HTMLElement>) {
    const current = sheetFrameInteractionSession.current;
    if (current?.owner !== 'pointer-scale' || current.interaction.pointerId !== event.pointerId) return;
    const scale = current.interaction;
    const preview = scalePreviewAtPointer(scale, event, current.viewportScale);
    setFrameScalePreview(preview);
    const sheet = findSheetById(workbook, scale.sheetId);
    if (sheet) setFrameLayoutPreview({ sheetId: scale.sheetId, position: preview.position, size: sheet.frame.size });
  }

  function stopSheetFrameScale(event: PointerEvent<HTMLElement>) {
    const current = sheetFrameInteractionSession.current;
    if (current?.owner !== 'pointer-scale' || current.interaction.pointerId !== event.pointerId) return;
    handleSheetFrameScaleMove(event);
    const scale = current.interaction;
    const preview = scalePreviewAtPointer(scale, event, current.viewportScale);
    const sheet = findSheetById(workbook, scale.sheetId);
    if (preview.visualScale !== scale.startVisualScale) commands.setSheetVisualScale(scale.sheetId, preview.visualScale);
    if (sheet && (preview.position.x !== sheet.frame.position.x || preview.position.y !== sheet.frame.position.y)) {
      commands.moveSheetFrame(scale.sheetId, preview.position);
    }
    cancelSheetFrameScalePointer(event);
  }

  function scalePreviewAtPointer(scale: SheetFrameScale, event: PointerEvent<HTMLElement>, viewportScale: number) {
    const delta = workspaceDeltaFromClient(
      { x: scale.startClientX, y: scale.startClientY },
      { x: event.clientX, y: event.clientY },
      viewportScale,
    );
    const candidates = [
      scale.direction.horizontal ? scale.startVisualScale + delta.x * scale.direction.horizontal / scale.startFrameSize.width : undefined,
      scale.direction.vertical ? scale.startVisualScale + delta.y * scale.direction.vertical / scale.startFrameSize.height : undefined,
    ].filter((candidate): candidate is number => candidate !== undefined);
    const visualScale = clampSheetVisualScale(candidates.reduce((total, candidate) => total + candidate, 0) / candidates.length);
    return {
      sheetId: scale.sheetId,
      visualScale,
      position: {
        x: scale.startPosition.x + (scale.direction.horizontal === -1 ? scale.startFrameSize.width * (scale.startVisualScale - visualScale) : 0),
        y: scale.startPosition.y + (scale.direction.vertical === -1 ? scale.startFrameSize.height * (scale.startVisualScale - visualScale) : 0),
      },
    };
  }

  useEffect(() => {
    const session = sheetFrameInteractionSession.current;
    if (session && !findSheetById(workbook, session.interaction.sheetId)) clearInteractionSession();
  }, [workbook]);

  useLayoutEffect(() => {
    if (!interactionsEnabled) {
      clearInteractionSession();
      return;
    }
    const cancel = () => cancelSheetFrameScale();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('blur', cancel); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('blur', cancel); window.removeEventListener('keydown', key, true); cancel(); };
  }, [interactionsEnabled]);

  return {
    cancelSheetFrameDrag,
    cancelSheetFrameResize,
    cancelSheetFrameScale,
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
  };
}
