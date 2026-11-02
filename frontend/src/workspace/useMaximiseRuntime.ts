import { useLayoutEffect, useRef, useState } from 'react';
import type { SheetFrameSize } from '@workbook/core/model';
import type { WorkspaceViewport } from './workspaceContracts';
import { canvasPresentation, restoredViewport } from './maximiseGeometry';
import type { SavedFrame } from './maximiseGeometry';
import { cancelMaximise, completeMaximise, enterMaximise, initialMaximiseState, MAXIMISE_TRANSITION_MS, resizeMaximise, sampleMaximise, toggleMaximise, unavailableMaximiseSheet, zoomMaximise } from './maximiseState';
import type { MaximiseState } from './maximiseState';

type Handoff = { freezeDisplayedViewport: () => WorkspaceViewport; commitFrozenViewport: (viewport: WorkspaceViewport) => void };
type Result = 'settled' | 'cancelled';

/** Owns one transient sheet presentation; the caller owns editor and input wiring. */
export function useMaximiseRuntime(handoff: Handoff, size: SheetFrameSize | null, reducedMotion: boolean, available: (id: string) => boolean) {
  const [state, setState] = useState(initialMaximiseState);
  const current = useRef(state);
  const frame = useRef<number>();
  const waiters = useRef<Array<(result: Result) => void>>([]);
  const options = useRef({ handoff, size, reducedMotion, available });
  options.current = { handoff, size, reducedMotion, available };
  const [presentation, setPresentation] = useState(() => sampleMaximise(state, performance.now()));

  function release(result: Result) { waiters.current.splice(0).forEach((resolve) => resolve(result)); }
  function publish(next: MaximiseState, now: number) {
    current.current = next;
    setState(next);
    setPresentation(sampleMaximise(next, now));
  }
  function update(next: MaximiseState, now: number, restoreCompleted = false) {
    const previous = current.current;
    if (next === previous) return;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    if (previous.identity !== next.identity) release('cancelled');
    if (restoreCompleted && previous.frame && previous.size) {
      options.current.handoff.commitFrozenViewport(restoredViewport(previous.frame, previous.size));
    }
    publish(next, now);
    if (!next.motion) { release('settled'); return; }
    const identity = next.identity;
    const tick = (time: number) => {
      if (current.current.identity !== identity) return;
      if (time - next.motion!.start >= MAXIMISE_TRANSITION_MS) {
        update(completeMaximise(current.current, identity), time, current.current.mode === 'restoring');
      } else {
        setPresentation(sampleMaximise(current.current, time));
        frame.current = requestAnimationFrame(tick);
      }
    };
    frame.current = requestAnimationFrame(tick);
  }
  function enter(id: string, saved: SavedFrame) {
    const measured = options.current.size;
    if (!measured || !Number.isFinite(measured.width) || !Number.isFinite(measured.height) || measured.width <= 0 || measured.height <= 0 || !options.current.available(id)) return;
    if (current.current.mode !== 'canvas' && current.current.sheetId === id) return;
    const viewport = options.current.handoff.freezeDisplayedViewport();
    const now = performance.now();
    update(enterMaximise(current.current, id, saved, measured, canvasPresentation(saved, viewport), now, options.current.reducedMotion), now);
  }
  function toggle() {
    const now = performance.now();
    const previous = current.current;
    const next = toggleMaximise(previous, now, options.current.reducedMotion);
    update(next, now, previous.mode !== 'restoring' && next.mode === 'canvas');
  }
  function cancel() { update(cancelMaximise(current.current), performance.now()); }
  function zoom(factor: number) { const now = performance.now(); update(zoomMaximise(current.current, factor, now, options.current.reducedMotion), now); }
  function settled(): Promise<Result> {
    if (!current.current.motion) return Promise.resolve('settled');
    return new Promise((resolve) => waiters.current.push(resolve));
  }
  function ensureCanvas(): Promise<Result> {
    if (current.current.mode !== 'canvas' && current.current.mode !== 'restoring') toggle();
    const identity = current.current.identity;
    return settled().then((result) => result === 'settled' && current.current.mode === 'canvas' && current.current.identity === identity ? 'settled' : 'cancelled');
  }
  useLayoutEffect(() => {
    const now = performance.now();
    const existing = current.current;
    if (existing.sheetId && !available(existing.sheetId)) { update(unavailableMaximiseSheet(existing, existing.sheetId), now); return; }
    if (size) {
      const resized = resizeMaximise(existing, size, now, reducedMotion);
      if (existing.mode === 'restoring' && resized.mode === 'canvas' && existing.frame) {
        options.current.handoff.commitFrozenViewport(restoredViewport(existing.frame, size));
      }
      update(resized, now);
    }
    if (reducedMotion && current.current.motion) update(completeMaximise(current.current, current.current.identity), now, current.current.mode === 'restoring');
  });
  useLayoutEffect(() => () => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    current.current = cancelMaximise(current.current);
    release('cancelled');
  }, []);
  return { state, presentation, enter, toggle, cancel, zoom, settled, ensureCanvas };
}
