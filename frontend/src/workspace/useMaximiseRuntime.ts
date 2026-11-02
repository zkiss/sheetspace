import { useLayoutEffect, useRef, useState } from 'react';
import type { SheetFrameSize } from '@workbook/core/model';
import type { WorkspaceViewport } from './workspaceContracts';
import { canvasPresentation, restoredViewport } from './maximiseGeometry';
import type { SavedFrame } from './maximiseGeometry';
import { cancelMaximise, completeMaximise, enterMaximise, initialMaximiseState, MAXIMISE_TRANSITION_MS, resizeMaximise, sampleMaximise, toggleMaximise, unavailableMaximiseSheet, zoomMaximise } from './maximiseState';
import type { MaximiseState } from './maximiseState';

type Handoff = {
  freezeDisplayedViewport: (programmatic?: boolean) => WorkspaceViewport;
  freezeDisplayedViewportOwned?: (programmatic?: boolean) => { viewport: WorkspaceViewport; owned: boolean };
  commitFrozenViewport: (viewport: WorkspaceViewport) => boolean | void;
};
type Result = 'settled' | 'cancelled';

/** Owns one transient sheet presentation; the caller owns editor and input wiring. */
export function useMaximiseRuntime(handoff: Handoff, size: SheetFrameSize | null, reducedMotion: boolean, available: (id: string) => boolean) {
  const [state, setState] = useState(initialMaximiseState);
  const current = useRef(state);
  const frame = useRef<number>();
  const waiters = useRef<Array<(result: Result) => void>>([]);
  const canvasWaiters = useRef<Array<(result: Result) => void>>([]);
  const targetWaiters = useRef<Array<(result: Result) => void>>([]);
  const targetOwnership = useRef(0);
  const ownership = useRef(0);
  const transaction = useRef(0);
  const presentationOwner = useRef(0);
  const failedHandoff = useRef(0);
  const options = useRef({ handoff, size, reducedMotion, available });
  options.current = { handoff, size, reducedMotion, available };
  const [presentation, setPresentation] = useState(() => sampleMaximise(state, performance.now()));

  function release(result: Result) { waiters.current.splice(0).forEach((resolve) => resolve(result)); }
  function releaseCanvas(result: Result) { canvasWaiters.current.splice(0).forEach((resolve) => resolve(result)); }
  function releaseTarget(result: Result) { targetWaiters.current.splice(0).forEach((resolve) => resolve(result)); }
  function publish(next: MaximiseState, now: number) {
    current.current = next;
    setState(next);
    setPresentation(sampleMaximise(next, now));
  }
  function update(next: MaximiseState, now: number, restoreCompleted = false, retargetRestore = false, retargetEntry = false, restoreSize?: SheetFrameSize) {
    const owner = ++transaction.current;
    const previous = current.current;
    if (next === previous) return;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    if (previous.identity !== next.identity) {
      release('cancelled');
      if (!retargetRestore) { ownership.current++; releaseCanvas('cancelled'); }
      if (!retargetEntry) { targetOwnership.current++; releaseTarget('cancelled'); }
    }
    if (restoreCompleted && previous.frame && previous.size) {
      const owned = options.current.handoff.commitFrozenViewport(restoredViewport(previous.frame, restoreSize ?? previous.size));
      if (owner !== transaction.current) return;
      if (owned === false) {
        failedHandoff.current++;
        ownership.current++;
        targetOwnership.current++;
        publish(cancelMaximise(previous), now);
        release('cancelled');
        releaseCanvas('cancelled');
        releaseTarget('cancelled');
        return;
      }
    }
    publish(next, now);
    if (!next.motion) { release('settled'); releaseCanvas(next.mode === 'canvas' ? 'settled' : 'cancelled'); releaseTarget(next.mode === 'maximised' ? 'settled' : 'cancelled'); return; }
    const identity = next.identity;
    const tick = (time: number) => {
      if (current.current.identity !== identity) return;
      if (time - next.motion!.start >= MAXIMISE_TRANSITION_MS) {
        update(completeMaximise(current.current, identity), time, current.current.mode === 'restoring', false, current.current.mode === 'entering');
      } else {
        setPresentation(sampleMaximise(current.current, time));
        frame.current = requestAnimationFrame(tick);
      }
    };
    frame.current = requestAnimationFrame(tick);
  }
  function enter(id: string, saved: SavedFrame, displayed: SavedFrame = saved, programmatic = false) {
    presentationOwner.current++;
    const measured = options.current.size;
    if (!measured || !Number.isFinite(measured.width) || !Number.isFinite(measured.height) || measured.width <= 0 || measured.height <= 0 || !options.current.available(id)) return;
    if (current.current.mode !== 'canvas' && current.current.sheetId === id) return;
    const owner = ++transaction.current;
    const handoff = options.current.handoff;
    const frozen = handoff.freezeDisplayedViewportOwned?.(programmatic);
    const viewport = frozen?.viewport ?? (programmatic ? handoff.freezeDisplayedViewport(true) : handoff.freezeDisplayedViewport());
    if (owner !== transaction.current || frozen?.owned === false || !options.current.available(id)) return;
    const now = performance.now();
    update(enterMaximise(current.current, id, saved, measured, canvasPresentation(displayed, viewport), now, options.current.reducedMotion), now);
  }
  function toggle() {
    presentationOwner.current++;
    const now = performance.now();
    const previous = current.current;
    const next = toggleMaximise(previous, now, options.current.reducedMotion);
    update(next, now, previous.mode !== 'restoring' && next.mode === 'canvas');
  }
  function cancel() { presentationOwner.current++; update(cancelMaximise(current.current), performance.now()); }
  function adoptPresentation() {
    const owner = ++presentationOwner.current;
    return () => presentationOwner.current === owner;
  }
  function claimPresentation() {
    const owner = ++presentationOwner.current;
    return () => { if (presentationOwner.current === owner && current.current.motion) cancel(); };
  }
  function zoom(factor: number) { const now = performance.now(); update(zoomMaximise(current.current, factor, now, options.current.reducedMotion), now); }
  function settled(): Promise<Result> {
    if (!current.current.motion) return Promise.resolve('settled');
    return new Promise((resolve) => waiters.current.push(resolve));
  }
  function ensureCanvas(): Promise<Result> {
    const handoffGeneration = failedHandoff.current;
    if (current.current.mode !== 'canvas' && current.current.mode !== 'restoring') toggle();
    const generation = ownership.current;
    const completion: Promise<Result> = current.current.motion
      ? new Promise((resolve) => canvasWaiters.current.push(resolve))
      : Promise.resolve('settled');
    return completion.then((result) => result === 'settled' && current.current.mode === 'canvas' && ownership.current === generation && failedHandoff.current === handoffGeneration ? 'settled' : 'cancelled');
  }
  function ensureMaximised(id: string): Promise<Result> {
    const generation = targetOwnership.current;
    const completion: Promise<Result> = current.current.mode === 'entering' && current.current.sheetId === id
      ? new Promise((resolve) => targetWaiters.current.push(resolve))
      : Promise.resolve('settled');
    return completion.then((result) => result === 'settled' && targetOwnership.current === generation
      && current.current.mode === 'maximised' && current.current.sheetId === id && options.current.available(id) ? 'settled' : 'cancelled');
  }
  function restoreToCanvas(): Promise<Result> {
    presentationOwner.current++;
    return ensureCanvas();
  }
  useLayoutEffect(() => {
    const now = performance.now();
    const existing = current.current;
    if (existing.sheetId && !available(existing.sheetId)) { update(unavailableMaximiseSheet(existing, existing.sheetId), now); return; }
    if (size) {
      const resized = resizeMaximise(existing, size, now, reducedMotion);
      update(resized, now, existing.mode === 'restoring' && resized.mode === 'canvas', existing.mode === 'restoring', existing.mode === 'entering', size);
    }
    if (reducedMotion && current.current.motion) update(completeMaximise(current.current, current.current.identity), now, current.current.mode === 'restoring', false, current.current.mode === 'entering');
  });
  useLayoutEffect(() => () => {
    presentationOwner.current++;
    transaction.current++;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    current.current = cancelMaximise(current.current);
    ownership.current++;
    targetOwnership.current++;
    release('cancelled');
    releaseCanvas('cancelled');
    releaseTarget('cancelled');
  }, []);
  return { state, presentation, enter, toggle, cancel, claimPresentation, adoptPresentation, zoom, settled, ensureCanvas, ensureMaximised, restoreToCanvas, currentState: () => current.current };
}
