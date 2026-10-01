import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { WorkspacePosition } from '@workbook/core/model';
import { normalizedWheelDelta, surfaceDeltaFromClient, surfacePointFromClient, surfaceSize, zoomFactorFromWheelDelta } from './workspaceGeometry';
import { isBackgroundTarget, isNativeControlTarget, isOwnedPortalTarget } from './workspaceEventPolicy';

const SYNTHETIC_PINCH_DELTA_LIMIT = 20;
const SYNTHETIC_PINCH_ZOOM_SENSITIVITY = 8;

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
    clearSelection: () => void;
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
      if (!event.defaultPrevented && event.key === 'Escape' && (pan || space || gestureScale !== null)) {
        consume(event);
        cancel();
        return;
      }
      if (event.defaultPrevented || event.code !== 'Space' || event.altKey || event.ctrlKey || event.metaKey
        || isNativeControlTarget(event.target)) return;
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
      if (event.defaultPrevented || pan) return;
      suppressClick = false;
      const explicit = event.button === 1 || (event.button === 0 && space);
      if (!explicit && (event.button !== 0 || !isBackgroundTarget(event.target, surface!))) return;
      if (event.pointerType === 'touch') return;
      consume(event);
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      current.current.clearSelection();
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
      if (event.defaultPrevented) return;
      if (!event.ctrlKey && !event.metaKey && !isBackgroundTarget(event.target, surface!)) return;
      consume(event);
      const size = surfaceSize(surface!);
      if (event.ctrlKey || event.metaKey) {
        const delta = normalizedWheelDelta(event.deltaY, event.deltaMode, size.height);
        current.current.zoom(
          zoomFactorFromWheelDelta(event.deltaMode === WheelEvent.DOM_DELTA_PIXEL && Math.abs(delta) < SYNTHETIC_PINCH_DELTA_LIMIT
            ? delta * SYNTHETIC_PINCH_ZOOM_SENSITIVITY
            : delta),
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
      if (event.defaultPrevented) return;
      const input = event as GestureEvent;
      if (!Number.isFinite(input.scale) || input.scale <= 0) return;
      if (event.type !== 'gesturestart' && gestureScale === null) return;
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
      if (event.defaultPrevented) return;
      if (gestureScale !== null) consume(event);
      gestureScale = null;
    }
    function visibility() { if (document.hidden) cancel(); }
    function ownedPortalListener(listener: EventListener): EventListener {
      return (event) => { if (isOwnedPortalTarget(event.target, surface!)) listener(event); };
    }

    const local: [string, EventListener][] = [
      ['wheel', wheel as EventListener], ['pointerdown', pointerDown as EventListener],
      ['lostpointercapture', pointerEnd as EventListener], ['click', click as EventListener],
      ['auxclick', click as EventListener], ['dblclick', click as EventListener], ['contextmenu', contextMenu],
      ['gesturestart', gesture], ['gesturechange', gesture], ['gestureend', gestureEnd],
    ];
    const global: [string, EventListener][] = [
      ['keydown', keyDown as EventListener], ['keyup', keyUp as EventListener],
      ['pointermove', pointerMove as EventListener], ['pointerup', pointerEnd as EventListener],
      ['pointercancel', pointerEnd as EventListener],
      ['pointerdown', ownedPortalListener(pointerDown as EventListener)],
      ['wheel', ownedPortalListener(wheel as EventListener)],
      ['gesturestart', ownedPortalListener(gesture)], ['gesturechange', ownedPortalListener(gesture)],
      ['gestureend', ownedPortalListener(gestureEnd)],
      ['contextmenu', ownedPortalListener(contextMenu)], ['click', ownedPortalListener(click as EventListener)],
      ['auxclick', ownedPortalListener(click as EventListener)], ['dblclick', ownedPortalListener(click as EventListener)],
    ];
    local.forEach(([name, listener]) => surface.addEventListener(name, listener, { capture: true, passive: false }));
    global.forEach(([name, listener]) => window.addEventListener(name, listener, { capture: true, passive: false }));
    // Element blur does not bubble: only window focus loss should cancel ownership.
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      local.forEach(([name, listener]) => surface.removeEventListener(name, listener, true));
      global.forEach(([name, listener]) => window.removeEventListener(name, listener, true));
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', visibility);
      cancel();
    };
  }, [surfaceRef]);

  return panning;
}
