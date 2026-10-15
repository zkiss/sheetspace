// @vitest-environment node
import * as path from 'node:path';
import { expect, it } from 'vitest';
import { analyzeArchitecture } from './analyzer';
import { frontendPolicy } from './policy';

it('enforces complete frontend ownership and dependency policy with no exceptions', () => {
  const rootDir = path.resolve('.');
  const result = analyzeArchitecture({ rootDir, tsconfigPath: path.join(rootDir, 'tsconfig.json'), policy: frontendPolicy });
  expect(result.files.length).toBeGreaterThan(100);
  expect(result.diagnostics).toEqual([]);
});
