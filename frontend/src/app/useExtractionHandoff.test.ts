import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SheetDocument } from '@workbook/core/model';
import { EXTRACTION_HANDOFF_DURATION, useExtractionHandoff } from './useExtractionHandoff';

const source = { id: 'source' } as SheetDocument;
const ids = ['source', 'target'];

describe('extraction handoff ownership', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('retains the source snapshot until the ready target completes its handoff', () => {
    const { result } = renderHook(() => useExtractionHandoff(ids));
    act(() => result.current.begin(source, 'target'));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.handoff).toEqual({ source, targetId: 'target', ready: false });
    act(() => result.current.targetReady('target'));
    act(() => vi.advanceTimersByTime(EXTRACTION_HANDOFF_DURATION - 1));
    expect(result.current.handoff?.source).toBe(source);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.handoff).toBeNull();
  });

  it('ignores stale readiness, cancels superseded timers, and cleans up on unmount', () => {
    const { result, unmount } = renderHook(() => useExtractionHandoff(ids));
    act(() => { result.current.begin(source, 'target'); result.current.targetReady('target'); });
    act(() => result.current.begin(source, 'next'));
    act(() => result.current.targetReady('target'));
    act(() => vi.advanceTimersByTime(EXTRACTION_HANDOFF_DURATION));
    expect(result.current.handoff?.targetId).toBe('next');
    act(() => result.current.cancel());
    expect(result.current.handoff).toBeNull();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up if the ready target disappears or reduced motion is requested', () => {
    const preference = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', () => preference);
    const { result, rerender } = renderHook(({ sheets }) => useExtractionHandoff(sheets), { initialProps: { sheets: ids } });
    act(() => { result.current.begin(source, 'target'); result.current.targetReady('target'); });
    rerender({ sheets: ['source'] });
    expect(result.current.handoff).toBeNull();
    preference.matches = true;
    rerender({ sheets: ids });
    act(() => { result.current.begin(source, 'target'); result.current.targetReady('target'); });
    expect(result.current.handoff).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
