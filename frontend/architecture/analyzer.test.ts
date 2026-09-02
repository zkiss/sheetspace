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
};

function fixture(files: Record<string, string>, nextPolicy = policy) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-')); temporary.push(root);
  for (const [name, content] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), content); }
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { moduleResolution: 'bundler', resolveJsonModule: true, baseUrl: '.', paths: { '@core/*': ['core/*'] } } }));
  return analyzeArchitecture({ rootDir: root, tsconfigPath: path.join(root, 'tsconfig.json'), policy: nextPolicy }).diagnostics;
}
const codes = (files: Record<string, string>, nextPolicy?: ArchitecturePolicy) => fixture(files, nextPolicy).map((item) => item.code);
const base = { 'app/main.ts': "import '../core/value';", 'core/value.ts': 'export const value = 1;', 'assets/logo.svg': '<svg />' };

describe('architecture analyzer', () => {
  it('accepts extensions, indexes, JSON aliases, test roles, and exact data ownership', () => {
    const local: ArchitecturePolicy = { ...policy, exactTestData: ['fixtures/workbook-api.json'] };
    expect(codes({ ...base, 'core/index.ts': "export * from './value';", 'core/data.json': '{}', 'app/main.ts': "import '../core'; import data from '@core/data.json'; import '../assets/logo.svg'; void data;", 'test/example.test.ts': "import '../support/helpers';", 'support/helpers.ts': "import '../core/value';", 'fixtures/workbook-api.json': '{}' }, local)).toEqual([]);
  });
  it('rejects ownership, aliases, dynamic imports and unapproved glob calls', () => {
    expect(codes({ ...base, 'loose.ts': '' })).toContain('unowned-file');
    expect(codes({ ...base, 'app/main.ts': "import '@core/value';" })).toEqual([]);
    expect(codes({ ...base, 'app/main.ts': 'import(name);' })).toContain('nonliteral-dynamic-import');
    expect(codes({ ...base, 'core/bad.ts': "import('../app/main');" })).toContain('forbidden-package-import');
    expect(codes({ ...base, 'app/main.ts': "import.meta.glob('./*.ts');" })).toContain('unapproved-glob');
  });
  it('rejects package, barrel, test-support, external and cycle violations', () => {
    expect(codes({ ...base, 'core/bad.ts': "import '../app/main';" })).toContain('forbidden-package-import');
    expect(codes({ ...base, 'core/index.ts': "export * from '../app/main';" })).toContain('cross-package-reexport');
    expect(codes({ ...base, 'app/main.ts': "import '../support/helpers';", 'support/helpers.ts': '' })).toContain('test-role-import');
    expect(codes({ ...base, 'core/bad.ts': "import React from 'react';" })).toContain('forbidden-external');
    expect(codes({ ...base, 'core/a.ts': "import './b';", 'core/b.ts': "import './a';" })).toContain('dependency-cycle');
  });
  it('rejects CSS package crossings, import rules, invalid assets and source escapes', () => {
    expect(codes({ ...base, 'app/site.css': "@import './x.css'; .x { background: url('../core/value.ts'); }" })).toContain('css-import');
    expect(codes({ ...base, 'app/site.css': ".x { background: url('../../outside.png'); }" })).toContain('invalid-css-asset');
    expect(codes({ ...base, 'app/main.ts': "import '../../outside';" })).toContain('unresolved-import');
  });
});
