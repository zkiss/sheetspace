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

  it('keeps scattered keyboard spacing rather than gathering the sources', () => {
    const sizes = Object.fromEntries('ABCDEFGH'.split('').map((id) => [id, 10]));
    const before = snapshot('ABCDEFGH'.split(''), sizes);
    const shifted = snapshot('ACBEDGFH'.split(''), sizes);
    const plan = planAxisMotion(before, shifted, 0, 80);
    expect(plan.filter((item) => 'BDF'.includes(item.id)).map((item) => item.delta)).toEqual([-10, -10, -10]);
    expect(plan.filter((item) => 'CEG'.includes(item.id)).map((item) => item.delta)).toEqual([10, 10, 10]);
    expect(planAxisMotion(before, snapshot('CDEABFGH'.split(''), sizes), 0, 80).slice(3, 5).map((item) => item.delta)).toEqual([-30, -30]);
  });

  it('bounds a large move to old and new viewport occupancy including entering identities', () => {
    const ids = Array.from({ length: 10000 }, (_, i) => `${i}`);
    const sizes = Object.fromEntries(ids.map((id) => [id, 10]));
    const before = snapshot(ids, sizes);
    const after = snapshot([...ids].reverse(), sizes);
    const plan = planAxisMotion(before, after, 0, 25);
    expect(plan.map((item) => item.id)).toEqual(['9999', '9998', '9997', '2', '1', '0']);
    expect(planAxisMotion(before, after, 0, 0)).toEqual([]);
    expect(planAxisMotion(before, after, 200000, 100)).toEqual([]);
  });

  it('rejects insertion, duplicate identities and changes to creating-slot topology', () => {
    const before = snapshot(['A', 'B'], { A: 10, B: 20 });
    expect(planAxisMotion(before, before.slice(1), 0, 100)).toEqual([]);
    expect(planAxisMotion([before[0], before[0]], before, 0, 100)).toEqual([]);
    expect(planAxisMotion(before, [before[0], before[0]], 0, 100)).toEqual([]);
    const slot = { key: 'pending', saved: false, start: 10, size: 5 };
    const pending = [before[0], slot, before[1]];
    expect(planAxisMotion(pending, [before[1], slot, before[0]], 0, 100)).not.toEqual([]);
    expect(planAxisMotion(pending, [before[1], { ...slot, key: 'other' }, before[0]], 0, 100)).toEqual([]);
    expect(planAxisMotion(pending, [slot, before[1], before[0]], 0, 100)).toEqual([]);
  });

  it('snapshots creating slots separately from saved identities and tolerates absent metric entries', () => {
    const entries = projectGridAxis(['A'], [{ kind: 'creating', operationId: 'pending', boundary: 1 }]);
    const metrics = createGridAxisMetrics(entries, () => 10);
    expect(axisMotionSnapshot(entries, metrics)).toEqual([
      { key: 'A', saved: true, start: 0, size: 10 },
      { key: 'pending', saved: false, start: 10, size: 10 },
    ]);
    expect(axisMotionSnapshot(entries, createGridAxisMetrics([], () => 0)).every((item) => item.start === 0 && item.size === 0)).toBe(true);
  });
});
