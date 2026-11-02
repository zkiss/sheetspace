import { describe, expect, it, vi } from 'vitest';
import { createNavigationStageCoordinator } from '@workspace/navigationStageCoordinator';
import { navigationTransportStages } from './navigationTransportStages';

const saved = { position: { x: 1, y: 2 }, size: { width: 200, height: 100 }, visualScale: 1 };
const displayed = { ...saved, position: { x: 3, y: 4 } };

describe('navigation presentation stage adapters', () => {
  it('restores, moves, and enters using the displayed target frame before reporting readiness', async () => {
    const events: string[] = [];
    const runtime = {
      currentState: () => ({ mode: 'maximised' as const, sheetId: 'source' }),
      ensureCanvas: vi.fn(async () => { events.push('restore'); return 'settled' as const; }),
      enter: vi.fn(() => { events.push('enter'); }),
      claimPresentation: () => () => {},
      ensureMaximised: vi.fn(async () => { events.push('ready'); return 'settled' as const; }),
    };
    const move = vi.fn((finish: (result: 'settled' | 'cancelled') => void) => { events.push('move'); finish('settled'); return () => {}; });
    const stages = navigationTransportStages(runtime, () => true, () => ({ saved, displayed }), move);
    const operation = createNavigationStageCoordinator().start('target', stages);
    expect(await operation.completion).toBe('ready');
    expect(events).toEqual(['restore', 'move', 'enter', 'ready']);
    expect(runtime.enter).toHaveBeenCalledWith('target', saved, displayed, true);
  });

  it('waits for same-sheet semantic readiness without moving', async () => {
    const runtime = {
      currentState: () => ({ mode: 'entering' as const, sheetId: 'target' }),
      ensureCanvas: vi.fn(async () => 'settled' as const),
      enter: vi.fn(), ensureMaximised: vi.fn(async () => 'settled' as const),
      claimPresentation: () => () => {},
    };
    const move = vi.fn(() => () => {});
    const operation = createNavigationStageCoordinator().start('target', navigationTransportStages(runtime, () => true, () => ({ saved, displayed }), move));
    expect(await operation.completion).toBe('ready');
    expect(move).not.toHaveBeenCalled();
    expect(runtime.ensureMaximised).toHaveBeenCalledWith('target');
  });

  it('ignores late semantic settlement after cancellation', async () => {
    let resolve!: (result: 'settled' | 'cancelled') => void;
    const runtime = {
      currentState: () => ({ mode: 'entering' as const, sheetId: 'target' }),
      ensureCanvas: vi.fn(async () => 'settled' as const), enter: vi.fn(),
      claimPresentation: () => () => {},
      ensureMaximised: () => new Promise<'settled' | 'cancelled'>((finish) => { resolve = finish; }),
    };
    const operation = createNavigationStageCoordinator().start('target', navigationTransportStages(runtime, () => true, () => ({ saved, displayed }), () => () => {}));
    operation.cancel();
    resolve('settled');
    expect(await operation.completion).toBe('cancelled');
  });
});
