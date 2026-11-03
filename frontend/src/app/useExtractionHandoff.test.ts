import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SheetDocument } from '@workbook/core/model';
import { EXTRACTION_HANDOFF_DURATION, useExtractionHandoff } from './useExtractionHandoff';

const source = { id: 'source' } as SheetDocument;
const ids = ['source', 'target'];
function useTestHandoff(sheets: readonly string[]) {
  const owner = useExtractionHandoff(sheets);
  return { ...owner, begin: (document: SheetDocument, target: string) => {
    const token = owner.begin(document, target);
    owner.registerCoverage(token, () => 'covered');
    return token;
  } };
}

describe('extraction handoff ownership', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('allows absence before acceptance but cancels accepted absence at the first commit', () => {
    const { result } = renderHook(() => useTestHandoff(['source']));
    let token = 0;
    act(() => { token = result.current.begin(source, 'target'); });
    expect(result.current.handoff?.accepted).toBe(false);
    act(() => result.current.accepted(token));
    expect(result.current.handoff).toBeNull();
  });

  it('retains accepted present target until readiness and the handoff duration', () => {
    const { result } = renderHook(() => useTestHandoff(ids));
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
    const { result, unmount } = renderHook(() => useTestHandoff(ids));
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

  it('restarts the handoff deadline when painted coverage is lost and restored', () => {
    const { result } = renderHook(() => useTestHandoff(ids));
    let token = 0;
    act(() => { token = result.current.begin(source, 'target'); result.current.accepted(token); result.current.targetReady(token); });
    act(() => vi.advanceTimersByTime(EXTRACTION_HANDOFF_DURATION - 1));
    act(() => result.current.targetNotReady(token));
    act(() => vi.advanceTimersByTime(EXTRACTION_HANDOFF_DURATION));
    expect(result.current.handoff?.ready).toBe(false);
    act(() => result.current.targetReady(token));
    act(() => vi.advanceTimersByTime(EXTRACTION_HANDOFF_DURATION - 1));
    expect(result.current.handoff?.ready).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.handoff).toBeNull();
  });

  it('cleans up on removal before or after readiness and honors reduced motion', () => {
    const preference = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', () => preference);
    const { result, rerender } = renderHook(({ sheets }) => useTestHandoff(sheets), { initialProps: { sheets: ids } });
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

  it('finishes an active fade when reduced motion is enabled and removes its listener', () => {
    let listener: (() => void) | undefined;
    const preference = {
      matches: false,
      addEventListener: vi.fn((_event: string, callback: () => void) => { listener = callback; }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', () => preference);
    const { result } = renderHook(() => useTestHandoff(ids));
    act(() => {
      const token = result.current.begin(source, 'target');
      result.current.accepted(token);
      result.current.targetReady(token);
    });
    expect(result.current.handoff?.ready).toBe(true);
    preference.matches = true;
    act(() => listener?.());
    expect(result.current.handoff).toBeNull();
    expect(preference.removeEventListener).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['waiting', 'unknown'] as const)('retains ownership when retirement measures %s and restarts on coverage', (coverage) => {
    const { result } = renderHook(() => useExtractionHandoff(ids));
    let token = 0;
    act(() => {
      token = result.current.begin(source, 'target');
      result.current.registerCoverage(token, () => coverage);
      result.current.accepted(token);
      result.current.targetReady(token);
    });
    act(() => vi.advanceTimersByTime(EXTRACTION_HANDOFF_DURATION));
    expect(result.current.handoff?.ready).toBe(false);
    act(() => { result.current.registerCoverage(token, () => 'covered'); result.current.targetReady(token); });
    act(() => vi.advanceTimersByTime(EXTRACTION_HANDOFF_DURATION - 1));
    expect(result.current.handoff?.ready).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.handoff).toBeNull();
  });

  it('allows a known-empty measurement to retire nonvisually', () => {
    const { result } = renderHook(() => useExtractionHandoff(ids));
    act(() => {
      const token = result.current.begin(source, 'target');
      result.current.registerCoverage(token, () => 'empty');
      result.current.accepted(token); result.current.targetReady(token);
    });
    act(() => vi.advanceTimersByTime(EXTRACTION_HANDOFF_DURATION));
    expect(result.current.handoff).toBeNull();
  });

  it('does not retire when the current validator is detached', () => {
    const { result } = renderHook(() => useExtractionHandoff(ids));
    act(() => {
      const token = result.current.begin(source, 'target');
      const unregister = result.current.registerCoverage(token, () => 'covered');
      unregister();
      result.current.accepted(token); result.current.targetReady(token);
    });
    act(() => vi.advanceTimersByTime(EXTRACTION_HANDOFF_DURATION));
    expect(result.current.handoff?.ready).toBe(false);
  });

  it('ignores validator registration from a superseded operation', () => {
    const { result } = renderHook(() => useExtractionHandoff(ids));
    act(() => {
      const old = result.current.begin(source, 'target');
      const token = result.current.begin(source, 'target');
      result.current.registerCoverage(token, () => 'covered');
      result.current.registerCoverage(old, () => 'waiting');
      result.current.accepted(token); result.current.targetReady(token);
    });
    act(() => vi.advanceTimersByTime(EXTRACTION_HANDOFF_DURATION));
    expect(result.current.handoff).toBeNull();
  });

  it('revalidates reduced motion and does not let old registration cleanup remove the new one', () => {
    const preference = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', () => preference);
    const { result } = renderHook(() => useExtractionHandoff(ids));
    let token = 0;
    act(() => {
      token = result.current.begin(source, 'target');
      const cleanup = result.current.registerCoverage(token, () => 'covered');
      result.current.registerCoverage(token, () => 'waiting');
      cleanup();
      result.current.accepted(token); result.current.targetReady(token);
    });
    expect(result.current.handoff?.ready).toBe(false);
    act(() => { result.current.registerCoverage(token, () => 'covered'); result.current.targetReady(token); });
    expect(result.current.handoff).toBeNull();
  });

  it('revalidates before retiring on a preference change', () => {
    let listener: (() => void) | undefined;
    const preference = { matches: false, addEventListener: (_: string, fn: () => void) => { listener = fn; }, removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', () => preference);
    const { result } = renderHook(() => useExtractionHandoff(ids));
    let coverage: 'covered' | 'waiting' = 'covered';
    act(() => {
      const token = result.current.begin(source, 'target');
      result.current.registerCoverage(token, () => coverage);
      result.current.accepted(token); result.current.targetReady(token);
    });
    coverage = 'waiting'; preference.matches = true;
    act(() => listener?.());
    expect(result.current.handoff?.ready).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
