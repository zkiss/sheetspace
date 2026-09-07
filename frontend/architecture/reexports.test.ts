// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { diagnostics } from './policyFixtures';

const importer = 'src/grid/View.tsx';
const targetSource = 'export const value = 1; export default value; export interface Value { value: number; }';
const exports = [
  ['direct named', "export { value } from 'TARGET';"],
  ['direct star', "export * from 'TARGET';"],
  ['direct namespace', "export * as values from 'TARGET';"],
  ['direct type', "export type { Value } from 'TARGET';"],
  ['named binding', "import { value } from 'TARGET'; export { value };"],
  ['renamed binding and export', "import { value as local } from 'TARGET'; export { local as publicValue };"],
  ['default binding', "import value from 'TARGET'; export { value };"],
  ['namespace binding', "import * as values from 'TARGET'; export { values };"],
  ['type-only clause', "import type { Value } from 'TARGET'; export type { Value };"],
  ['type-only specifier', "import { type Value as Local } from 'TARGET'; export { type Local as Public };"],
  ['import equals binding', "import values = require('TARGET'); export { values };"],
  ['exported import equals', "export import values = require('TARGET');"],
  ['default assignment', "import { value } from 'TARGET'; export default value;"],
  ['equals assignment', "import values = require('TARGET'); export = values;"],
  ['parenthesized default', "import { value } from 'TARGET'; export default (value);"],
] as const;

describe('re-export origin boundaries', () => {
  it.each(exports)('checks same-owner and otherwise importable cross-owner %s', (_name, source) => {
    expect(diagnostics({ [importer]: source.replace('TARGET', '@grid/values'), 'src/grid/values.ts': targetSource })).toEqual([]);
    expect(diagnostics({ [importer]: source.replace('TARGET', '@workspace/workspaceGeometry'), 'src/workspace/workspaceGeometry.ts': targetSource }))
      .toEqual([expect.objectContaining({ code: 'cross-package-reexport', file: importer })]);
  });

  it('retains the exact grid/workspace review reproduction with an allowed import control', () => {
    const source = "import { clampSheetFrameSize } from '@workspace/workspaceGeometry';";
    const target = { 'src/workspace/workspaceGeometry.ts': 'export function clampSheetFrameSize() {}' };
    expect(diagnostics({ ...target, [importer]: source })).toEqual([]);
    expect(diagnostics({ ...target, [importer]: `${source} export { clampSheetFrameSize };` }))
      .toEqual([expect.objectContaining({ code: 'cross-package-reexport', file: importer })]);
  });

  it.each([
    'export function local(value: Value) { return value; }',
    'export interface Local { value: Value; }',
    'export type Local = Value;',
    'export class Local { value?: Value; }',
    'export namespace Local { export const value = 2; export { value as renamed }; }',
  ])('does not mistake local declarations or scoped names for imported exports: %s', (source) => {
    expect(diagnostics({
      [importer]: `import { value, type Value } from '@workspace/workspaceGeometry'; ${source}`,
      'src/workspace/workspaceGeometry.ts': targetSource,
    })).toEqual([]);
  });

  it('rejects indirect export of the exact contract JSON by its permitted importer', () => {
    const file = 'src/infrastructure/persistence/workbookApi.test.ts';
    const source = "import data from '../../../../test-fixtures/workbook-read-contract.json';";
    expect(diagnostics({ [file]: source })).toEqual([]);
    expect(diagnostics({ [file]: `${source} export { data };` }))
      .toEqual([expect.objectContaining({ code: 'cross-package-reexport', file })]);
  });

  it('keeps same-package indirect type barrels in the production cycle graph', () => {
    const result = diagnostics({
      'src/workbook/core/a.ts': "import type { Value } from './barrel'; export interface A { value: Value; }",
      'src/workbook/core/barrel.ts': "import type { Value } from './value'; export type { Value };",
      'src/workbook/core/value.ts': "import type { A } from './a'; export interface Value { a: A; }",
    });
    expect(result).toEqual([expect.objectContaining({ code: 'dependency-cycle', file: 'src/workbook/core/a.ts' })]);
    expect(result[0]!.message).toBe('src/workbook/core/a.ts -> src/workbook/core/barrel.ts -> src/workbook/core/value.ts -> src/workbook/core/a.ts');
  });

  it('does not hide an intermediate barrel crossing a package boundary', () => {
    expect(diagnostics({
      [importer]: "import { value } from './barrel'; export { value };",
      'src/grid/barrel.ts': "import { value } from '@workspace/workspaceGeometry'; export { value };",
      'src/workspace/workspaceGeometry.ts': targetSource,
    })).toEqual([expect.objectContaining({ code: 'cross-package-reexport', file: 'src/grid/barrel.ts' })]);
  });
});
