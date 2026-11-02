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
