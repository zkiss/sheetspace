// @vitest-environment node
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeArchitecture } from './analyzer';
import { frontendPolicy } from './policy';

const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function diagnostics(files: Record<string, string>) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-policy-'));
  temporary.push(repo);
  const root = path.join(repo, 'frontend');
  const contents = {
    'tsconfig.json': JSON.stringify({ compilerOptions: { moduleResolution: 'bundler', resolveJsonModule: true, baseUrl: 'src', paths: { '@grid/*': ['grid/*'], '@workspace/*': ['workspace/*'] } } }),
    '../test-fixtures/workbook-read-contract.json': '{}',
    ...files,
  };
  for (const [file, content] of Object.entries(contents)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return analyzeArchitecture({ rootDir: root, tsconfigPath: path.join(root, 'tsconfig.json'), policy: frontendPolicy }).diagnostics;
}

describe('final frontend policy', () => {
  it('fails closed for root files, unknown subtrees, and removed facades', () => {
    for (const file of ['src/new.ts', 'src/workbook.ts', 'src/appTypes.ts', 'src/grid/unknown/module.ts', 'src/workbook/new/module.ts']) {
      expect(diagnostics({ [file]: '' }).map(({ code }) => code), file).toContain('unowned-file');
    }
  });

  it.each([
    ['src/workbook/core/new.ts', 'src/workbook/read/new.ts'],
    ['src/workbook/read/new.ts', 'src/workbook/formula/new.ts'],
    ['src/workbook/formula/new.ts', 'src/workbook/mutations/new.ts'],
    ['src/calculation/new.ts', 'src/application/core/new.ts'],
    ['src/application/react/new.ts', 'src/grid/SheetGrid.tsx'],
    ['src/workspace/new.tsx', 'src/grid/SheetGrid.tsx'],
    ['src/grid/new.tsx', 'src/infrastructure/persistence/new.ts'],
    ['src/reference-navigation/new.tsx', 'src/grid/SheetGrid.tsx'],
    ['src/grid/gridGeometry.ts', 'src/workspace/SheetFrame.tsx'],
    ['src/workspace/workspaceGeometry.ts', 'src/workspace/SheetFrame.tsx'],
  ])('rejects forbidden type edges from %s to %s', (from, to) => {
    const relative = path.relative(path.dirname(from), to).replace(/\\/g, '/');
    expect(diagnostics({ [from]: `import type { Value } from './${relative}';`, [to]: 'export type Value = string;' }).map(({ code }) => code)).toContain('forbidden-package-import');
  });

  it('applies the same rules to aliased CSS, assets, and production type cycles', () => {
    expect(diagnostics({ 'src/workspace/View.tsx': "import '@grid/View.css';", 'src/grid/View.css': '.view {}' }).map(({ code }) => code)).toContain('forbidden-package-import');
    expect(diagnostics({ 'src/workspace/View.tsx': "import '@grid/icon.svg';", 'src/grid/icon.svg': '<svg />' }).map(({ code }) => code)).toContain('forbidden-package-import');
    expect(diagnostics({ 'src/grid/View.tsx': "import '@grid/View.css';", 'src/grid/View.css': '.view {}' })).toEqual([]);
    expect(diagnostics({ 'src/workbook/core/a.ts': "import type { B } from './b'; export type A = B;", 'src/workbook/core/b.ts': "import type { A } from './a'; export type B = A;" }).map(({ code }) => code)).toContain('dependency-cycle');
  });

  it('limits React, react-dom and virtualization to their permitted owners', () => {
    for (const directory of ['workbook/core', 'calculation', 'application/core', 'infrastructure/persistence']) {
      expect(diagnostics({ [`src/${directory}/new.ts`]: "import 'react';" }).map(({ code }) => code)).toContain('forbidden-external');
    }
    expect(diagnostics({ 'src/grid/gridGeometry.ts': "import 'react';" }).map(({ code }) => code)).toContain('forbidden-external');
    expect(diagnostics({ 'src/app/View.tsx': "import 'react-dom/client';" }).map(({ code }) => code)).toContain('forbidden-external');
    expect(diagnostics({ 'src/workspace/View.tsx': "import '@tanstack/react-virtual';" }).map(({ code }) => code)).toContain('forbidden-external');
    expect(diagnostics({ 'src/app/main.tsx': "import 'react-dom/client';", 'src/grid/View.tsx': "import '@tanstack/react-virtual';" })).toEqual([]);
  });

  it('reserves the shared contract fixture for its exact API test', () => {
    const contractImport = "import data from '../../../../test-fixtures/workbook-read-contract.json';";
    expect(diagnostics({ 'src/infrastructure/persistence/workbookApi.test.ts': contractImport })).toEqual([]);
    expect(diagnostics({ 'src/infrastructure/persistence/workbookApi.ts': contractImport }).map(({ code }) => code)).toContain('test-data-import');
    expect(diagnostics({ 'src/infrastructure/persistence/other.test.ts': contractImport }).map(({ code }) => code)).toContain('test-data-import');
    expect(diagnostics({ 'src/infrastructure/persistence/workbookApi.test.ts': "export { default } from '../../../../test-fixtures/workbook-read-contract.json';" }).map(({ code }) => code)).toContain('cross-package-reexport');
    expect(diagnostics({ 'src/infrastructure/persistence/workbookApi.test.ts': "import '../../../../test-fixtures/other.json';", '../test-fixtures/other.json': '{}' }).map(({ code }) => code)).toContain('source-escape');
  });

  it('keeps production out of test support and test modules, and tests out of tooling', () => {
    expect(diagnostics({ 'src/app/View.tsx': "import '../test-support/helper';", 'src/test-support/helper.ts': '' }).map(({ code }) => code)).toContain('test-role-import');
    expect(diagnostics({ 'src/app/View.tsx': "import './View.test';", 'src/app/View.test.ts': '' }).map(({ code }) => code)).toContain('test-role-import');
    expect(diagnostics({ 'src/app/View.test.ts': "import '../../architecture/analyzer';", 'architecture/analyzer.ts': '' }).map(({ code }) => code)).toContain('forbidden-package-import');
  });
});
