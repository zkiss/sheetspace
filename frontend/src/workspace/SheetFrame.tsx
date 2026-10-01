import { useEffect, useRef, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { SheetFrameProjection } from '@workbook/core/model';
import type { SheetFrameResizeDirection } from './workspaceContracts';
import { clampSheetFrameSize, effectiveSheetScreenScale, SHEET_HEADER_HEIGHT } from '@workspace/workspaceGeometry';
import { resolveSheetRenderingMode } from '@workspace/sheetRenderingMode';
import { isSheetContextTarget } from './workspaceEventPolicy';
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
  retainDetailedBody,
  overview,
  onDetailedFocusDisplaced,
  onDetailedBodyAvailable,
  onDetailedNativeFocusReleased,
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
  onSelectSheet,
  rowCount,
  viewportScale,
}: {
  children: (scrollContainerRef: RefObject<HTMLDivElement>) => ReactNode;
  columnCount: number;
  frame: SheetFrameProjection;
  isActiveSheet: boolean;
  isNavigationReveal: boolean;
  /** Retain an existing detailed body during editing or a gesture; never reveal one solely for a culling pin. */
  retainDetailedBody?: boolean;
  overview?: ReactNode;
  /** Reports that replacing this detailed body displaced native grid focus. */
  onDetailedFocusDisplaced?: () => void;
  /** Reports that this frame has a detailed body that can accept grid focus. */
  onDetailedBodyAvailable?: () => void;
  /** Reports native grid focus leaving the detailed body. */
  onDetailedNativeFocusReleased?: () => void;
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
  onSelectSheet: () => void;
  rowCount: number;
  viewportScale: number;
}) {
  const frameSize = clampSheetFrameSize(frame.size);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const screenScale = effectiveSheetScreenScale(viewportScale, frame.visualScale);
  const renderingModeRef = useRef(resolveSheetRenderingMode(screenScale));
  const requestedRenderingMode = resolveSheetRenderingMode(screenScale, renderingModeRef.current);
  renderingModeRef.current = requestedRenderingMode;
  const previousRenderingMode = useRef(requestedRenderingMode);
  const renderingMode = retainDetailedBody && previousRenderingMode.current === 'detailed'
    ? 'detailed'
    : requestedRenderingMode;
  const bodyHadFocus = useRef(false);

  useEffect(() => {
    const previousMode = previousRenderingMode.current;
    if (previousMode === 'detailed' && renderingMode === 'overview' && bodyHadFocus.current) {
      // The detailed grid is about to disappear. Keep focus in the frame rather
      // than allowing the browser to strand it on document.body. The workspace
      // owns the eventual destination because overview selection may change it.
      onDetailedFocusDisplaced?.();
      bodyRef.current?.focus();
    }
    if (renderingMode === 'detailed') onDetailedBodyAvailable?.();
    previousRenderingMode.current = renderingMode;
  }, [onDetailedBodyAvailable, onDetailedFocusDisplaced, renderingMode]);

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
      data-rendering-mode={renderingMode}
      data-sheet-id={frame.id}
      data-workspace-sheet-frame
      data-testid="sheet-frame"
      data-z-index={frame.zIndex}
      onContextMenu={(event) => {
        if (!event.defaultPrevented && isSheetContextTarget(event.target, event.currentTarget)) onOpenSheetMenu(frame.id, event);
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSheetFrameInteraction();
      }}
      onWheel={(event) => event.stopPropagation()}
      style={{
        '--sheet-header-height': `${SHEET_HEADER_HEIGHT}px`,
        left: frame.position.x,
        top: frame.position.y,
        zIndex: frame.zIndex,
        width: frameSize.width,
        height: frameSize.height,
        transform: `scale(${frame.visualScale})`,
        transformOrigin: 'top left',
      } as CSSProperties}
    >
      {SHEET_FRAME_RESIZE_HANDLES.map(([handle, direction]) => (
        <div
          aria-label={`Resize sheet ${frame.name} from ${handle}`}
          className={`sheet-frame-resize-handle sheet-frame-resize-handle-${handle}`}
          data-resize-handle={handle}
          data-testid="sheet-frame-resize-handle"
          key={handle}
          onPointerCancel={onResizeCancel}
          onLostPointerCapture={onResizeCancel}
          onPointerDown={(event) => {
            onSheetFrameInteraction();
            onResizeStart(frame.id, direction, event);
          }}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeStop}
          role="separator"
          style={{ transform: resizeHandleTransform(handle, screenScale) }}
        />
      ))}
      <header
        className="sheet-frame-header"
        data-testid="sheet-frame-header"
        onPointerCancel={onSheetFrameDragCancel}
        onLostPointerCapture={onSheetFrameDragCancel}
        onPointerDown={(event) => {
          if (event.button === 0) onSelectSheet();
          onSheetFrameDragStart(frame.id, event);
        }}
        onPointerMove={onSheetFrameDragMove}
        onPointerUp={onSheetFrameDragStop}
      >
        <h2>{frame.name}</h2>
      </header>
      <div
        className="sheet-frame-body"
        data-rendering-mode={renderingMode}
        data-testid="sheet-frame-body"
        onBlurCapture={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          bodyHadFocus.current = false;
          if (renderingMode === 'detailed') onDetailedNativeFocusReleased?.();
        }}
        onFocusCapture={() => {
          bodyHadFocus.current = true;
        }}
        ref={bodyRef}
        tabIndex={-1}
      >
        {renderingMode === 'overview' ? overview : children(bodyRef)}
      </div>
    </article>
  );
}

function resizeHandleTransform(handle: string, screenScale: number) {
  const inverseScreenScale = 1 / screenScale;
  if (handle === 'top' || handle === 'bottom') return `scaleY(${inverseScreenScale})`;
  if (handle === 'left' || handle === 'right') return `scaleX(${inverseScreenScale})`;
  return `scale(${inverseScreenScale})`;
}
