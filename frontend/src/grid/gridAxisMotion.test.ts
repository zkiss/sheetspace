import { describe, expect, it } from 'vitest';
import { axisMotionSnapshot, planAxisMotion } from './gridAxisMotion';
import { createGridAxisMetrics } from './gridAxisMetrics';
import { projectGridAxis } from './gridAxisProjection';

function snapshot(ids: string[], sizes: Record<string, number>) {
  const entries = projectGridAxis(ids, []);
  return axisMotionSnapshot(entries, createGridAxisMetrics(entries, (entry) => entry.kind === 'saved' ? sizes[entry.id] : 1));
}

describe('axis motion planning', () => {
  it('retains individual origins and displaced neighbours for a scattered gather with variable sizes', () => {
    const sizes = { A: 10, B: 20, C: 30, D: 40, E: 50 };
    const before = snapshot(['A', 'B', 'C', 'D', 'E'], sizes);
    const after = snapshot(['A', 'C', 'E', 'B', 'D'], sizes);
    expect(planAxisMotion(before, after, 0, 150).map(({ id, delta }) => [id, delta])).toEqual([
      ['A', 0], ['C', 20], ['E', 60], ['B', -80], ['D', -50],
    ]);
  });

  it('includes partially visible old and new endpoints without pinning the corridor', () => {
    const sizes = Object.fromEntries('ABCDEFGHIJ'.split('').map((id) => [id, 10]));
    const before = snapshot('ABCDEFGHIJ'.split(''), sizes);
    const after = snapshot('BCDEFGHIJA'.split(''), sizes);
    expect(planAxisMotion(before, after, 5, 10).map(({ id }) => id)).toEqual(['B', 'C', 'A']);
  });

  it('ignores unchanged order, identity changes and metric changes', () => {
    const before = snapshot(['A', 'B'], { A: 10, B: 20 });
    expect(planAxisMotion(before, before, 0, 100)).toEqual([]);
    expect(planAxisMotion(before, snapshot(['B', 'C'], { B: 20, C: 10 }), 0, 100)).toEqual([]);
    expect(planAxisMotion(before, snapshot(['B', 'A'], { B: 21, A: 10 }), 0, 100)).toEqual([]);
  });
});
