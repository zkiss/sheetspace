import { Dispatch, PointerEvent, SetStateAction, useRef } from 'react';
import type { WorkbookApi } from './workbookApi';
import type { SheetFrameDrag, SheetFrameResize, SheetFrameResizeDirection } from './appTypes';
import type { SheetFrameSize, Workbook, WorkspacePosition } from './workbook';
import { resizeSheetFrame } from './workspaceGeometry';

export function useSheetFrameInteractions({
  enqueueEdit,
  getApiMethod,
  runRevisionedEdit,
  setWorkbook,
  viewportScale,
  workbook,
}: {
  enqueueEdit: (key: string, run: () => Promise<Workbook>) => void;
  getApiMethod: <K extends keyof WorkbookApi>(method: K) => WorkbookApi[K];
  runRevisionedEdit: (
    sheetId: string,
    save: (revision: number | undefined) => Promise<Workbook>,
  ) => Promise<Workbook>;
  setWorkbook: Dispatch<SetStateAction<Workbook>>;
  viewportScale: number;
  workbook: Workbook;
}) {
  const sheetFrameDrag = useRef<SheetFrameDrag | null>(null);
  const sheetFrameResize = useRef<SheetFrameResize | null>(null);

  function moveSheetFrame(sheetId: string, position: WorkspacePosition) {
    setWorkbook((currentWorkbook) => ({
      ...currentWorkbook,
      sheets: currentWorkbook.sheets.map((sheet) =>
        sheet.id === sheetId
          ? {
              ...sheet,
              position,
            }
          : sheet,
      ),
    }));
  }

  function resizeSheetFrameInWorkbook(sheetId: string, position: WorkspacePosition, frameSize: SheetFrameSize) {
    setWorkbook((currentWorkbook) => ({
      ...currentWorkbook,
      sheets: currentWorkbook.sheets.map((sheet) =>
        sheet.id === sheetId
          ? {
              ...sheet,
              position,
              frameSize,
            }
          : sheet,
      ),
    }));
  }

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
    moveSheetFrame(sheetFrameDrag.current.sheetId, nextPosition);
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
      enqueueEdit(`sheet:${finishedDrag.sheetId}:position`, () =>
        runRevisionedEdit(finishedDrag.sheetId, (revision) =>
          getApiMethod('updateSheetPosition')(finishedDrag.sheetId, position, { revision }),
        ),
      );
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
    resizeSheetFrameInWorkbook(resize.sheetId, nextLayout.position, nextLayout.frameSize);
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
      enqueueEdit(`sheet:${resize.sheetId}:frame-size`, () =>
        runRevisionedEdit(resize.sheetId, (revision) =>
          getApiMethod('updateSheetFrameSize')(resize.sheetId, nextLayout.frameSize, { revision }),
        ),
      );
      if (nextLayout.position.x !== resize.startPosition.x || nextLayout.position.y !== resize.startPosition.y) {
        enqueueEdit(`sheet:${resize.sheetId}:position`, () =>
          runRevisionedEdit(resize.sheetId, (revision) =>
            getApiMethod('updateSheetPosition')(resize.sheetId, nextLayout.position, { revision }),
          ),
        );
      }
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
