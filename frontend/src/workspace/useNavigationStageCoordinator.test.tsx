import { StrictMode, useLayoutEffect } from 'react';
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { NavigationStages } from './navigationStageCoordinator';
import { useNavigationStageCoordinator } from './useNavigationStageCoordinator';

it('uses current collaborators and cancels promptly when the destination disappears', async () => {
  let finishRestore!: (result: 'settled' | 'cancelled') => void;
  const release = vi.fn();
  const oldMove = vi.fn(() => release);
  const newMove = vi.fn(() => release);
  const stages: NavigationStages = {
    available: () => true,
    presentation: () => ({ mode: 'maximised', sheetId: 'source' }),
    restore: (finish) => { finishRestore = finish; return release; },
    move: oldMove,
    enter: () => release,
    targetReady: () => release,
  };
  const { result, rerender } = renderHook(({ value }) => useNavigationStageCoordinator(value), { initialProps: { value: stages } });
  const operation = result.current.start('target');
  rerender({ value: { ...stages, move: newMove } });
  act(() => finishRestore('settled'));
  expect(oldMove).not.toHaveBeenCalled();
  expect(newMove).toHaveBeenCalledOnce();
  rerender({ value: { ...stages, available: () => false } });
  expect(await operation.completion).toBe('cancelled');
  expect(release).toHaveBeenCalledOnce();
});

it('cancels the active stage on unmount', async () => {
  const release = vi.fn();
  const stages: NavigationStages = {
    available: () => true, presentation: () => ({ mode: 'canvas' }),
    restore: () => release, move: () => release, enter: () => release, targetReady: () => release,
  };
  const { result, unmount } = renderHook(() => useNavigationStageCoordinator(stages));
  const operation = result.current.start('target');
  unmount();
  expect(await operation.completion).toBe('cancelled');
  expect(release).toHaveBeenCalledOnce();
});

it('retains operation-specific movement across a presentation restore', async () => {
  let finishRestore!: (result: 'settled' | 'cancelled') => void;
  const capturedMove = vi.fn((finish: typeof finishRestore) => { finish('settled'); return vi.fn(); });
  const currentMove = vi.fn(() => vi.fn());
  const stages: NavigationStages = {
    available: () => true, presentation: () => ({ mode: 'maximised', sheetId: 'source' }),
    restore: (finish) => { finishRestore = finish; return vi.fn(); }, move: currentMove,
    enter: (_id, finish) => { finish('settled'); return vi.fn(); }, targetReady: () => vi.fn(),
  };
  const { result, rerender } = renderHook(({ value }) => useNavigationStageCoordinator(value), { initialProps: { value: stages } });
  const operation = result.current.start('target', capturedMove);
  rerender({ value: { ...stages, move: vi.fn(() => vi.fn()) } });
  act(() => finishRestore('settled'));
  expect(await operation.completion).toBe('ready');
  expect(capturedMove).toHaveBeenCalledOnce();
  expect(currentMove).not.toHaveBeenCalled();
});

it('rejects reentrant and retained starts after unmount', async () => {
  let successor: ReturnType<ReturnType<typeof useNavigationStageCoordinator>['start']> | undefined;
  let finish!: (result: 'settled' | 'cancelled') => void;
  const move = vi.fn((callback: typeof finish) => {
    finish = callback;
    return () => { successor = start('successor'); };
  });
  const stages: NavigationStages = {
    available: () => true, presentation: () => ({ mode: 'canvas' }),
    restore: () => vi.fn(), move, enter: () => vi.fn(), targetReady: () => vi.fn(),
  };
  const { result, unmount } = renderHook(() => useNavigationStageCoordinator(stages));
  const start = result.current.start;
  const original = start('original');
  unmount();
  finish('settled');
  expect(await original.completion).toBe('cancelled');
  expect(await successor!.completion).toBe('cancelled');
  expect(await start('after').completion).toBe('cancelled');
  expect(move).toHaveBeenCalledOnce();
});

it('activates a fresh lifetime during StrictMode effect replay', async () => {
  const finishes: ((result: 'settled' | 'cancelled') => void)[] = [];
  const operations: ReturnType<ReturnType<typeof useNavigationStageCoordinator>['start']>[] = [];
  const stages: NavigationStages = {
    available: () => true, presentation: () => ({ mode: 'canvas' }),
    restore: () => vi.fn(), move: (finish) => { finishes.push(finish); return vi.fn(); },
    enter: () => vi.fn(), targetReady: () => vi.fn(),
  };
  renderHook(() => {
    const coordinator = useNavigationStageCoordinator(stages);
    useLayoutEffect(() => { operations.push(coordinator.start('target')); }, [coordinator]);
  }, { wrapper: StrictMode });
  expect(operations).toHaveLength(2);
  expect(await operations[0].completion).toBe('cancelled');
  act(() => finishes[0]('settled'));
  act(() => finishes[1]('settled'));
  expect(await operations[1].completion).toBe('ready');
});
