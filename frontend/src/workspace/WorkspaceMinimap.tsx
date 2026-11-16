import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { SheetFrameProjection, SheetFrameSize, WorkspacePosition } from '@workbook/core/model';
import type { WorkspaceViewport } from './workspaceContracts';
import { minimapCenteredViewport, minimapDraggedViewport, minimapProjection, minimapRect, type MinimapProjection } from './minimapGeometry';
import { workspaceRectForFrame, workspaceViewportBounds } from './workspaceGeometry';
import type { SheetFrameLayoutPreview } from './useSheetFrameInteractions';
import './WorkspaceMinimap.css';

const size = { width: 200, height: 130 };
type Frame = SheetFrameProjection;
type Drag = { pointer: number; projection: MinimapProjection; start: WorkspacePosition; viewport: WorkspaceViewport; moved: boolean };

export function WorkspaceMinimap({ frames, surface, viewport, surfaceRef, disabled, concealed, begin, move, finish }: {
  frames: readonly Frame[]; surface: SheetFrameSize | null; viewport: WorkspaceViewport;
  surfaceRef: RefObject<HTMLElement>; disabled: boolean; concealed: boolean;
  begin: () => WorkspaceViewport | null; move: (viewport: WorkspaceViewport) => void; finish: () => void;
}) {
  const [visible, setVisible] = useState(true);
  const [displayed, setDisplayed] = useState(viewport);
  const [dragging, setDragging] = useState(false);
  const [framePreview, setFramePreview] = useState<SheetFrameLayoutPreview | null>(null);
  const drag = useRef<Drag | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => setDisplayed(viewport), [viewport]);
  useEffect(() => {
    const element = surfaceRef.current;
    const update = (event: Event) => setDisplayed((event as CustomEvent<WorkspaceViewport>).detail);
    const updateFrame = (event: Event) => setFramePreview((event as CustomEvent<SheetFrameLayoutPreview | null>).detail);
    element?.addEventListener('workspace-viewport', update);
    element?.addEventListener('workspace-frame-preview', updateFrame);
    return () => { element?.removeEventListener('workspace-viewport', update); element?.removeEventListener('workspace-frame-preview', updateFrame); };
  }, [surfaceRef]);
  useEffect(() => () => { if (drag.current) { drag.current = null; finishRef.current(); } }, []);
  useEffect(() => {
    if (!(disabled || concealed || !visible) || !drag.current) return;
    const pointer = drag.current.pointer;
    drag.current = null; setDragging(false); finishRef.current();
    if (svgRef.current?.hasPointerCapture(pointer)) svgRef.current.releasePointerCapture(pointer);
  }, [disabled, concealed, visible]);
  const displayedFrames = framePreview ? frames.map((frame) => frame.id === framePreview.sheetId
    ? { ...frame, position: framePreview.position, size: framePreview.size } : frame) : frames;
  const projection = drag.current?.projection ?? (surface && minimapProjection(displayedFrames, surface, displayed, size));
  const point = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * size.width / bounds.width, y: (event.clientY - bounds.top) * size.height / bounds.height };
  };
  const down = (event: PointerEvent<SVGSVGElement>) => {
    event.preventDefault(); event.stopPropagation();
    if (drag.current || disabled || concealed || !visible || event.button !== 0 || !projection || !surface) return;
    const start = point(event);
    const current = begin();
    if (!current) return;
    const bounds = minimapRect(projection, workspaceViewportBounds(surface, current));
    if (start.x >= bounds.left && start.x <= bounds.right && start.y >= bounds.top && start.y <= bounds.bottom) {
      drag.current = { pointer: event.pointerId, projection, start, viewport: current, moved: false };
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    } else { move(minimapCenteredViewport(projection, start, surface, current)); finish(); }
  };
  const end = (event: PointerEvent<SVGSVGElement>) => {
    event.stopPropagation();
    if (drag.current?.pointer !== event.pointerId) return;
    const active = drag.current;
    if (event.type === 'pointerup' && !active.moved && surface) {
      move(minimapCenteredViewport(active.projection, point(event), surface, active.viewport));
    }
    drag.current = null; setDragging(false); finish();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const rectangle = (bounds: ReturnType<typeof minimapRect>) => ({ x: bounds.left, y: bounds.top, width: Math.max(0, bounds.right - bounds.left), height: Math.max(0, bounds.bottom - bounds.top) });
  return <div className={`workspace-minimap${visible ? '' : ' workspace-minimap-hidden'}${disabled ? ' workspace-minimap-disabled' : ''}`} hidden={concealed} data-workspace-minimap data-workspace-native-content onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}>
    {visible ? <>
      <div className="workspace-minimap-heading"><span>Workspace map</span><button type="button" aria-label="Hide workspace map" disabled={disabled} onPointerDown={(event) => event.preventDefault()} onClick={() => setVisible(false)}>×</button></div>
      <svg ref={svgRef} aria-label="Workspace map" role="img" viewBox={`0 0 ${size.width} ${size.height}`} onPointerDown={down} onPointerMove={(event) => { event.stopPropagation(); const active = drag.current; if (active && active.pointer === event.pointerId) { const current = point(event); if (current.x !== active.start.x || current.y !== active.start.y) active.moved = true; if (active.moved) move(minimapDraggedViewport(active.projection, active.start, current, active.viewport)); } }} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} className={dragging ? 'dragging' : ''}>
        {projection && surface && <>
          {displayedFrames.map((frame) => <rect className="workspace-minimap-sheet" key={frame.id} {...rectangle(minimapRect(projection, workspaceRectForFrame(frame)))} />)}
          <rect className="workspace-minimap-viewport" {...rectangle(minimapRect(projection, workspaceViewportBounds(surface, displayed)))} />
        </>}
      </svg>
    </> : <button type="button" disabled={disabled} onPointerDown={(event) => event.preventDefault()} onClick={() => setVisible(true)}>Show workspace map</button>}
  </div>;
}
