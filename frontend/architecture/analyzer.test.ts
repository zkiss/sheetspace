import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeArchitecture, type ArchitecturePolicy } from './analyzer';

const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

const policy: ArchitecturePolicy = {
  owners: [
    { name: 'app', files: /^app\//, role: 'production', mayImport: ['core', 'assets'], external: ['react'] },
    { name: 'core', files: /^core\//, role: 'production', mayImport: ['assets'], external: [] },
    { name: 'tests', files: /^test\//, role: 'test', mayImport: ['app', 'core', 'assets', 'test-support'], external: ['vitest'] },
    { name: 'test-support', files: /^support\//, role: 'test-support', mayImport: ['core'], external: [] },
    { name: 'assets', files: /^assets\//, role: 'production', external: [] },
    { name: 'config', files: /^tsconfig\.json$/, role: 'tooling', external: [] },
  ],
  globFiles: ['app/glob.ts'],
  excludedDirectories: ['node_modules', 'dist', 'coverage'],
  styles: [{ files: /\.css$/, kind: 'scoped' }],
};

function fixture(files: Record<string, string>, nextPolicy = policy, links: Record<string, string> = {}, paths: Record<string, string[]> = { '@core/*': ['core/*'] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-')); temporary.push(root);
  for (const [name, content] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), content); }
  for (const [name, target] of Object.entries(links)) { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.symlinkSync(target, path.join(root, name)); }
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { moduleResolution: 'bundler', resolveJsonModule: true, baseUrl: '.', paths } }));
  return analyzeArchitecture({ rootDir: root, tsconfigPath: path.join(root, 'tsconfig.json'), policy: nextPolicy });
}
const codes = (files: Record<string, string>, nextPolicy?: ArchitecturePolicy) => fixture(files, nextPolicy).diagnostics.map((item) => item.code);
const base = { 'app/main.ts': "import '../core/value';", 'core/value.ts': 'export const value = 1;', 'assets/logo.svg': '<svg />' };

describe('architecture analyzer', () => {
  it('accepts extensions, indexes, JSON aliases, test roles, and exact data ownership', () => {
    const local: ArchitecturePolicy = { ...policy, exactTestData: ['fixtures/workbook-api.json'] };
    expect(codes({ ...base, 'core/index.ts': "export * from './value';", 'core/data.json': '{}', 'app/main.ts': "import '../core'; import data from '@core/data.json'; import '../assets/logo.svg'; void data;", 'test/example.test.ts': "import '../support/helpers';", 'support/helpers.ts': "import '../core/value';", 'fixtures/workbook-api.json': '{}' }, local)).toEqual([]);
  });
  it('rejects missing and multiple ownership while accepting alias resolution', () => {
    expect(codes({ ...base, 'loose.ts': '' })).toContain('unowned-file');
    const duplicate: ArchitecturePolicy = { ...policy, owners: [...policy.owners, { name: 'also-core', files: /^core\//, role: 'production' }] };
    expect(codes(base, duplicate)).toContain('multiple-owner');
    expect(codes({ ...base, 'app/main.ts': "import '@core/value';" })).toEqual([]);
  });
  it('accepts approved literal dynamic imports and rejects disallowed dynamic and glob usage', () => {
    expect(codes({ ...base, 'app/main.ts': "import('../core/value');" })).toEqual([]);
    expect(codes({ ...base, 'app/main.ts': 'import(name);' })).toContain('nonliteral-dynamic-import');
    expect(codes({ ...base, 'core/bad.ts': "import('../app/main');" })).toContain('forbidden-package-import');
    expect(codes({ ...base, 'app/main.ts': "import.meta.glob('./*.ts');" })).toContain('unapproved-glob');
  });
  it('applies ownership rules to every static TypeScript import form', () => {
    const targets = {
      'core/types.ts': 'export interface Value { value: number; }',
      'core/legacy.ts': 'export const legacy = 1;',
    };
    expect(codes({
      ...base,
      ...targets,
      'app/main.ts': [
        "import type { Value } from '../core/types';",
        "type ImportedValue = import('../core/types').Value;",
        "import legacy = require('../core/legacy');",
        "const required = require('../core/legacy');",
        'void legacy; void required; const value: Value | ImportedValue | undefined = undefined; void value;',
      ].join('\n'),
    })).toEqual([]);

    const violations: Record<string, string> = {
      'core/type-only.ts': "import type { Value } from '../app/main'; type Local = Value;",
      'core/import-type.ts': "type Local = import('../app/main').Value;",
      'core/import-equals.ts': "import app = require('../app/main'); void app;",
      'core/require.ts': "const app = require('../app/main'); void app;",
    };
    for (const [file, content] of Object.entries(violations)) {
      expect(codes({ ...base, ...targets, [file]: content })).toContain('forbidden-package-import');
    }
  });
  it('rejects package, barrel, mock target, test-support, external and cycle violations', () => {
    expect(codes({ ...base, 'core/bad.ts': "import '../app/main';" })).toContain('forbidden-package-import');
    expect(codes({ ...base, 'core/index.ts': "export * from '../app/main';" })).toContain('cross-package-reexport');
    expect(codes({ ...base, 'app/main.ts': "import '../support/helpers';", 'support/helpers.ts': '' })).toContain('test-role-import');
    expect(codes({ ...base, 'app/main.ts': "vi.mock('../support/helpers');", 'support/helpers.ts': '' })).toContain('test-role-import');
    expect(codes({ ...base, 'core/bad.ts': "import React from 'react';" })).toContain('forbidden-external');
    expect(codes({ ...base, 'core/a.ts': "import './b';", 'core/b.ts': "import './a';" })).toContain('dependency-cycle');
  });
  it('limits global CSS to bootstrap importers', () => {
    const local = { ...policy, styles: [{ files: /^app\/site\.css$/, kind: 'global' as const, importers: ['app/main.ts'] }] };
    expect(codes({ ...base, 'app/site.css': 'body { margin: 0; }', 'app/main.ts': "import './site.css';" }, local)).toEqual([]);
    for (const css of ['h1 { margin: 0; }', '* { box-sizing: border-box; }', '@font-face { font-family: x; src: url(x); }', '.plain { color: red; }']) {
      expect(codes({ ...base, 'app/site.css': css, 'app/feature.ts': "import './site.css';" }, local)).toContain('global-css');
    }
  });
  it('requires exactly one explicit stylesheet classification', () => {
    const missing = { ...policy, styles: [] };
    expect(codes({ ...base, 'app/site.css': '.component {}' }, missing)).toContain('missing-style-classification');
    const multiple = { ...policy, styles: [{ files: /\.css$/, kind: 'scoped' as const }, { files: /^app\//, kind: 'global' as const, importers: ['app/main.ts'] }] };
    expect(codes({ ...base, 'app/site.css': '.component {}' }, multiple)).toContain('multiple-style-classification');
  });
  it('rejects CSS imports and invalid, unowned, and cross-package assets', () => {
    const invalid = codes({ ...base, 'app/site.css': "@import './x.css'; .x { background: url('../core/value.ts'); }" });
    expect(invalid).toContain('css-import');
    expect(invalid).toContain('invalid-css-asset');
    expect(codes({ ...base, 'app/site.css': ".x { background: url('../../outside.png'); }" })).toContain('invalid-css-asset');
    expect(codes({ ...base, 'app/site.css': ".x { src: url('../loose/font.woff'); }", 'loose/font.woff': 'font' })).toContain('unowned-css-asset');
    expect(codes({ ...base, 'app/site.css': ".x { background: url('../test/logo.svg'); }", 'test/logo.svg': '<svg />' })).toContain('forbidden-package-import');
    expect(codes({ ...base, 'app/site.css': ".x { background: url('../assets/logo.svg'); }" })).toEqual([]);
  });
  it('rejects resolved source escapes and symlink traversal', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-outside-')); temporary.push(outside);
    fs.writeFileSync(path.join(outside, 'outside.ts'), 'export const outside = 1;');
    fs.writeFileSync(path.join(outside, 'secret.ts'), 'export const secret = 1;');
    expect(fixture({ ...base, 'app/main.ts': "import './linked';" }, policy, { 'app/linked.ts': path.join(outside, 'outside.ts') }).diagnostics.map((item) => item.code)).toContain('source-escape');
    expect(fixture({ ...base, 'app/main.ts': "import '@outside/secret';" }, { ...policy, owners: policy.owners.map((owner) => owner.name === 'app' ? { ...owner, external: ['@outside/secret'] } : owner) }, {}, { '@outside/*': [`../${path.basename(outside)}/*`] }).diagnostics.map((item) => item.code)).toContain('source-escape');
  });
  it('keeps exact tool trees outside the owned inventory', () => {
    const result = fixture({ ...base, 'node_modules/dependency.ts': '', 'dist/output.ts': '', 'coverage/report.json': '{}' });
    expect(result.files).not.toContain('node_modules/dependency.ts');
    expect(result.files).not.toContain('dist/output.ts');
    expect(result.files).not.toContain('coverage/report.json');
    expect(result.diagnostics.map((item) => item.code)).not.toContain('unowned-file');
    expect(codes({ ...base, 'unknown/file.ts': '' })).toContain('unowned-file');
  });
  it('rejects imports and CSS URLs that target excluded tool trees', () => {
    const tools = { ...base, 'node_modules/dependency.ts': 'export {};', 'dist/generated.ts': 'export {};', 'node_modules/logo.svg': '<svg />' };
    expect(codes({ ...tools, 'app/main.ts': "import '../node_modules/dependency';" })).toContain('source-escape');
    expect(fixture({ ...tools, 'app/main.ts': "import '@dependency/dependency';" }, policy, {}, { '@dependency/*': ['node_modules/*'] }).diagnostics.map((item) => item.code)).toContain('source-escape');
    expect(codes({ ...tools, 'app/main.ts': "import '../dist/generated';" })).toContain('source-escape');
    expect(codes({ ...tools, 'app/site.css': ".x { background: url('../node_modules/logo.svg'); }" })).toContain('invalid-css-asset');
  });
  it('rejects unreferenced source and directory symlinks during inventory', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-outside-')); temporary.push(outside);
    fs.writeFileSync(path.join(outside, 'escape.ts'), 'export {};');
    expect(fixture(base, policy, { 'app/escape.ts': path.join(outside, 'escape.ts') }).diagnostics.map((item) => item.code)).toContain('source-escape');
    expect(fixture(base, policy, { 'app/broken.ts': path.join(outside, 'missing.ts') }).diagnostics.map((item) => item.code)).toContain('invalid-symlink');
    expect(fixture(base, policy, { 'app/linked.ts': '../core/value.ts', 'app/linked-directory': '../core' }).diagnostics.map((item) => item.code)).toContain('symlink-traversal');
    expect(fixture({ ...base, 'node_modules/dep.ts': '' }, policy, { 'app/dependency.ts': '../node_modules/dep.ts' }).diagnostics.map((item) => item.code)).toContain('source-escape');
  });
  it('rejects restoration of the removed workbook facade', () => {
    const local: ArchitecturePolicy = { ...policy, forbiddenFiles: ['src/workbook.ts'], owners: [...policy.owners, { name: 'legacy', files: /^src\//, role: 'production' }] };
    expect(codes({ ...base, 'src/workbook.ts': 'export {};' }, local)).toContain('forbidden-file');
  });
});
