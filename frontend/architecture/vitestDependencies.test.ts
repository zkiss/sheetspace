// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { diagnostics } from './policyFixtures';
import { typescriptDependencies } from './typescriptDependencies';

const file = 'src/grid/SheetGrid.test.tsx';
const moduleMethods = ['mock', 'doMock', 'importActual', 'importMock', 'unmock', 'doUnmock'];
const allowedTarget = '@grid/SheetGrid';
const forbiddenTarget = '../../architecture/analyzer';
const targets = { 'src/grid/SheetGrid.tsx': 'export {};', 'architecture/analyzer.ts': 'export {};' };
const forms = [
  ['named vi', "import { vi } from 'vitest';", 'vi.METHOD'],
  ['named vitest', "import { vitest } from 'vitest';", 'vitest.METHOD'],
  ['aliased vi', "import { vi as testing } from 'vitest';", 'testing.METHOD'],
  ['aliased vitest', "import { vitest as testing } from 'vitest';", 'testing.METHOD'],
  ['namespace vi', "import * as testing from 'vitest';", 'testing.vi.METHOD'],
  ['namespace vitest', "import * as testing from 'vitest';", 'testing.vitest.METHOD'],
  ['namespace bracket', "import * as testing from 'vitest';", 'testing["vi"]["METHOD"]'],
  ['global vi', '', 'vi.METHOD'],
  ['global vitest', '', 'vitest.METHOD'],
  ['static bracket', "import { vi } from 'vitest';", 'vi["METHOD"]'],
] as const;

describe('Vitest module target boundaries', () => {
  // Registry methods are checked conservatively even though unmock/doUnmock do
  // not load modules. Promise overloads are traversed as dynamic imports below.
  it.each(moduleMethods)('checks allowed and forbidden %s targets for every supported receiver', (method) => {
    for (const [name, setup, receiver] of forms) {
      const call = receiver.replace('METHOD', method);
      expect(diagnostics({ ...targets, [file]: `${setup} ${call}('${allowedTarget}');` }), name).toEqual([]);
      expect(diagnostics({ ...targets, [file]: `${setup} ${call}('${forbiddenTarget}');` }), name)
        .toEqual([expect.objectContaining({ code: 'forbidden-package-import', file })]);
    }
  });

  it.each(['mock', 'doMock', 'unmock', 'doUnmock'])('checks promise overloads for %s', (method) => {
    expect(diagnostics({ ...targets, [file]: `import { vi } from 'vitest'; vi.${method}(import('${allowedTarget}'));` })).toEqual([]);
    expect(diagnostics({ ...targets, [file]: `import { vi } from 'vitest'; vi.${method}(import('${forbiddenTarget}'));` }))
      .toEqual([expect.objectContaining({ code: 'forbidden-package-import', file })]);
  });

  it.each([
    "const object = { mock() {} }; object.mock('TARGET');",
    "import { vi } from 'vitest'; vi.mocked('TARGET');",
    "const vi = { doMock() {} }; vi.doMock('TARGET');",
    "function local(vi: any) { vi.doMock('TARGET'); }",
    "import { vi } from 'vitest'; function local(vi: any) { vi.doMock('TARGET'); }",
    "import * as testing from 'vitest'; function local(testing: any) { testing.vi.doMock('TARGET'); }",
    "import { vi } from '@grid/SheetGrid'; vi.doMock('TARGET');",
  ])('ignores unrelated methods and shadowed receivers: %s', (source) => {
    expect(diagnostics({ ...targets, [file]: source.replace('TARGET', forbiddenTarget) })).toEqual([]);
  });

  it('routes template targets, excluded/outside paths, test roles and externals through normal checks', () => {
    const cases = [
      ['`@grid/SheetGrid`', {}, undefined],
      ["'../../dist/generated'", { 'dist/generated.ts': '' }, 'source-escape'],
      ["'../../node_modules/hidden'", { 'node_modules/hidden.ts': '' }, 'source-escape'],
      ["'../../missing'", {}, 'unresolved-import'],
      ["'../../../outside'", { '../outside.ts': '' }, 'source-escape'],
      ["'../workspace/other.test'", { 'src/workspace/other.test.ts': '' }, 'forbidden-package-import'],
      ["'react'", {}, undefined],
      ["'forbidden-library'", {}, 'forbidden-external'],
    ] as const;
    for (const [target, extra, code] of cases) {
      const result = diagnostics({ ...targets, ...extra, [file]: `import { vi } from 'vitest'; vi.importActual(${target});` });
      expect(result, target).toEqual(code ? [expect.objectContaining({ code, file })] : []);
    }
  });

  it('applies exact test-data and production test-role restrictions to non-hoisted mocks', () => {
    const source = "vi.doMock('../../../../test-fixtures/workbook-read-contract.json');";
    expect(diagnostics({ 'src/infrastructure/persistence/workbookApi.test.ts': source })).toEqual([]);
    const other = 'src/infrastructure/persistence/other.test.ts';
    expect(diagnostics({ [other]: source })).toEqual([expect.objectContaining({ code: 'test-data-import', file: other })]);
    const production = 'src/app/View.tsx';
    expect(diagnostics({ [production]: "vi.doMock('../test-support/helper');", 'src/test-support/helper.ts': '' }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'test-role-import', file: production })]));
  });

  it('deduplicates equivalent requests and leaves runtime module names uninterpreted', () => {
    expect(typescriptDependencies('/test.ts', "vi.doMock(import('./value')); vi.importActual('./value'); vi.mock(name);"))
      .toEqual([{ kind: 'import', specifier: './value' }]);
  });
});
