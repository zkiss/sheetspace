// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cssDependencies } from './cssDependencies';

describe('CSS dependency extraction', () => {
  it.each([
    '/* sheet frame */ @import "view.css";',
    '@charset "UTF-8"; @import "view.css";',
    '@IMPORT "view.css";',
    '@ImPoRt url(view.css) layer(theme) supports(display: grid) screen;',
    String.raw`@\69mport "view.css";`,
  ])('recognizes import tokens in %s', (css) => {
    expect(cssDependencies(css).imports).toBe(1);
  });

  it('ignores comments, ordinary strings, and unrelated token names', () => {
    const css = String.raw`
      /* @import "hidden.css"; url("hidden.svg") */
      .view { content: '@import "hidden.css"; url("hidden.svg")';
        --my-url: my-url("hidden.svg"); --url-text: url; }
    `;
    expect(cssDependencies(css)).toEqual({ imports: 0, urls: [], errors: [] });
  });

  it('visits nested functions, at-rule bodies, and custom properties', () => {
    const css = '@media screen { .view { --images: cross-fade(url(a.svg), nested(URL("b.svg"))); background: url(c.svg), url(d.svg); } }';
    expect(cssDependencies(css)).toEqual({ imports: 0, urls: ['a.svg', 'b.svg', 'c.svg', 'd.svg'], errors: [] });
  });

  it('distinguishes image-set candidates from type descriptor strings', () => {
    const css = '.view { background: image-set("a.svg" 1x type("image/svg+xml"), URL("b.svg") 2x, "c.svg" 3x); }';
    expect(cssDependencies(css)).toEqual({ imports: 0, urls: ['a.svg', 'c.svg', 'b.svg'], errors: [] });
  });

  it.each([
    '.view { background: url("a.svg); }',
    '.view { background: url(a b.svg); }',
    '.view { background: url("a.svg" extra); }',
    '.view { background: URL(var(--asset)); }',
    '.view { background: url("a.svg")',
    '.view { background: url("a.svg"; }',
    '/* unterminated comment',
    '.view { background: image-set("a.svg" "b.svg"); }',
    '.view { background: image-set(); }',
    '.view { background: image-set(, "a.svg"); }',
    '.view { background: image-set("a.svg",); }',
    '.view { background: image-set(var(--asset) 1x); }',
  ])('reports malformed CSS dependencies in %s', (css) => {
    expect(cssDependencies(css).errors.length).toBeGreaterThan(0);
  });
});
