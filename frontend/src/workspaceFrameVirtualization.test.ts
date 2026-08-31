import { describe, expect, it } from 'vitest';
import { mountedWorkspaceFrameIds, workspaceFramePinIds } from './workspaceFrameVirtualization';

const frames = [
  { id: 'visible', name: 'Visible', position: { x: 40, y: 40 }, size: { width: 240, height: 160 }, zIndex: 2 },
  { id: 'offscreen', name: 'Offscreen', position: { x: 1800, y: 1200 }, size: { width: 240, height: 160 }, zIndex: 5 },
];

describe('workspaceFrameVirtualization', () => {
  it('keeps pin reasons explicit and deduplicates sheets pinned for multiple reasons', () => {
    expect([...workspaceFramePinIds({
      editingSheetId: 'offscreen',
      interactionSheetId: 'offscreen',
      navigationRevealSheetId: 'navigation',
      pendingFocusSheetId: null,
    })]).toEqual(['offscreen', 'navigation']);
  });

  it('culls by measured transformed viewport while retaining every explicit pin category', () => {
    const base = {
      frames,
      surfaceSize: { width: 800, height: 600 },
      viewport: { scale: 1, x: 0, y: 0 },
    };

    expect([...mountedWorkspaceFrameIds({ ...base, pins: {} })]).toEqual(['visible']);
    for (const pin of [
      { editingSheetId: 'offscreen' },
      { interactionSheetId: 'offscreen' },
      { navigationRevealSheetId: 'offscreen' },
      { pendingFocusSheetId: 'offscreen' },
    ]) {
      expect([...mountedWorkspaceFrameIds({ ...base, pins: pin })])
        .toEqual(['visible', 'offscreen']);
    }

    expect([...mountedWorkspaceFrameIds({
      ...base,
      pins: {},
      viewport: { scale: 1, x: -1200, y: -800 },
    })]).toEqual(['offscreen']);
  });

  it('mounts only explicit pins before measurement and while the surface is zero-sized', () => {
    for (const surfaceSize of [null, { width: 0, height: 600 }, { width: 800, height: 0 }]) {
      expect([...mountedWorkspaceFrameIds({
        frames,
        pins: { pendingFocusSheetId: 'offscreen' },
        surfaceSize,
        viewport: { scale: 1, x: 0, y: 0 },
      })]).toEqual(['offscreen']);
    }
  });
});
