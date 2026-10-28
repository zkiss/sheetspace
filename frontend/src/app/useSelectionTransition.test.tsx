import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSelectionTransition } from './useSelectionTransition';
import { mountedWorkspaceFrameIds } from '@workspace/workspaceFrameVirtualization';

const cell = (sheetId: string, rowId = 'row') => ({ sheetId, cell: { rowId, columnId: 'column' } });

describe('selection transition', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('ends an active transition when reduced motion is enabled and resumes transitions when disabled', () => {
    let onChange = () => {};
    const preference = {
      matches: false,
      addEventListener: vi.fn((_event: string, listener: () => void) => { onChange = listener; }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', vi.fn(() => preference));
    const { result, rerender, unmount } = renderHook(({ active }) => useSelectionTransition(active), {
      initialProps: { active: cell('source') },
    });
    rerender({ active: cell('middle') });
    expect(result.current?.from.sheetId).toBe('source');
    preference.matches = true;
    act(() => onChange());
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    rerender({ active: cell('destination') });
    expect(result.current).toBeNull();
    preference.matches = false;
    act(() => onChange());
    rerender({ active: cell('next') });
    expect(result.current?.from.sheetId).toBe('destination');
    unmount();
    expect(preference.removeEventListener).toHaveBeenCalled();
  });

  it('only transitions between sheets and retains the source until expiry', () => {
    const source = cell('source');
    const sameSheet = cell('source', 'other');
    const destination = cell('destination');
    const { result, rerender } = renderHook(({ active }) => useSelectionTransition(active), {
      initialProps: { active: source },
    });

    rerender({ active: sameSheet });
    expect(result.current).toBeNull();
    rerender({ active: destination });
    expect(result.current).toEqual({ from: sameSheet, to: destination, id: 1 });
    act(() => vi.advanceTimersByTime(399));
    expect(result.current?.from).toEqual(sameSheet);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBeNull();
  });

  it('replaces a rapid transition and cancels its old expiry and unmount timer', () => {
    const source = cell('source');
    const middle = cell('middle');
    const destination = cell('destination');
    const { result, rerender, unmount } = renderHook(({ active }) => useSelectionTransition(active), {
      initialProps: { active: source },
    });

    rerender({ active: middle });
    act(() => vi.advanceTimersByTime(300));
    rerender({ active: destination });
    expect(result.current).toEqual({ from: middle, to: destination, id: 2 });
    act(() => vi.advanceTimersByTime(100));
    expect(result.current?.to).toEqual(destination);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pins the outgoing offscreen frame only for the current transition', () => {
    const source = cell('source');
    const middle = cell('middle');
    const destination = cell('destination');
    const frames = ['source', 'middle', 'destination'].map((id, index) => ({
      id, name: id, position: { x: index * 3000, y: 0 }, size: { width: 240, height: 160 }, visualScale: 1, zIndex: index,
    }));
    const { result, rerender } = renderHook(({ active }) => useSelectionTransition(active), {
      initialProps: { active: source },
    });
    const mounted = (x: number) => [...mountedWorkspaceFrameIds({
      frames, surfaceSize: { width: 800, height: 600 }, viewport: { x, y: 0, scale: 1 },
      pins: { historySheetIds: result.current ? [result.current.from.sheetId] : [] },
    })];

    rerender({ active: middle });
    expect(mounted(-3000)).toEqual(['source', 'middle']);
    act(() => vi.advanceTimersByTime(300));
    rerender({ active: destination });
    expect(mounted(-6000)).toEqual(['middle', 'destination']);
    act(() => vi.advanceTimersByTime(100));
    expect(mounted(-6000)).toEqual(['middle', 'destination']);
    act(() => vi.advanceTimersByTime(300));
    expect(mounted(-6000)).toEqual(['destination']);
  });
});
