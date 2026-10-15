import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const frontend = join(repository, 'frontend');
const eslint = join(frontend, 'node_modules', 'eslint', 'bin', 'eslint.js');

function lines(count) {
  return Array.from({ length: count }, (_, index) => `const line${index} = ${index};`).join('\n');
}

function write(project, path, contents) {
  const target = join(project, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function lint(project) {
  return spawnSync(process.execPath, [eslint, '..'], {
    cwd: join(project, 'frontend'),
    encoding: 'utf8',
  });
}

function lintProject(t) {
  const project = mkdtempSync(join(tmpdir(), 'sheetspace-eslint-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  mkdirSync(join(project, 'frontend'));
  cpSync(join(repository, 'eslint.config.js'), join(project, 'eslint.config.js'));
  cpSync(join(frontend, 'package.json'), join(project, 'frontend', 'package.json'));
  symlinkSync(join(frontend, 'node_modules'), join(project, 'frontend', 'node_modules'), 'dir');
  return project;
}

test('ESLint max-lines accepts 500 counted lines and parses TSX', t => {
  const project = lintProject(t);
  write(project, 'frontend/src/within-limit.ts', lines(500));
  write(project, 'frontend/src/Component.tsx', 'export const Component = () => <main />;');

  const result = lint(project);

  assert.equal(result.status, 0, result.stderr);
});

test('ESLint max-lines reports an authored tooling file with its count and limit', t => {
  const project = lintProject(t);
  write(project, 'tools/too-big.mjs', lines(501));

  const result = lint(project);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /tools\/too-big\.mjs/);
  assert.match(result.stdout, /File has too many lines \(501\)\. Maximum allowed is 500/);
});

test('ESLint skips blank and comment-only lines but counts lines with code', t => {
  const project = lintProject(t);
  const skipped = `${lines(499)}\n\n// a whole-line comment\nconst finalLine = true; // an inline comment`;
  write(project, 'build-tests/line-count.test.mjs', skipped);

  assert.equal(lint(project).status, 0);

  write(project, 'build-tests/line-count.test.mjs', `${skipped}\nconst oneTooMany = true;`);
  const result = lint(project);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /File has too many lines \(501\)\. Maximum allowed is 500/);
});

test('ESLint discovers authored build tooling and ignores only generated outputs and dependencies', t => {
  const project = lintProject(t);
  write(project, 'build-tests/new-test.mjs', lines(501));
  write(project, 'build/authored-tool.mjs', lines(501));
  write(project, 'build/authored-tool.ts', lines(501));
  write(project, 'frontend/scripts/build/tool.cjs', lines(501));
  write(project, 'tools/dist/tool.mjs', lines(501));
  write(project, 'tools/coverage/tool.ts', lines(501));
  write(project, 'frontend/dist/bundle.mjs', lines(501));
  write(project, 'frontend/coverage/report.mjs', lines(501));
  write(project, 'backend/build/generated.mjs', lines(501));
  write(project, 'backend/.gradle/cache.mjs', lines(501));
  write(project, 'backend/src/main/resources/static/generated.mjs', lines(501));
  write(project, 'backend/src/main/resources/static/assets/bundle.mjs', lines(501));
  write(project, 'node_modules/generated/index.mjs', lines(501));

  const result = lint(project);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  for (const path of [
    'build-tests/new-test.mjs',
    'build/authored-tool.mjs',
    'build/authored-tool.ts',
    'frontend/scripts/build/tool.cjs',
    'tools/dist/tool.mjs',
    'tools/coverage/tool.ts',
  ]) {
    assert.match(result.stdout, new RegExp(path.replace('.', '\\.')));
    write(project, path, lines(500));
  }
  assert.doesNotMatch(result.stdout, /frontend\/dist|frontend\/coverage|backend\/build|backend\/\.gradle|resources\/static|node_modules\/generated/);
  assert.equal(lint(project).status, 0);
});
