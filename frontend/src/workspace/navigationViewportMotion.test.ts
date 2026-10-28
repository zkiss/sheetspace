import { describe, expect, it } from 'vitest';
import { navigationViewportMotion } from './navigationViewportMotion';

describe('navigation viewport motion', () => {
  it('preserves position, velocity and acceleration when retargeted and settles at rest', () => {
    const first = navigationViewportMotion({ x: 0, y: 10, scale: 1 }, { x: 300, y: -100, scale: 2 });
    const incoming = first.sample(first.duration * 0.37);
    const next = navigationViewportMotion(incoming.viewport, { x: -80, y: 50, scale: 1.5 }, incoming.velocity, incoming.acceleration);

    expect(next.sample(0)).toEqual(incoming);
    const settled = next.sample(next.duration);
    expect(settled.viewport.x).toBeCloseTo(-80);
    expect(settled.viewport.y).toBeCloseTo(50);
    expect(settled.viewport.scale).toBeCloseTo(1.5);
    for (const axis of ['x', 'y', 'scale'] as const) {
      expect(settled.velocity[axis]).toBeCloseTo(0);
      expect(settled.acceleration[axis]).toBeCloseTo(0);
    }
  });

  it('clamps sample time and suppresses derivatives when zoom exceeds its bounds', () => {
    const motion = navigationViewportMotion({ x: 0, y: 0, scale: 1 }, { x: 100, y: 100, scale: 1 }, { x: 0, y: 0, scale: 100 });
    expect(motion.sample(-1)).toEqual(motion.sample(0));
    expect(motion.sample(motion.duration + 1)).toEqual(motion.sample(motion.duration));
    const sample = motion.sample(motion.duration / 4);
    expect(Number.isFinite(sample.viewport.scale)).toBe(true);
    expect(sample.velocity.scale).toBe(0);
    expect(sample.acceleration.scale).toBe(0);
    expect(motion.keyframes).toHaveLength(81);
  });

  it('reports derivatives consistent with the sampled trajectory throughout a retarget', () => {
    const motion = navigationViewportMotion(
      { x: 20, y: -40, scale: 1 }, { x: 240, y: 80, scale: 1.5 },
      { x: 0.2, y: -0.1, scale: 0.0002 }, { x: 0.0001, y: 0.0002, scale: 0.000001 },
    );
    const delta = 0.01;
    for (const fraction of [0.1, 0.35, 0.7, 0.9]) {
      const time = motion.duration * fraction;
      const before = motion.sample(time - delta);
      const current = motion.sample(time);
      const after = motion.sample(time + delta);
      for (const axis of ['x', 'y', 'scale'] as const) {
        expect((after.viewport[axis] - before.viewport[axis]) / (2 * delta)).toBeCloseTo(current.velocity[axis], 6);
        expect((after.velocity[axis] - before.velocity[axis]) / (2 * delta)).toBeCloseTo(current.acceleration[axis], 6);
      }
    }
  });
});
