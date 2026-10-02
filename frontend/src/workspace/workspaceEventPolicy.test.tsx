import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  eventTargetElement, isBackgroundTarget, isNativeControlTarget, isNativeEditorTarget,
  isNativeContentTarget, isOwnedPortalTarget, isSheetContextTarget, isSheetTarget,
} from './workspaceEventPolicy';

function setup() {
  render(<>
    <section data-testid="surface">
      <div data-testid="plane">Background text</div>
      <article data-testid="frame" data-sheet-id="owned" data-workspace-sheet-frame>
        <button data-testid="overview">Sheet overview</button>
        <input data-testid="input" />
        <section data-workspace-native-content><span data-testid="native">Native text</span></section>
        <div role="menu"><label data-testid="label">Menu label</label></div>
      </article>
      <button data-testid="reference" data-sheet-id="foreign">Reference metadata</button>
    </section>
    <textarea data-testid="portal" data-workspace-sheet-editor="owned" />
    <textarea data-testid="foreign" data-workspace-sheet-editor="foreign" />
    <textarea data-testid="unmarked" />
  </>);
  return (name: string) => screen.getByTestId(name);
}

describe('workspace DOM ownership policy', () => {
  it('normalizes text nodes without assigning non-DOM or detached targets to the canvas', () => {
    const target = setup();
    const surface = target('surface');
    const text = target('plane').firstChild!;
    expect(eventTargetElement(text)).toBe(target('plane'));
    expect(isBackgroundTarget(text, surface)).toBe(true);
    for (const invalid of [null, window, document, new EventTarget(), document.createTextNode('detached')]) {
      expect(eventTargetElement(invalid)).toBeNull();
      expect(isBackgroundTarget(invalid, surface)).toBe(false);
      expect(isOwnedPortalTarget(invalid, surface)).toBe(false);
      expect(isSheetContextTarget(invalid, target('frame'))).toBe(false);
    }
  });

  it('prioritizes native editors and declared UI boundaries over a sheet, but keeps its overview sheet-owned', () => {
    const target = setup();
    for (const name of ['input', 'native', 'label']) {
      expect(isNativeContentTarget(target(name))).toBe(true);
      expect(isNativeControlTarget(target(name))).toBe(true);
      expect(isBackgroundTarget(target(name), target('surface'))).toBe(false);
      expect(isSheetContextTarget(target(name), target('frame'))).toBe(false);
    }
    expect(isNativeEditorTarget(target('input'))).toBe(true);
    expect(isNativeEditorTarget(target('native'))).toBe(false);
    expect(isNativeControlTarget(target('overview'))).toBe(true);
    expect(isNativeContentTarget(target('overview'))).toBe(false);
    expect(isSheetContextTarget(target('overview').firstChild, target('frame'))).toBe(true);
    expect(isBackgroundTarget(target('frame'), target('surface'))).toBe(false);
    expect(isSheetContextTarget(target('portal'), target('frame'))).toBe(false);
    expect(isSheetContextTarget(target('frame'), target('surface'))).toBe(false);
  });

  it('matches portal ownership only to real frames, never sheet-reference metadata or local targets', () => {
    const target = setup();
    expect(isSheetTarget(target('frame'))).toBe(true);
    expect(isSheetTarget(target('reference'))).toBe(false);
    expect(isOwnedPortalTarget(target('portal'), target('surface'))).toBe(true);
    for (const name of ['input', 'plane', 'foreign', 'unmarked']) {
      expect(isOwnedPortalTarget(target(name), target('surface'))).toBe(false);
    }
    expect(isBackgroundTarget(target('portal'), target('surface'))).toBe(false);
  });
});
