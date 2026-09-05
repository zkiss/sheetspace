// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { diagnostics } from './policyFixtures';

function styleDiagnostics(css: string, files: Record<string, string> = {}) {
  return diagnostics({ 'src/workspace/View.css': css, ...files });
}

describe('stylesheet dependencies under the final policy', () => {
  it.each([
    '/* sheet frame */ @import "../grid/View.css";',
    '@IMPORT "../grid/View.css";',
  ])('rejects review import reproduction: %s', (css) => {
    expect(styleDiagnostics(css, { 'src/grid/View.css': '.view {}' }).map(({ code }) => code)).toContain('css-import');
  });

  it('rejects the review uppercase URL reproduction', () => {
    expect(styleDiagnostics('.view { background: URL("../grid/icon.svg"); }', { 'src/grid/icon.svg': '<svg />' }).map(({ code }) => code)).toEqual(['forbidden-package-import']);
  });

  it.each([
    ['url(OWNER/icon.svg)', 'icon.svg'],
    ['uRl("OWNER/icon.svg")', 'icon.svg'],
    [String.raw`\75rl("OWNER/icon.svg")`, 'icon.svg'],
    [String.raw`u\72l(OWNER/ic\6fn.svg)`, 'icon.svg'],
    [String.raw`url("OWNER/ic\6fn.svg")`, 'icon.svg'],
    ['url("OWNER/ic\\\non.svg")', 'icon.svg'],
    ['url("OWNER/icon name).svg")', 'icon name).svg'],
    [String.raw`url(OWNER/icon\ name\).svg)`, 'icon name).svg'],
    ['url("OWNER/icon.svg#symbol")', 'icon.svg'],
    ['url("OWNER/icon.svg?v=1#symbol")', 'icon.svg'],
    ['url("OWNER/icon%20name.svg")', 'icon name.svg'],
    [String.raw`url("OWNER\2f icon.svg")`, 'icon.svg'],
    ['image-set("OWNER/icon.svg" 1x type("image/svg+xml"))', 'icon.svg'],
    ['IMAGE-SET(url(OWNER/icon.svg) 1x)', 'icon.svg'],
    [String.raw`im\61ge-set("OWNER/icon.svg" 1x)`, 'icon.svg'],
    ['-WEBKIT-IMAGE-SET("OWNER/icon.svg" 1x)', 'icon.svg'],
  ])('resolves allowed and forbidden owners for %s', (value, filename) => {
    const files = { [`src/workspace/${filename}`]: '<svg />', [`src/grid/${filename}`]: '<svg />' };
    expect(styleDiagnostics(`.view { background: ${value.replace(/OWNER/g, '.')}; }`, files)).toEqual([]);
    expect(styleDiagnostics(`.view { background: ${value.replace(/OWNER/g, '../grid')}; }`, files).map(({ code }) => code)).toEqual(['forbidden-package-import']);
  });

  it('preserves meaningful whitespace in quoted filenames', () => {
    expect(styleDiagnostics('.view { background: url(" icon.svg"); }', { 'src/workspace/ icon.svg': '' })).toEqual([]);
    expect(styleDiagnostics('.view { background: url("icon.svg "); }', { 'src/workspace/icon.svg': '' }).map(({ code }) => code)).toContain('invalid-css-asset');
  });

  it.each([
    'https://example.test/icon.svg', 'data:image/svg+xml,svg', '//example.test/icon.svg', '#symbol',
    String.raw`\68ttps://example.test/icon.svg`, String.raw`\23 symbol`,
  ])('allows nonlocal reference %s', (url) => {
    expect(styleDiagnostics(`.view { background: URL("${url}"); }`)).toEqual([]);
  });

  it('checks every image-set candidate and ignores the MIME descriptor', () => {
    const css = '.view { background: image-set("./own.svg" 1x type("image/svg+xml"), "../grid/icon.svg" 2x, url("../grid/other.svg") 3x); }';
    expect(styleDiagnostics(css, { 'src/workspace/own.svg': '', 'src/grid/icon.svg': '', 'src/grid/other.svg': '' }).map(({ code }) => code)).toEqual(['forbidden-package-import', 'forbidden-package-import']);
  });

  it.each([
    ['./missing.svg', {}, 'invalid-css-asset'],
    ['./module.ts', { 'src/workspace/module.ts': '' }, 'invalid-css-asset'],
    ['../unknown/icon.svg', { 'src/unknown/icon.svg': '' }, 'unowned-css-asset'],
    ['../../node_modules/icon.svg', { 'node_modules/icon.svg': '' }, 'source-escape'],
    ['../../../outside.svg', { '../outside.svg': '' }, 'source-escape'],
    ['../test-support/icon.svg', { 'src/test-support/icon.svg': '' }, 'test-role-import'],
    ['./bad%zz.svg', {}, 'invalid-css-asset'],
    ['', {}, 'invalid-css-asset'],
  ] as const)('retains targeted validation for %s', (url, files, expected) => {
    expect(styleDiagnostics(`.view { background: url("${url}"); }`, files).map(({ code }) => code)).toContain(expected);
  });

  it('reports tokenizer and malformed dependency errors in the policy gate', () => {
    expect(styleDiagnostics('.view { background: url("icon.svg" extra); }').map(({ code }) => code)).toContain('invalid-css');
  });

  it('analyzes inventoried uppercase CSS and requires its explicit classification', () => {
    const codes = diagnostics({ 'src/workspace/View.CSS': '@IMPORT "../grid/View.css"; background: URL("../grid/icon.svg")', 'src/grid/View.css': '', 'src/grid/icon.svg': '' }).map(({ code }) => code);
    expect(codes).toContain('missing-style-classification');
    expect(codes).toContain('css-import');
    expect(codes).toContain('forbidden-package-import');
  });
});
