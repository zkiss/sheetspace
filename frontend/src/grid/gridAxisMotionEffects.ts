import type { AxisMotionItem } from './gridAxisMotion';

export type GridAxisMotionPlan = { rows: readonly AxisMotionItem[]; columns: readonly AxisMotionItem[] };

export function animateGridAxes(root: HTMLElement, plan: GridAxisMotionPlan, finish: () => void): () => void {
  const animations: Animation[] = [];
  let active = true;
  const start = (attribute: 'motionRow' | 'motionColumn', items: readonly AxisMotionItem[], direction: 'X' | 'Y') => {
    const offsets = new Map(items.map((item) => [item.id, item.delta]));
    const selector = attribute === 'motionRow' ? '[data-motion-row]' : '[data-motion-column]';
    for (const element of root.querySelectorAll<HTMLElement>(selector)) {
      const delta = offsets.get(element.dataset[attribute]!);
      if (!delta || !element.animate) continue;
      animations.push(element.animate([
        { transform: `translate${direction}(${delta}px)` },
        { transform: `translate${direction}(0px)` },
      ], { duration: 220, easing: 'ease-out' }));
    }
  };
  start('motionRow', plan.rows, 'Y');
  start('motionColumn', plan.columns, 'X');
  let remaining = animations.length;
  for (const animation of animations) {
    animation.onfinish = () => {
      if (active && --remaining === 0) { active = false; finish(); }
    };
  }
  if (!remaining) { active = false; finish(); }
  return () => {
    active = false;
    for (const animation of animations) { animation.onfinish = null; animation.cancel(); }
  };
}
