// @vitest-environment jsdom
import * as fs from 'node:fs';
import { expect, it } from 'vitest';

// Source/CSSOM contracts, not browser paint or animation-timing evidence.
it('shares history colour fade without navigation outlines and retains static reduced-motion tint', () => {
  const css = fs.readFileSync('src/grid/SheetGridCell.css', 'utf8');
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  try {
    const rules = Array.from(style.sheet!.cssRules);
    const navigationRules = rules.filter((rule) => rule.type === 1
      && (rule as CSSStyleRule).selectorText.includes('navigation')) as CSSStyleRule[];
    expect(navigationRules).toHaveLength(2);
    for (const rule of navigationRules) {
      expect(rule.cssText).not.toMatch(/box-shadow|outline|border|filter|transform/);
    }
    const tint = navigationRules.find((rule) => rule.selectorText === '.sheet-grid-navigation-feedback')!;
    expect(tint.style.getPropertyValue('animation')).toBe('content-history-highlight 1.2s ease-out');
    expect(tint.style.getPropertyValue('pointer-events')).toBe('none');
    expect(tint.style.getPropertyValue('background')).toBe('var(--target-highlight-to)');
    expect(tint.style.getPropertyValue('--target-highlight-to')).toBe('rgb(61 170 114 / 15%)');
    const fade = rules.find((rule) => rule.cssText.startsWith('@keyframes content-history-highlight'))!;
    expect(fade.cssText).toContain('var(--target-highlight-from, #ffe15a)');
    expect(fade.cssText).toContain('var(--target-highlight-to, #fff3a3)');
    expect(fade.cssText).not.toMatch(/box-shadow|outline|border|filter|transform/);
    expect(css).not.toContain('navigation-target-pulse');
    const reduced = rules.find((rule) => rule.type === 4
      && (rule as CSSMediaRule).conditionText === '(prefers-reduced-motion: reduce)') as CSSMediaRule;
    const staticTint = Array.from(reduced.cssRules).find((rule) => rule.type === 1
      && (rule as CSSStyleRule).selectorText === '.sheet-grid-navigation-feedback') as CSSStyleRule;
    expect(staticTint.style.getPropertyValue('animation')).toBe('none');
    expect(staticTint.style.getPropertyValue('display')).toBe('');
  } finally { style.remove(); }
});
