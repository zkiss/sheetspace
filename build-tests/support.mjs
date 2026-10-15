import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repository = dirname(dirname(fileURLToPath(import.meta.url)));

// Execute the real Makefiles and npm scripts against cheap command boundaries.
// Every sandbox starts without dist, caches, dependencies or success markers.
export function buildSandbox(t) {
  const root = mkdtempSync(join(tmpdir(), 'sheetspace-build-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ['frontend', 'backend', 'bin', 'tools']) mkdirSync(join(root, directory));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  for (const file of ['Makefile', 'eslint.config.js', 'frontend/Makefile', 'frontend/package.json', 'frontend/architecture/frontendArchitecture.test.ts', 'backend/Makefile', 'tools/check-source-lines.mjs']) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(join(repository, file), join(root, file));
  }
  const commands = `#!${process.execPath}
import { appendFileSync, readFileSync, mkdirSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { basename } from 'node:path';
import { spawnSync } from 'node:child_process';
const tool = basename(process.argv[1], '.mjs');
const args = process.argv.slice(2);
if (tool === 'npm') {
  const script = JSON.parse(readFileSync('package.json')).scripts[args[1]];
  if (!script) process.exit(2);
  process.exit(spawnSync(script, { shell: true, stdio: 'inherit' }).status ?? 1);
}
const stage = {
  vitest: args.includes('--coverage') ? 'coverage' : 'architecture',
  eslint: 'lint', tsc: 'typescript', vite: 'vite', node: 'orchestration-tests',
  gradlew: args.includes('build') ? 'backend-compile' : args.includes('test') ? 'backend-test' : 'sync',
}[tool];
if (!stage) process.exit(2);
// Reject overlapping work even when start events happen to be ordered correctly.
const active = process.env.BUILD_TRACE + '.active';
closeSync(openSync(active, 'wx'));
appendFileSync(process.env.BUILD_TRACE, stage + '\\n');
// Overlap would reorder stages or publish before a failed prerequisite finishes.
await new Promise(resolve => setTimeout(resolve, 30));
if (process.env.FAIL_STAGE === stage) process.exit(7);
if (tool === 'eslint' && process.env.OVER_LIMIT) {
  console.error('tools/TooBig.mjs: File has too many lines (501). Maximum allowed is 500');
  process.exit(7);
}
// The Vitest boundary models the selected architecture suite. Its source owns
// the policy command, so removing that test or its invocation disables this
// simulated check just as it would in the real architecture command.
const architecturePolicy = tool === 'vitest'
  && (() => {
    const architectureTest = readFileSync('architecture/frontendArchitecture.test.ts', 'utf8');
    return architectureTest.includes("it('enforces the repository authored-source line limit'")
      && architectureTest.includes("tools/check-source-lines.mjs")
      && architectureTest.includes("'inherit'");
  })();
if (architecturePolicy && spawnSync(process.execPath, ['tools/check-source-lines.mjs'], { cwd: '..', stdio: 'inherit' }).status !== 0) process.exit(7);
if (stage === 'vite') {
  mkdirSync('dist', { recursive: true });
  writeFileSync('dist/bundle', process.env.BUILD_GENERATION);
}
if (stage === 'sync') {
  const dist = readFileSync('../frontend/dist/bundle', 'utf8');
  if (dist !== process.env.BUILD_GENERATION) throw new Error('stale distribution');
  writeFileSync('published', dist);
}
unlinkSync(active);
`;
  // npm's shell resolves these PATH shims; gradlew is a relative executable.
  for (const tool of ['npm', 'eslint', 'vitest', 'tsc', 'vite', 'node']) {
    writeFileSync(join(root, 'bin', tool), commands, { mode: 0o755 });
  }
  writeFileSync(join(root, 'backend', 'gradlew'), commands, { mode: 0o755 });
  let generation = 0;
  return {
    run(command, { directory = '', fail = '', overLimit = false } = {}) {
      const trace = join(root, 'trace');
      writeFileSync(trace, '');
      if (overLimit) {
        mkdirSync(join(root, 'tools'), { recursive: true });
        writeFileSync(join(root, 'tools', 'TooBig.mjs'), 'x\n'.repeat(501));
      }
      rmSync(trace + '.active', { force: true });
      generation += 1;
      const result = spawnSync(command[0], command.slice(1), {
        cwd: join(root, directory), encoding: 'utf8', timeout: 15_000,
        env: {
          ...process.env,
          // Do not inherit an enclosing make's goals, flags or jobserver.
          MAKEFLAGS: '', MFLAGS: '', MAKELEVEL: '0',
          PATH: `${join(root, 'bin')}:${process.env.PATH}`,
          BUILD_TRACE: trace, FAIL_STAGE: fail, OVER_LIMIT: overLimit ? '1' : '', BUILD_GENERATION: String(generation),
        },
      });
      if (result.error) throw result.error;
      return {
        status: result.status,
        output: result.stdout + result.stderr,
        stages: readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean),
        generation: String(generation),
      };
    },
    published() {
      const path = join(root, 'backend', 'published');
      return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
    },
  };
}
