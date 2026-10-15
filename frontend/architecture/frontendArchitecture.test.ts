// @vitest-environment node
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { analyzeArchitecture } from './analyzer';
import { frontendPolicy } from './policy';

it('enforces complete frontend ownership and dependency policy with no exceptions', () => {
  const rootDir = path.resolve('.');
  const result = analyzeArchitecture({ rootDir, tsconfigPath: path.join(rootDir, 'tsconfig.json'), policy: frontendPolicy });
  expect(result.files.length).toBeGreaterThan(100);
  expect(result.diagnostics).toEqual([]);
});

it('enforces the repository authored-source line limit', () => {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  execFileSync('node', [path.join(repositoryRoot, 'tools/check-source-lines.mjs')], {
    cwd: repositoryRoot,
    stdio: 'pipe',
  });
});
