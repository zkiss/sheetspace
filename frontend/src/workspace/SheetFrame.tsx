import { useEffect, useRef, useState, type MouseEvent, type MutableRefObject, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { SheetFrameProjection } from '@workbook/core/model';
import type { SheetFrameResizeDirection } from './workspaceContracts';
import { clampSheetFrameSize, clampSheetVisualScale, effectiveSheetScreenScale } from '@workspace/workspaceGeometry';
import '@workspace/SheetFrame.css';

const SHEET_FRAME_RESIZE_HANDLES: [string, SheetFrameResizeDirection][] = [
  ['top', { horizontal: 0, vertical: -1 }],
  ['right', { horizontal: 1, vertical: 0 }],
  ['bottom', { horizontal: 0, vertical: 1 }],
  ['left', { horizontal: -1, vertical: 0 }],
  ['top-left', { horizontal: -1, vertical: -1 }],
  ['top-right', { horizontal: 1, vertical: -1 }],
  ['bottom-right', { horizontal: 1, vertical: 1 }],
  ['bottom-left', { horizontal: -1, vertical: 1 }],
];

export function SheetFrame({
  children,
  columnCount,
  frame,
  isActiveSheet,
  isNavigationReveal,
  onOpenSheetMenu,
  onResizeCancel,
  onResizeMove,
  onResizeStart,
  onResizeStop,
  onScaleCancel,
  onScaleMove,
  onScaleStart,
  onScaleStop,
  onScalePreview,
  onScaleInputStart,
  onScaleCommit,
  onSheetFrameDragCancel,
  onSheetFrameInteraction,
  onSheetFrameDragMove,
  onSheetFrameDragStart,
  onSheetFrameDragStop,
  rowCount,
  viewportScale,
}: {
  children: (scrollContainerRef: RefObject<HTMLDivElement>) => ReactNode;
  columnCount: number;
  frame: SheetFrameProjection;
  isActiveSheet: boolean;
  isNavigationReveal: boolean;
  onOpenSheetMenu: (sheetId: string, event: MouseEvent<HTMLElement>) => void;
  onResizeCancel: (event: PointerEvent<HTMLElement>) => void;
  onResizeMove: (event: PointerEvent<HTMLElement>) => void;
  onResizeStart: (sheetId: string, direction: SheetFrameResizeDirection, event: PointerEvent<HTMLElement>) => void;
  onResizeStop: (event: PointerEvent<HTMLElement>) => void;
  onScaleCancel: (event?: PointerEvent<HTMLElement>) => void;
  onScaleMove: (event: PointerEvent<HTMLElement>) => void;
  onScaleStart: (sheetId: string, event: PointerEvent<HTMLElement>) => void;
  onScaleStop: (event: PointerEvent<HTMLElement>) => void;
  onScalePreview: (sheetId: string, visualScale: number) => void;
  onScaleInputStart: (sheetId: string) => void;
  onScaleCommit: (sheetId: string, visualScale: number) => void;
  onSheetFrameDragCancel: (event: PointerEvent<HTMLElement>) => void;
  onSheetFrameInteraction: () => void;
  onSheetFrameDragMove: (event: PointerEvent<HTMLElement>) => void;
  onSheetFrameDragStart: (sheetId: string, event: PointerEvent<HTMLElement>) => void;
  onSheetFrameDragStop: (event: PointerEvent<HTMLElement>) => void;
  rowCount: number;
  viewportScale: number;
}) {
  const frameSize = clampSheetFrameSize(frame.size);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const isScaleInputEditing = useRef(false);
  const isScaleInputCancellation = useRef(false);
  const [scaleInputValue, setScaleInputValue] = useState(() => scalePercentage(frame.visualScale));
  const screenScale = effectiveSheetScreenScale(viewportScale, frame.visualScale);

  useEffect(() => {
    if (!isScaleInputEditing.current) setScaleInputValue(scalePercentage(frame.visualScale));
  }, [frame.visualScale]);

  return (
    <article
      aria-label={`Sheet ${frame.name}`}
      className={`sheet-frame${isActiveSheet ? ' sheet-frame-active' : ''}${
        isNavigationReveal ? ' sheet-frame-navigation-reveal' : ''
      }`}
      data-active-sheet={isActiveSheet ? 'true' : undefined}
      data-navigation-reveal={isNavigationReveal ? 'true' : undefined}
      data-column-count={columnCount}
      data-frame-height={frameSize.height}
      data-frame-width={frameSize.width}
      data-visual-scale={frame.visualScale}
      data-position-x={frame.position.x}
      data-position-y={frame.position.y}
      data-row-count={rowCount}
      data-sheet-id={frame.id}
      data-testid="sheet-frame"
      data-z-index={frame.zIndex}
      onContextMenu={(event) => onOpenSheetMenu(frame.id, event)}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSheetFrameInteraction();
      }}
      onWheel={(event) => event.stopPropagation()}
      style={{
        left: frame.position.x,
        top: frame.position.y,
        zIndex: frame.zIndex,
        width: frameSize.width,
        height: frameSize.height,
        transform: `scale(${frame.visualScale})`,
        transformOrigin: 'top left',
      }}
    >
      {SHEET_FRAME_RESIZE_HANDLES.map(([handle, direction]) => (
        <div
          aria-label={`Resize sheet ${frame.name} from ${handle}`}
          className={`sheet-frame-resize-handle sheet-frame-resize-handle-${handle}`}
          data-resize-handle={handle}
          data-testid="sheet-frame-resize-handle"
          key={handle}
          onPointerCancel={onResizeCancel}
          onPointerDown={(event) => {
            onSheetFrameInteraction();
            onResizeStart(frame.id, direction, event);
          }}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeStop}
          role="separator"
        />
      ))}
      {isActiveSheet && (
        <>
          <div
            aria-label={`Scale sheet ${frame.name}`}
            className="sheet-frame-scale-handle"
            data-testid="sheet-frame-scale-handle"
            onPointerCancel={onScaleCancel}
            onPointerDown={(event) => onScaleStart(frame.id, event)}
            onPointerMove={onScaleMove}
            onPointerUp={onScaleStop}
            role="slider"
            style={{ transform: `scale(${1 / screenScale})` }}
          />
          <ScaleInput
            frame={frame}
            isCancellation={isScaleInputCancellation}
            isEditing={isScaleInputEditing}
            onScaleCancel={onScaleCancel}
            onScaleCommit={onScaleCommit}
            onScaleInputStart={onScaleInputStart}
            onScalePreview={onScalePreview}
            scaleInputValue={scaleInputValue}
            screenScale={screenScale}
            setScaleInputValue={setScaleInputValue}
          />
        </>
      )}
      <header
        className="sheet-frame-header"
        data-testid="sheet-frame-header"
        onPointerCancel={onSheetFrameDragCancel}
        onPointerDown={(event) => onSheetFrameDragStart(frame.id, event)}
        onPointerMove={onSheetFrameDragMove}
        onPointerUp={onSheetFrameDragStop}
      >
        <h2>{frame.name}</h2>
      </header>
      <div className="sheet-frame-body" data-testid="sheet-frame-body" ref={bodyRef}>
        {children(bodyRef)}
      </div>
    </article>
  );
}

function ScaleInput({
  frame,
  isCancellation,
  isEditing,
  onScaleCancel,
  onScaleCommit,
  onScaleInputStart,
  onScalePreview,
  scaleInputValue,
  screenScale,
  setScaleInputValue,
}: {
  frame: SheetFrameProjection;
  isCancellation: MutableRefObject<boolean>;
  isEditing: MutableRefObject<boolean>;
  onScaleCancel: () => void;
  onScaleCommit: (sheetId: string, visualScale: number) => void;
  onScaleInputStart: (sheetId: string) => void;
  onScalePreview: (sheetId: string, visualScale: number) => void;
  scaleInputValue: string;
  screenScale: number;
  setScaleInputValue: (value: string) => void;
}) {
  const cancelRef = useRef(onScaleCancel);
  cancelRef.current = onScaleCancel;
  useEffect(() => () => cancelRef.current(), []);

  return (
    <label className="sheet-frame-scale-control" style={{ transform: `scale(${1 / screenScale})` }}>
      <span className="visually-hidden">Scale sheet {frame.name}</span>
      <input
        aria-label={`Scale sheet ${frame.name} percentage`}
        inputMode="decimal"
        onBlur={() => {
          if (isCancellation.current) {
            isCancellation.current = false;
            return;
          }
          isEditing.current = false;
          setScaleInputValue(scalePercentage(frame.visualScale));
          onScaleCancel();
        }}
        onChange={(event) => {
          setScaleInputValue(event.currentTarget.value);
          const value = Number(event.currentTarget.value);
          if (Number.isFinite(value) && value > 0) onScalePreview(frame.id, value / 100);
        }}
        onFocus={() => {
          isEditing.current = true;
          onScaleInputStart(frame.id);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            isEditing.current = false;
            isCancellation.current = true;
            setScaleInputValue(scalePercentage(frame.visualScale));
            onScaleCancel();
            event.currentTarget.blur();
          }
          if (event.key === 'Enter') {
            const value = Number(event.currentTarget.value);
            if (Number.isFinite(value) && value > 0) {
              isEditing.current = false;
              isCancellation.current = true;
              const visualScale = clampSheetVisualScale(value / 100);
              setScaleInputValue(scalePercentage(visualScale));
              onScaleCommit(frame.id, visualScale);
              event.currentTarget.blur();
            }
          }
        }}
        type="number"
        value={scaleInputValue}
      />
      <span aria-hidden="true">%</span>
    </label>
  );
}

function scalePercentage(visualScale: number) {
  return String(Math.round(visualScale * 100));
}
