import { describe, expect, it } from 'vitest';
import { canvasPresentation, restoredViewport } from './maximiseGeometry';
import { cancelMaximise, completeMaximise, enterMaximise, initialMaximiseState, MAXIMISE_TRANSITION_MS, resizeMaximise, sampleMaximise, toggleMaximise, unavailableMaximiseSheet, zoomMaximise } from './maximiseState';

const frame = { position: { x: 100, y: -50 }, size: { width: 400, height: 300 }, visualScale: 2 };
const size = { width: 1000, height: 700 };
const viewport = { x: -30, y: 80, scale: .75 };
const source = canvasPresentation(frame, viewport);
const enter = () => enterMaximise(initialMaximiseState(), 'a', frame, size, source, 0);

describe('maximise geometry', () => {
  it('starts at displayed geometry and ends at the workspace origin without chrome', () => {
    const state = enter();
    const displayed = {
      frame: { left: 45, top: 42.5, width: 600, height: 450 },
      body: { left: 46.5, top: 92, width: 597, height: 399 },
      tableScale: 1.5,
      chrome: 1,
    };
    expect(source).toEqual(displayed);
    expect(sampleMaximise(state, 0)).toEqual(displayed);
    expect(sampleMaximise(state, MAXIMISE_TRANSITION_MS)).toEqual({ frame: { left: 0, top: 0, ...size }, body: { left: 0, top: 0, ...size }, tableScale: 1, chrome: 0 });
    expect(sampleMaximise(state, 150)?.chrome).toBe(.5);
  });

  it('restores the unchanged frame centered at native scale including body offsets', () => {
    const original = structuredClone(frame);
    const target = restoredViewport(frame, size);
    expect(target).toEqual({ x: 250, y: 225, scale: .5 });
    expect(canvasPresentation(frame, target)).toEqual({ frame: { left: 300, top: 200, width: 400, height: 300 }, body: { left: 301, top: 233, width: 398, height: 266 }, tableScale: 1, chrome: 1 });
    const restoring = toggleMaximise(completeMaximise(enter(), 1), 400);
    expect(sampleMaximise(restoring, 700)).toEqual(canvasPresentation(frame, target));
    expect(frame).toEqual(original);
  });
});

describe('maximise transition ownership', () => {
  it('reverses from the current sample and ignores stale completions', () => {
    const entering = enter();
    const before = sampleMaximise(entering, 100);
    const restoring = toggleMaximise(entering, 100);
    expect(sampleMaximise(restoring, 100)).toEqual(before);
    expect(completeMaximise(restoring, entering.identity)).toBe(restoring);
    const reversed = toggleMaximise(restoring, 150);
    expect(sampleMaximise(reversed, 150)).toEqual(sampleMaximise(restoring, 150));
    expect(completeMaximise(reversed, reversed.identity).mode).toBe('maximised');
  });

  it('retargets resize from the sampled position and tracks stable resize', () => {
    const entering = enter();
    const resized = resizeMaximise(entering, { width: 800, height: 600 }, 100);
    expect(sampleMaximise(resized, 100)).toEqual(sampleMaximise(entering, 100));
    expect(sampleMaximise(resized, 400)?.body.width).toBe(800);
    const stable = completeMaximise(resized, resized.identity);
    expect(sampleMaximise(resizeMaximise(stable, size, 500), 500)?.body.width).toBe(1000);
    const restoring = toggleMaximise(stable, 500);
    const retargeted = resizeMaximise(restoring, size, 600);
    expect(sampleMaximise(retargeted, 600)).toEqual(sampleMaximise(restoring, 600));
    expect(sampleMaximise(retargeted, 900)).toEqual(canvasPresentation(frame, restoredViewport(frame, size)));
  });

  it('cancels and invalidates pending callbacks when the sheet disappears', () => {
    const state = enter();
    expect(unavailableMaximiseSheet(state, 'other')).toBe(state);
    const cancelled = unavailableMaximiseSheet(state, 'a');
    expect(cancelled.mode).toBe('canvas');
    expect(completeMaximise(cancelled, state.identity)).toBe(cancelled);
    expect(cancelMaximise(state).identity).toBe(2);
    expect(completeMaximise(toggleMaximise(state, 10), 2).mode).toBe('canvas');
  });

  it('rejects invalid sizes and repeated entry and settles reduced motion immediately', () => {
    const initial = initialMaximiseState();
    expect(enterMaximise(initial, 'a', frame, { width: 0, height: 1 }, source, 0)).toBe(initial);
    const stable = enterMaximise(initial, 'a', frame, size, source, 0, true);
    expect(stable.mode).toBe('maximised');
    expect(enterMaximise(stable, 'a', frame, size, source, 1)).toBe(stable);
    expect(resizeMaximise(stable, { width: NaN, height: 100 }, 1)).toBe(stable);
    expect(toggleMaximise(stable, 1, true).mode).toBe('canvas');
  });

  it('bounds transient zoom and retargets zoom during entry without a jump', () => {
    const state = enter();
    const zoomed = zoomMaximise(state, 1000, 100);
    expect(zoomed.zoom).toBe(8);
    expect(sampleMaximise(zoomed, 100)).toEqual(sampleMaximise(state, 100));
    const stable = completeMaximise(zoomed, zoomed.identity);
    expect(zoomMaximise(stable, 0, 500).zoom).toBe(.1);
    expect(zoomMaximise(stable, NaN, 500)).toBe(stable);
    expect(zoomMaximise(initialMaximiseState(), 2, 0).mode).toBe('canvas');
    expect(frame.visualScale).toBe(2);
  });
});
