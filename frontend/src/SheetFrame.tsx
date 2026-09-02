import { useRef, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { SheetFrameProjection } from './workbook/core/model';
import type { SheetFrameResizeDirection } from './appTypes';
import { FLOATING_OVERLAY_Z_INDEX } from './styleTokens';
import { clampSheetFrameSize } from './workspaceGeometry';
import './SheetFrame.css';

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
  onSheetFrameDragCancel,
  onSheetFrameInteraction,
  onSheetFrameDragMove,
  onSheetFrameDragStart,
  onSheetFrameDragStop,
  rowCount,
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
  onSheetFrameDragCancel: (event: PointerEvent<HTMLElement>) => void;
  onSheetFrameInteraction: () => void;
  onSheetFrameDragMove: (event: PointerEvent<HTMLElement>) => void;
  onSheetFrameDragStart: (sheetId: string, event: PointerEvent<HTMLElement>) => void;
  onSheetFrameDragStop: (event: PointerEvent<HTMLElement>) => void;
  rowCount: number;
}) {
  const frameSize = clampSheetFrameSize(frame.size);
  const bodyRef = useRef<HTMLDivElement | null>(null);

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
        zIndex: isNavigationReveal ? FLOATING_OVERLAY_Z_INDEX : frame.zIndex,
        width: frameSize.width,
        height: frameSize.height,
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
