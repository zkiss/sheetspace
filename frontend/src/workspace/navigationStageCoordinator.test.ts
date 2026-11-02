import { expect, it, vi } from 'vitest';
import { createNavigationStageCoordinator } from './navigationStageCoordinator';
import type { NavigationStages } from './navigationStageCoordinator';

it('orders restore, flyover and target entry before reporting readiness', async () => {
  const callbacks: Array<(result: 'settled' | 'cancelled') => void> = [];
  const calls: string[] = [];
  const stage = (name: string) => (finish: (result: 'settled' | 'cancelled') => void) => { calls.push(name); callbacks.push(finish); return vi.fn(); };
  const stages: NavigationStages = { available: () => true, presentation: () => ({ mode: 'maximised', sheetId: 'source' }), restore: stage('restore'), move: stage('move'), enter: (_, finish) => stage('enter')(finish), targetReady: (_, finish) => stage('ready')(finish) };
  const operation = createNavigationStageCoordinator().start('empty-target', stages);
  expect(calls).toEqual(['restore']);
  callbacks[0]('settled'); callbacks[1]('settled');
  expect(calls).toEqual(['restore', 'move', 'enter']);
  callbacks[2]('settled');
  expect(await operation.completion).toBe('ready');
});

it('cancels an old owner and ignores stale callbacks and removed destinations', async () => {
  const callbacks: Array<(result: 'settled' | 'cancelled') => void> = [];
  const release = vi.fn();
  let available = true;
  const stages: NavigationStages = { available: () => available, presentation: () => ({ mode: 'canvas' }), restore: () => release, move: (finish) => { callbacks.push(finish); return release; }, enter: () => release, targetReady: () => release };
  const coordinator = createNavigationStageCoordinator();
  const old = coordinator.start('a', stages);
  const next = coordinator.start('b', stages);
  expect(await old.completion).toBe('cancelled');
  callbacks[0]('settled');
  available = false;
  callbacks[1]('settled');
  expect(await next.completion).toBe('cancelled');
  expect(release).toHaveBeenCalledOnce();
});

it('handles synchronous settlement and same-sheet bypass', async () => {
  const move = vi.fn(() => vi.fn());
  const stages: NavigationStages = { available: () => true, presentation: () => ({ mode: 'entering', sheetId: 'a' }), restore: move, move, enter: move, targetReady: (_, finish) => { finish('settled'); return vi.fn(); } };
  const operation = createNavigationStageCoordinator().start('a', stages);
  expect(await operation.completion).toBe('ready');
  expect(move).not.toHaveBeenCalled();
});

it('does not replace a newer request started reentrantly by a cancelled stage', async () => {
  const coordinator = createNavigationStageCoordinator();
  let replacement: ReturnType<typeof coordinator.start> | undefined;
  const callbacks: Array<(result: 'settled' | 'cancelled') => void> = [];
  const stages: NavigationStages = {
    available: () => true,
    presentation: () => ({ mode: 'canvas' }),
    restore: () => vi.fn(),
    move: (finish) => {
      callbacks.push(finish);
      return () => { replacement = coordinator.start('newest', stages); };
    },
    enter: () => vi.fn(),
    targetReady: () => vi.fn(),
  };
  const first = coordinator.start('first', stages);
  const interrupted = coordinator.start('second', stages);
  expect(await first.completion).toBe('cancelled');
  expect(await interrupted.completion).toBe('cancelled');
  callbacks[1]('settled');
  expect(await replacement!.completion).toBe('ready');
});

it('releases a stage returned after reentrant cancellation', async () => {
  const coordinator = createNavigationStageCoordinator();
  const release = vi.fn();
  const stages: NavigationStages = {
    available: () => true,
    presentation: () => ({ mode: 'canvas' }),
    restore: () => vi.fn(),
    move: () => { coordinator.cancel(); return release; },
    enter: () => vi.fn(),
    targetReady: () => vi.fn(),
  };
  const operation = coordinator.start('target', stages);
  expect(await operation.completion).toBe('cancelled');
  expect(release).toHaveBeenCalledOnce();
});

it('never enters a destination removed while the flyover is underway', async () => {
  let available = true;
  let completeMove!: (result: 'settled' | 'cancelled') => void;
  const enter = vi.fn(() => vi.fn());
  const stages: NavigationStages = {
    available: () => available,
    presentation: () => ({ mode: 'maximised', sheetId: 'source' }),
    restore: (finish) => { finish('settled'); return vi.fn(); },
    move: (finish) => { completeMove = finish; return vi.fn(); },
    enter,
    targetReady: () => vi.fn(),
  };
  const operation = createNavigationStageCoordinator().start('target', stages);
  available = false;
  completeMove('settled');
  expect(await operation.completion).toBe('cancelled');
  expect(enter).not.toHaveBeenCalled();
});

it.each([0, 1, 2])('cancels and ignores stale completion at stage %i', async (interruptedStage) => {
  const callbacks: Array<(result: 'settled' | 'cancelled') => void> = [];
  const releases = [vi.fn(), vi.fn(), vi.fn()];
  const stage = (index: number) => (finish: (result: 'settled' | 'cancelled') => void) => {
    callbacks[index] = finish;
    return releases[index];
  };
  const stages: NavigationStages = {
    available: () => true,
    presentation: () => ({ mode: 'maximised', sheetId: 'source' }),
    restore: stage(0), move: stage(1), enter: (_, finish) => stage(2)(finish), targetReady: () => vi.fn(),
  };
  const operation = createNavigationStageCoordinator().start('target', stages);
  for (let index = 0; index < interruptedStage; index++) callbacks[index]('settled');
  operation.cancel();
  callbacks[interruptedStage]('settled');
  expect(await operation.completion).toBe('cancelled');
  expect(releases[interruptedStage]).toHaveBeenCalledOnce();
  expect(callbacks[interruptedStage + 1]).toBeUndefined();
});

it('retains the next stage disposer when the preceding stage settles inline', async () => {
  const release = vi.fn();
  const stages: NavigationStages = {
    available: () => true,
    presentation: () => ({ mode: 'restoring', sheetId: 'source' }),
    restore: (finish) => { finish('settled'); return vi.fn(); },
    move: () => release,
    enter: () => vi.fn(), targetReady: () => vi.fn(),
  };
  const operation = createNavigationStageCoordinator().start('target', stages);
  operation.cancel();
  expect(await operation.completion).toBe('cancelled');
  expect(release).toHaveBeenCalledOnce();
});

it.each([0, 1, 2])('retires a replaced operation at stage %i', async (index) => {
  const callbacks: Array<(result: 'settled' | 'cancelled') => void> = [];
  const releases = [vi.fn(), vi.fn(), vi.fn()];
  const stage = (i: number) => (finish: (result: 'settled' | 'cancelled') => void) => { callbacks[i] = finish; return releases[i]; };
  const stages: NavigationStages = {
    available: () => true, presentation: () => ({ mode: 'maximised', sheetId: 'source' }),
    restore: stage(0), move: stage(1), enter: (_, finish) => stage(2)(finish), targetReady: () => vi.fn(),
  };
  const coordinator = createNavigationStageCoordinator();
  const old = coordinator.start('old', stages);
  for (let i = 0; i < index; i++) callbacks[i]('settled');
  const stale = callbacks[index];
  const next = coordinator.start('next', { ...stages, presentation: () => ({ mode: 'canvas' }), move: (finish) => { finish('settled'); return vi.fn(); } });
  stale('settled');
  expect(await old.completion).toBe('cancelled');
  expect(await next.completion).toBe('ready');
  expect(releases[index]).toHaveBeenCalledOnce();
});

it.each([0, 1, 2])('reconciles destination removal at stage %i', async (index) => {
  let available = true;
  const callbacks: Array<(result: 'settled' | 'cancelled') => void> = [];
  const stage = (i: number) => (finish: (result: 'settled' | 'cancelled') => void) => { callbacks[i] = finish; return vi.fn(); };
  const stages: NavigationStages = {
    available: () => available, presentation: () => ({ mode: 'maximised', sheetId: 'source' }),
    restore: stage(0), move: stage(1), enter: (_, finish) => stage(2)(finish), targetReady: () => vi.fn(),
  };
  const coordinator = createNavigationStageCoordinator();
  const operation = coordinator.start('target', stages);
  for (let i = 0; i < index; i++) callbacks[i]('settled');
  available = false;
  coordinator.reconcile();
  callbacks[index]('settled');
  expect(await operation.completion).toBe('cancelled');
  expect(callbacks[index + 1]).toBeUndefined();
});
