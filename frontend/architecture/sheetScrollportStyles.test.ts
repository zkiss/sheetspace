// @vitest-environment jsdom
import * as fs from 'node:fs';
import { expect, it } from 'vitest';

// CSSOM contract: native wheel eligibility and scroll-ref wiring are exercised
// in SheetFrame.test.tsx; JSDOM does not perform browser default scrolling.
it('keeps the sheet body a native two-axis scrollport within the flex frame', () => {
  const style = document.createElement('style');
  style.textContent = fs.readFileSync('src/workspace/SheetFrame.css', 'utf8');
  document.head.append(style);
  try {
    const rules = Array.from(style.sheet!.cssRules).filter((rule) => rule.type === 1) as CSSStyleRule[];
    const frame = rules.find((rule) => rule.selectorText === '.sheet-frame')!;
    expect(frame.style.getPropertyValue('display')).toBe('flex');
    expect(frame.style.getPropertyValue('flex-direction')).toBe('column');
    const body = rules.find((rule) => rule.selectorText === '.sheet-frame-body')!;
    expect(body.style.getPropertyValue('flex')).toBe('1');
    expect(body.style.getPropertyValue('min-height')).toBe('0');
    expect(body.style.getPropertyValue('overflow')).toBe('auto');
    for (const rule of rules.filter((rule) => rule.selectorText.includes('.sheet-frame-body'))) {
      expect(rule.style.getPropertyValue('overflow-x')).toBe('');
      expect(rule.style.getPropertyValue('overflow-y')).toBe('');
      expect(rule.style.getPropertyValue('overflow')).toMatch(/^(auto)?$/);
    }
  } finally { style.remove(); }
});
