import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const backend = join(repository, 'backend');

function lines(count) {
  return Array.from({ length: count }, (_, index) => `line ${index}`).join('\n');
}

function write(root, path, contents, executable = false) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
  if (executable) chmodSync(target, 0o755);
}

function lint(root) {
  return spawnSync('./gradlew', ['--quiet', `-PsourceRoot=${root}`, 'checkSourceFileLength'], {
    cwd: backend,
    encoding: 'utf8',
  });
}

test('Checkstyle FileLength checks working-tree non-JS source and excludes generated artifacts', t => {
  const root = mkdtempSync(join(tmpdir(), 'sheetspace-checkstyle-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, 'backend/src/main/kotlin/WithinLimit.kt', lines(500));
  write(root, 'frontend/src/within-limit.ts', lines(501));
  assert.equal(lint(root).status, 0);

  write(root, 'backend/src/main/kotlin/TooBig.kt', lines(501));
  write(root, 'frontend/src/app/TooBig.css', `/* counted */\n\n${lines(499)}`);
  write(root, 'tools/new-executable', lines(501), true);
  write(root, 'build/authored.kts', lines(501));
  write(root, 'tools/dist/authored.css', lines(501));
  write(root, 'tools/coverage/authored.sql', lines(501));
  for (const path of [
    'docs/ignored.css', 'frontend/dist/ignored.css', 'frontend/coverage/ignored.css',
    'backend/build/ignored.kt', 'backend/.gradle/ignored.css',
    'backend/src/main/resources/static/ignored.html', 'frontend/node_modules/ignored.css',
    'backend/gradlew',
  ]) write(root, path, lines(501), path === 'backend/gradlew');

  const result = lint(root);

  const output = result.stdout + result.stderr;
  assert.equal(result.status, 1, output);
  for (const path of ['TooBig.kt', 'TooBig.css', 'new-executable', 'authored.kts', 'authored.css', 'authored.sql']) {
    assert.match(output, new RegExp(path.replace('.', '\\.')));
  }
  assert.match(output, /File length is 501 lines \(max allowed is 500\)/);
  assert.doesNotMatch(output, /ignored\.(css|html|kt)|backend\/gradlew/);
});
