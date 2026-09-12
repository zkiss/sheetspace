import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { WorkspacePosition } from '@workbook/core/model';
import { normalizedWheelDelta, surfaceDeltaFromClient, surfacePointFromClient, surfaceSize, zoomFactorFromWheelDelta } from './workspaceGeometry';

const INPUT = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';
const NATIVE_CONTENT = `${INPUT}, [data-sheet-id], [role="menu"], button, a`;

function within(target: EventTarget | null, selector: string) {
  return target instanceof Element && !!target.closest(selector);
}

function consume(event: Event) {
  event.preventDefault();
  event.stopPropagation();
}

type Pan = { pointerId: number; x: number; y: number; button: number; space: boolean };
type GestureEvent = Event & { scale: number; clientX: number; clientY: number };

/** Native capture runs before sheet handlers; non-passive wheel permits selective cancellation. */
export function useWorkspaceGestures(
  surfaceRef: RefObject<HTMLElement>,
  actions: {
    start: () => void;
    pan: (x: number, y: number) => void;
    zoom: (factor: number, origin: WorkspacePosition) => void;
    closeMenu: () => void;
  },
) {
  const current = useRef(actions);
  useLayoutEffect(() => { current.current = actions; });
  const [panning, setPanning] = useState(false);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    let pan: Pan | null = null;
    let space = false;
    let suppressClick = false;
    let gestureScale: number | null = null;

    function endPan() {
      const previous = pan;
      pan = null;
      setPanning(false);
      if (previous && surface!.hasPointerCapture?.(previous.pointerId)) {
        surface!.releasePointerCapture(previous.pointerId);
      }
    }
    function cancel() {
      space = false;
      gestureScale = null;
      endPan();
    }
    function keyDown(event: KeyboardEvent) {
      if (event.code !== 'Space' || event.altKey || event.ctrlKey || event.metaKey
        || within(event.target, `${INPUT}, button, a, [role="menu"]`)) return;
      if (event.target !== document.body && !surface!.contains(event.target as Node)) return;
      space = true;
      consume(event);
    }
    function keyUp(event: KeyboardEvent) {
      if (event.code !== 'Space') return;
      if (space) consume(event);
      space = false;
      if (pan?.space) endPan();
    }
    function pointerDown(event: PointerEvent) {
      if (pan) return;
      suppressClick = false;
      const explicit = event.button === 1 || (event.button === 0 && space);
      if (!explicit && (event.button !== 0 || within(event.target, NATIVE_CONTENT))) return;
      if (event.pointerType === 'touch') return;
      consume(event);
      current.current.start();
      current.current.closeMenu();
      pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        button: event.button, space: event.button === 0 && space };
      suppressClick = true;
      setPanning(true);
      surface!.setPointerCapture?.(event.pointerId);
    }
    function pointerMove(event: PointerEvent) {
      if (!pan || pan.pointerId !== event.pointerId) return;
      consume(event);
      if (!(event.buttons & (pan.button === 1 ? 4 : 1))) { endPan(); return; }
      const delta = surfaceDeltaFromClient(pan, { x: event.clientX, y: event.clientY });
      pan = { ...pan, x: event.clientX, y: event.clientY };
      current.current.pan(delta.x, delta.y);
    }
    function pointerEnd(event: PointerEvent) {
      if (!pan || pan.pointerId !== event.pointerId) return;
      consume(event);
      endPan();
    }
    function click(event: MouseEvent) {
      if (suppressClick && event.detail !== 0) consume(event);
    }
    function contextMenu(event: Event) {
      if (pan) consume(event);
    }
    function wheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey && within(event.target, NATIVE_CONTENT)) return;
      consume(event);
      const size = surfaceSize(surface!);
      if (event.ctrlKey || event.metaKey) {
        current.current.zoom(
          zoomFactorFromWheelDelta(normalizedWheelDelta(event.deltaY, event.deltaMode, size.height)),
          surfacePointFromClient({ x: event.clientX, y: event.clientY }, surface!),
        );
      } else {
        current.current.pan(
          -normalizedWheelDelta(event.deltaX, event.deltaMode, size.width),
          -normalizedWheelDelta(event.deltaY, event.deltaMode, size.height),
        );
      }
    }
    function gesture(event: Event) {
      const input = event as GestureEvent;
      if (!Number.isFinite(input.scale) || input.scale <= 0) return;
      consume(event);
      if (event.type === 'gesturestart') {
        current.current.start();
        gestureScale = input.scale;
        return;
      }
      if (gestureScale !== null) current.current.zoom(input.scale / gestureScale,
        surfacePointFromClient({ x: input.clientX, y: input.clientY }, surface!));
      gestureScale = input.scale;
    }
    function gestureEnd(event: Event) {
      if (gestureScale !== null) consume(event);
      gestureScale = null;
    }
    function visibility() { if (document.hidden) cancel(); }

    const local: [string, EventListener][] = [
      ['wheel', wheel as EventListener], ['pointerdown', pointerDown as EventListener],
      ['lostpointercapture', pointerEnd as EventListener], ['click', click as EventListener],
      ['auxclick', click as EventListener], ['dblclick', click as EventListener], ['contextmenu', contextMenu],
      ['gesturestart', gesture], ['gesturechange', gesture], ['gestureend', gestureEnd],
    ];
    const global: [string, EventListener][] = [
      ['keydown', keyDown as EventListener], ['keyup', keyUp as EventListener],
      ['pointermove', pointerMove as EventListener], ['pointerup', pointerEnd as EventListener],
      ['pointercancel', pointerEnd as EventListener], ['blur', cancel],
    ];
    local.forEach(([name, listener]) => surface.addEventListener(name, listener, { capture: true, passive: false }));
    global.forEach(([name, listener]) => window.addEventListener(name, listener, true));
    document.addEventListener('visibilitychange', visibility);
    return () => {
      local.forEach(([name, listener]) => surface.removeEventListener(name, listener, true));
      global.forEach(([name, listener]) => window.removeEventListener(name, listener, true));
      document.removeEventListener('visibilitychange', visibility);
      cancel();
    };
  }, [surfaceRef]);

  return panning;
}
