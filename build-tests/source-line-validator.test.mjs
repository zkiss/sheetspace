import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MAX_LINES, countPhysicalLines, run, validateSourceLines } from '../tools/check-source-lines.mjs';

function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), 'sheetspace-lines-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function write(root, path, contents, executable = false) {
  const target = join(root, path);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, contents);
  if (executable) chmodSync(target, 0o755);
}
const lines = (count, newline = true) => Array.from({ length: count }, (_, index) => String(index)).join('\n') + (newline ? '\n' : '');

test('counts empty, terminated, unterminated, LF, and CRLF physical lines', () => {
  assert.equal(countPhysicalLines(''), 0);
  assert.equal(countPhysicalLines(lines(500)), 500);
  assert.equal(countPhysicalLines(lines(500, false)), 500);
  assert.equal(countPhysicalLines(lines(501).replaceAll('\n', '\r\n')), 501);
});

test('accepts an authored source file with the inclusive 500-line limit', async t => {
  const root = sandbox(t);
  write(root, 'frontend/src/App.tsx', lines(500));
  assert.deepEqual(await validateSourceLines(root), { violations: [], errors: [] });
});

test('includes authored production, test, tooling, and executable source', async t => {
  const root = sandbox(t);
  write(root, 'frontend/src/App.tsx', lines(501));
  write(root, 'frontend/src/App.test.ts', lines(501));
  write(root, 'tools/check.mjs', lines(501));
  write(root, 'bin/check', lines(501), true);
  const result = await validateSourceLines(root);
  assert.deepEqual(result.violations.map(({ path }) => path), ['bin/check', 'frontend/src/App.test.ts', 'frontend/src/App.tsx', 'tools/check.mjs']);
});

test('excludes executable binary artifacts', async t => {
  const root = sandbox(t);
  write(root, 'bin/artifact', Buffer.alloc(1_002, Buffer.from([0, 10])), true);
  assert.deepEqual(await validateSourceLines(root), { violations: [], errors: [] });
});

test('excludes data, documentation, dependencies, generated output, and Gradle wrapper', async t => {
  const root = sandbox(t);
  for (const path of ['docs/guide.md', 'data/example.csv', 'frontend/node_modules/a/index.js', 'frontend/dist/app.js', 'frontend/coverage/report.js', 'backend/build/output.kt', 'backend/gradlew']) write(root, path, lines(501), path === 'backend/gradlew');
  assert.deepEqual(await validateSourceLines(root), { violations: [], errors: [] });
});

test('reports all violations with paths, counts, and the limit', async t => {
  const root = sandbox(t);
  write(root, 'a.ts', lines(501));
  write(root, 'b.css', lines(502));
  const output = [];
  assert.equal(await run(root, message => output.push(message)), 1);
  assert.deepEqual(output, [`a.ts: 501 lines (maximum ${MAX_LINES})`, `b.css: 502 lines (maximum ${MAX_LINES})`]);
});

test('fails clearly when its scan root cannot be read', async () => {
  const output = [];
  assert.equal(await run('/path/that/does/not/exist', message => output.push(message)), 1);
  assert.match(output[0], /Unable to scan/);
});
