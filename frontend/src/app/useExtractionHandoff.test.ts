import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SheetDocument } from '@workbook/core/model';
import { EXTRACTION_HANDOFF_DURATION, useExtractionHandoff } from './useExtractionHandoff';

const source = { id: 'source' } as SheetDocument;
const ids = ['source', 'target'];

describe('extraction handoff ownership', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('allows absence before acceptance but cancels accepted absence at the first commit', () => {
    const { result } = renderHook(() => useExtractionHandoff(['source']));
    let token = 0;
    act(() => { token = result.current.begin(source, 'target'); });
    expect(result.current.handoff?.accepted).toBe(false);
    act(() => result.current.accepted(token));
    expect(result.current.handoff).toBeNull();
  });

  it('retains accepted present target until readiness and the handoff duration', () => {
    const { result } = renderHook(() => useExtractionHandoff(ids));
    let token = 0;
    act(() => { token = result.current.begin(source, 'target'); result.current.accepted(token); });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.handoff?.source).toBe(source);
    act(() => result.current.targetReady(token));
    act(() => vi.advanceTimersByTime(EXTRACTION_HANDOFF_DURATION - 1));
    expect(result.current.handoff?.source).toBe(source);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.handoff).toBeNull();
  });

  it('ignores old generation callbacks even when target IDs are reused', () => {
    const { result, unmount } = renderHook(() => useExtractionHandoff(ids));
    let old = 0, current = 0;
    act(() => { old = result.current.begin(source, 'target'); result.current.accepted(old); result.current.targetReady(old); });
    act(() => { current = result.current.begin(source, 'target'); });
    act(() => { result.current.accepted(old); result.current.cancel(old); result.current.targetReady(old); });
    act(() => vi.advanceTimersByTime(EXTRACTION_HANDOFF_DURATION));
    expect(result.current.handoff).toMatchObject({ token: current, accepted: false, ready: false });
    act(() => { result.current.accepted(current); result.current.targetReady(current); });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up on removal before or after readiness and honors reduced motion', () => {
    const preference = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', () => preference);
    const { result, rerender } = renderHook(({ sheets }) => useExtractionHandoff(sheets), { initialProps: { sheets: ids } });
    let token = 0;
    act(() => { token = result.current.begin(source, 'target'); result.current.accepted(token); });
    rerender({ sheets: ['source'] });
    expect(result.current.handoff).toBeNull();
    rerender({ sheets: ids });
    act(() => { token = result.current.begin(source, 'target'); result.current.accepted(token); result.current.targetReady(token); });
    rerender({ sheets: ['source'] });
    expect(result.current.handoff).toBeNull();
    preference.matches = true;
    rerender({ sheets: ids });
    act(() => { token = result.current.begin(source, 'target'); result.current.accepted(token); result.current.targetReady(token); });
    expect(result.current.handoff).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
