// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';

const toolbarCss = fs.readFileSync('src/workspace/WorkspaceToolbar.css', 'utf8');

// CSSOM contracts supplement component tests: JSDOM cannot perform wrapping or
// pseudo-element layout, but can check the actual shipped rules without snapshots.
function rules() {
  const style = document.createElement('style');
  style.textContent = toolbarCss;
  document.head.append(style);
  const result = [...style.sheet!.cssRules];
  style.remove();
  return result;
}

function rule(selector: string) {
  const normalize = (value: string) => value.replace(/\s+/g, ' ');
  const matches = rules().filter((entry) => entry.type === CSSRule.STYLE_RULE && normalize((entry as CSSStyleRule).selectorText) === normalize(selector)) as CSSStyleRule[];
  expect(matches.length, `CSS rules for ${selector}`).toBeGreaterThan(0);
  return {
    getPropertyValue: (property: string) => [...matches].reverse().find((entry) => entry.style.getPropertyValue(property))?.style.getPropertyValue(property) ?? '',
  };
}

describe('toolbar presentation rules', () => {
  it('uses one leading divider per property group, wrapping groups as whole flex items', () => {
    const toolbar = rule('.workspace-toolbar');
    expect(toolbar.getPropertyValue('display')).toBe('flex');
    expect(toolbar.getPropertyValue('flex-wrap')).toBe('wrap');
    expect(rule('.workspace-format-slot').getPropertyValue('display')).toBe('contents');
    expect(rule('.workspace-format-slot .number-format-controls').getPropertyValue('display')).toBe('contents');
    const group = rule('.format-control-group');
    expect(group.getPropertyValue('border-left')).toBe('1px solid #cbd6db');
    expect(group.getPropertyValue('border-right')).toBe('');
    expect(group.getPropertyValue('flex')).toBe('0 0 auto');
    expect(group.getPropertyValue('flex-wrap')).toBe('nowrap');
    expect(group.getPropertyValue('white-space')).toBe('nowrap');
    expect(rule('.save-status-indicator').getPropertyValue('flex-shrink')).toBe('0');
    const narrow = rules().find((entry) => entry.type === CSSRule.MEDIA_RULE) as CSSMediaRule;
    expect(narrow.conditionText).toBe('(max-width: 360px)');
    expect((narrow.cssRules[0] as CSSStyleRule).selectorText).toBe('.format-precision-label');
    expect((narrow.cssRules[0] as CSSStyleRule).style.getPropertyValue('display')).toBe('none');
  });

  it('pairs glyphs with inner swatch backgrounds independently of button hover/pressed styles', () => {
    const swatch = rule('.colour-picker-trigger-swatch,\n.colour-picker-swatch::after');
    expect(swatch.getPropertyValue('background')).toBe('var(--colour-swatch)');
    expect(rule('.colour-picker-trigger-swatch').getPropertyValue('place-items')).toBe('center');
    expect(rule('.number-format-controls button:hover:not(:disabled)').getPropertyValue('background')).toBe('#dbe6ea');
    expect(rule('.number-format-controls button[aria-pressed="true"]').getPropertyValue('color')).toBe('#fff');
    // No state rule targets the inner glyph/swatch pairing.
    expect(rules().filter((entry) => entry.type === CSSRule.STYLE_RULE && /hover|aria-pressed/.test((entry as CSSStyleRule).selectorText) && /trigger-swatch/.test((entry as CSSStyleRule).selectorText))).toHaveLength(0);
  });

  it('clips only swatch buttons and sizes/repositions palettes without clipping their ancestors', () => {
    expect(rule('.number-format-controls .colour-picker-trigger,\n.number-format-controls .colour-picker-swatch').getPropertyValue('overflow')).toBe('hidden');
    for (const selector of ['.workspace-toolbar', '.workspace-format-slot', '.number-format-controls', '.format-control-group', '.colour-picker']) {
      expect(rule(selector).getPropertyValue('overflow')).toBe('');
    }
    const popover = rule('.colour-picker-popover');
    expect(popover.getPropertyValue('width')).toBe('min(18rem, calc(100vw - 1.5rem))');
    expect(popover.getPropertyValue('left')).toBe('var(--colour-popover-offset, 0px)');
    expect(rule('.colour-picker-popover .colour-picker-swatches').getPropertyValue('grid-template-columns')).toBe('repeat(6, minmax(0, 1fr))');
    expect(rule('.colour-picker-popover .colour-picker-swatch').getPropertyValue('min-width')).toBe('0');
    expect(rule('.number-format-controls .colour-picker-custom-trigger').getPropertyValue('min-width')).toBe('0');
  });
});
