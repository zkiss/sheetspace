// @vitest-environment jsdom
import * as fs from 'node:fs';
import { expect, it } from 'vitest';

// Source/CSSOM contracts, not browser paint or animation-timing evidence.
it('fades sheet selections without a navigation pulse and suppresses fades for reduced motion', () => {
  const css = fs.readFileSync('src/grid/SheetGridCell.css', 'utf8');
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  try {
    const rules = Array.from(style.sheet!.cssRules);
    const navigationRules = rules.filter((rule) => rule.type === 1
      && (rule as CSSStyleRule).selectorText.includes('navigation')) as CSSStyleRule[];
    expect(navigationRules).toHaveLength(1);
    for (const rule of navigationRules) {
      expect(rule.cssText).not.toMatch(/box-shadow|outline|border|filter|transform/);
    }
    const fadeIn = rules.find((rule) => rule.type === 1 && (rule as CSSStyleRule).selectorText === '.sheet-grid-cell-selection-fade-in') as CSSStyleRule;
    const fadeOut = rules.find((rule) => rule.type === 1 && (rule as CSSStyleRule).selectorText === '.sheet-grid-selection-fade-out') as CSSStyleRule;
    expect(fadeIn.style.animation).toBe('selection-fade-in 400ms ease-out');
    expect(fadeOut.style.animation).toBe('selection-fade-out 400ms ease-out forwards');
    expect(fadeOut.style.getPropertyValue('pointer-events')).toBe('none');
    expect(rules.some((rule) => rule.cssText.startsWith('@keyframes selection-fade-in'))).toBe(true);
    expect(rules.some((rule) => rule.cssText.startsWith('@keyframes selection-fade-out'))).toBe(true);
    expect(css).not.toContain('navigation-target-pulse');
    const reduced = rules.find((rule) => rule.type === 4
      && (rule as CSSMediaRule).conditionText === '(prefers-reduced-motion: reduce)') as CSSMediaRule;
    const reducedRules = Array.from(reduced.cssRules) as CSSStyleRule[];
    expect(reducedRules.find((rule) => rule.selectorText === '.sheet-grid-cell-selection-fade-in')!.style.animation).toBe('none');
    expect(reducedRules.find((rule) => rule.selectorText === '.sheet-grid-selection-fade-out')!.style.display).toBe('none');
  } finally { style.remove(); }
});
