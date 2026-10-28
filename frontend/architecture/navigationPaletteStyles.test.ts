// @vitest-environment jsdom
import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync('src/app/NavigationPalette.css', 'utf8');
function style(selector: string) {
  const element = document.createElement('style');
  element.textContent = css;
  document.head.append(element);
  const rule = [...element.sheet!.cssRules].find((entry) => entry.type === CSSRule.STYLE_RULE && (entry as CSSStyleRule).selectorText === selector) as CSSStyleRule | undefined;
  expect(rule, selector).toBeDefined();
  element.remove();
  return rule!.style;
}

describe('palette presentation policy', () => {
  it('keeps rows full width and distinguishes hover, selection, unavailable reasons and shortcuts', () => {
    expect(style('.navigation-command').getPropertyValue('width')).toBe('100%');
    expect(style('.navigation-command:hover:not(:disabled)').getPropertyValue('background')).toBe('var(--accent-soft)');
    expect(style(".navigation-palette-item[aria-selected='true'] .navigation-command, .navigation-command:focus-visible").getPropertyValue('background')).toBe('var(--accent-soft-hover)');
    expect(style('.navigation-command:disabled').getPropertyValue('cursor')).toBe('not-allowed');
    expect(style('.navigation-command-shortcut').getPropertyValue('white-space')).toBe('nowrap');
    expect(style('.navigation-command-reason').getPropertyValue('color')).not.toBe('');
  });
  it('shares accent tokens without adding a grid focus ring or replacing semantic colours', () => {
    const global = fs.readFileSync('src/app/global.css', 'utf8');
    const cells = fs.readFileSync('src/grid/SheetGridCell.css', 'utf8');
    const editor = fs.readFileSync('src/application/react/FormulaEditorPanel.css', 'utf8');
    expect(global).toContain('--accent: #a8460b');
    expect(global).toContain('[tabindex]:not(.sheet-grid-cell)');
    expect(cells).toContain('var(--accent-selection)');
    expect(cells).toContain('.formula-syntax-token-invalid');
    expect(cells).toContain('.formula-syntax-token-reference');
    expect(editor).toContain('.formula-editor-diagnostics { color: #9d2727;');
    expect(editor).toContain('var(--accent-soft-hover)');
  });

});
