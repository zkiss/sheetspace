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
