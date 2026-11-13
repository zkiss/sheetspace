import type { SheetFrameSize } from '@workbook/core/model';
import { zoomScaleBy } from './workspaceGeometry';
import { canvasPresentation, interpolatePresentation, maximisedPresentation, restoredViewport } from './maximiseGeometry';
import type { SavedFrame, SheetPresentation } from './maximiseGeometry';

export const MAXIMISE_TRANSITION_MS = 475;
type Mode = 'canvas' | 'entering' | 'maximised' | 'restoring';
type Motion = { from: SheetPresentation; to: SheetPresentation; start: number };
export type MaximiseState = {
  mode: Mode; identity: number; sheetId?: string; frame?: SavedFrame; size?: SheetFrameSize;
  zoom: number; motion?: Motion;
};

export function initialMaximiseState(): MaximiseState { return { mode: 'canvas', identity: 0, zoom: 1 }; }

function validSize(size: SheetFrameSize | undefined): size is SheetFrameSize {
  return !!size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0;
}

export function sampleMaximise(state: MaximiseState, now: number): SheetPresentation | undefined {
  if (state.motion) return interpolatePresentation(state.motion.from, state.motion.to, (now - state.motion.start) / MAXIMISE_TRANSITION_MS);
  if (state.mode === 'maximised' && state.size) return maximisedPresentation(state.size, state.zoom);
  return undefined;
}

function transition(state: MaximiseState, mode: 'entering' | 'restoring', from: SheetPresentation, now: number, reducedMotion: boolean): MaximiseState {
  const size = state.size!;
  const to = mode === 'entering' ? maximisedPresentation(size, state.zoom) : canvasPresentation(state.frame!, restoredViewport(state.frame!, size));
  const next = { ...state, mode, identity: state.identity + 1, motion: { from, to, start: now } };
  return reducedMotion ? completeMaximise(next, next.identity) : next;
}

/** Start only with a valid measurement and the geometry actually displayed by the caller. */
export function enterMaximise(state: MaximiseState, sheetId: string, frame: SavedFrame, size: SheetFrameSize, displayed: SheetPresentation, now: number, reducedMotion = false): MaximiseState {
  if (!validSize(size)) return state;
  if (state.mode !== 'canvas' && state.sheetId === sheetId) return state;
  return transition({ ...state, sheetId, frame, size: { ...size }, zoom: 1 }, 'entering', displayed, now, reducedMotion);
}

export function toggleMaximise(state: MaximiseState, now: number, reducedMotion = false): MaximiseState {
  const displayed = sampleMaximise(state, now);
  if (!displayed || !state.frame || !state.size) return state;
  return transition(state, state.mode === 'restoring' ? 'entering' : 'restoring', displayed, now, reducedMotion);
}

/** Invalid measurements retain the last valid surface size, including while animating. */
export function resizeMaximise(state: MaximiseState, size: SheetFrameSize, now: number, reducedMotion = false): MaximiseState {
  if (!validSize(size) || !state.size || (size.width === state.size.width && size.height === state.size.height)) return state;
  const displayed = sampleMaximise(state, now);
  if (!displayed) return state;
  const next = { ...state, size: { ...size } };
  if (state.mode === 'maximised') return next;
  return transition(next, state.mode as 'entering' | 'restoring', displayed, now, reducedMotion);
}

/** Saved edits change the restore destination, never the maximised working view. */
export function reconcileMaximiseFrame(state: MaximiseState, frame: SavedFrame, now: number): MaximiseState {
  const previous = state.frame;
  if (!previous || (previous.position.x === frame.position.x && previous.position.y === frame.position.y
    && previous.size.width === frame.size.width && previous.size.height === frame.size.height && previous.visualScale === frame.visualScale)) return state;
  const next = { ...state, frame };
  return state.mode === 'restoring' ? transition(next, 'restoring', sampleMaximise(state, now)!, now, false) : next;
}

/** Grid zoom uses the same finite 0.1–8 policy as workspace zoom, but is never persisted. */
export function zoomMaximise(state: MaximiseState, factor: number, now: number, reducedMotion = false): MaximiseState {
  if (state.mode !== 'maximised' && state.mode !== 'entering') return state;
  const zoom = zoomScaleBy(state.zoom, factor);
  if (zoom === state.zoom) return state;
  const displayed = sampleMaximise(state, now)!;
  const next = { ...state, zoom };
  return state.mode === 'entering' ? transition(next, 'entering', displayed, now, reducedMotion) : next;
}

/** Completion is an explicit owner callback; old callbacks cannot finish newer motion. */
export function completeMaximise(state: MaximiseState, identity: number): MaximiseState {
  if (identity !== state.identity || !state.motion) return state;
  if (state.mode === 'restoring') return { mode: 'canvas', identity: state.identity, zoom: 1 };
  return { ...state, mode: 'maximised', motion: undefined };
}

export function cancelMaximise(state: MaximiseState): MaximiseState {
  return { mode: 'canvas', identity: state.identity + 1, zoom: 1 };
}

export function unavailableMaximiseSheet(state: MaximiseState, sheetId: string): MaximiseState {
  return state.sheetId === sheetId ? cancelMaximise(state) : state;
}
