import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSandbox } from './support.mjs';

const checkedAssets = ['lint', 'architecture', 'typescript', 'vite'];
const composite = ['orchestration-tests', 'backend-lint', 'backend-test', 'backend-compile', 'lint', 'coverage', 'typescript', 'vite', 'sync'];

for (const goals of [
  ['build'], ['-j2', 'build'], ['compile', 'frontend-dist'],
  ['-j2', 'frontend-dist', 'compile'], ['-j2', 'frontend-dist', 'compile', 'test'],
  ['-j2', 'compile', 'build', 'test', 'frontend-dist'],
]) {
  test(`root make ${goals.join(' ')} shares work and publishes only this invocation's assets`, t => {
    const sandbox = buildSandbox(t);
    const result = sandbox.run(['make', ...goals]);
    assert.equal(result.status, 0, result.output);
    const testsRequested = goals.includes('build') || goals.includes('test');
    assert.deepEqual(result.stages, testsRequested ? composite : ['backend-lint', 'backend-compile', ...checkedAssets, 'sync']);
    assert.equal(sandbox.published(), result.generation);
  });
}

for (const [command, directory, stages] of [
  [['make', 'compile'], '', ['backend-lint', 'backend-compile', ...checkedAssets]],
  [['make', 'frontend-dist'], '', ['backend-lint', ...checkedAssets, 'sync']],
  [['make', 'test'], '', ['orchestration-tests', 'backend-lint', 'backend-test', 'lint', 'coverage']],
  [['make', 'compile'], 'frontend', checkedAssets],
  [['make', '-j2', 'compile', 'test'], 'frontend', ['lint', 'coverage', 'typescript', 'vite']],
  [['npm', 'run', 'build'], 'frontend', checkedAssets],
  [['npm', 'run', 'check:architecture'], 'frontend', ['architecture']],
]) {
  test(`${directory || 'root'} ${command.join(' ')} works without generated artifacts`, t => {
    const sandbox = buildSandbox(t);
    const result = sandbox.run(command, { directory });
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(result.stages, stages);
    assert.equal(sandbox.published(), stages.includes('sync') ? result.generation : undefined);
  });
}

for (const stage of ['orchestration-tests', 'backend-lint', 'backend-test', 'backend-compile', 'lint', 'coverage', 'typescript', 'vite']) {
  test(`parallel composite failure in ${stage} prevents dependent stages and publication`, t => {
    const sandbox = buildSandbox(t);
    const result = sandbox.run(['make', '-j2', 'build'], { fail: stage });
    assert.notEqual(result.status, 0, result.output);
    assert.deepEqual(result.stages, composite.slice(0, composite.indexOf(stage) + 1));
    assert.equal(sandbox.published(), undefined);
  });
}

for (const stage of checkedAssets) {
  test(`standalone ${stage} failure cannot publish old dist or reuse previous assurance`, t => {
    const sandbox = buildSandbox(t);
    const initial = sandbox.run(['make', 'build']);
    assert.equal(initial.status, 0, initial.output);
    const failed = sandbox.run(['make', '-j2', 'frontend-dist'], { fail: stage });
    assert.notEqual(failed.status, 0, failed.output);
    assert.deepEqual(failed.stages, ['backend-lint', ...checkedAssets.slice(0, checkedAssets.indexOf(stage) + 1)]);
    assert.equal(sandbox.published(), initial.generation);
    const later = sandbox.run(['make', 'frontend-dist']);
    assert.equal(later.status, 0, later.output);
    assert.deepEqual(later.stages, ['backend-lint', ...checkedAssets, 'sync']);
    assert.equal(sandbox.published(), later.generation);
  });
}

test('distribution synchronization failure propagates to the root build', t => {
  const sandbox = buildSandbox(t);
  const result = sandbox.run(['make', 'build'], { fail: 'sync' });
  assert.notEqual(result.status, 0, result.output);
  assert.deepEqual(result.stages, composite);
  assert.equal(sandbox.published(), undefined);
});

for (const [goals, expectedStages] of [
  [['test'], ['orchestration-tests', 'backend-lint', 'backend-test', 'lint']],
  [['compile'], ['backend-lint', 'backend-compile', 'lint']],
  [['frontend-dist'], ['backend-lint', 'lint']],
  [['-j2', 'build'], ['orchestration-tests', 'backend-lint', 'backend-test', 'backend-compile', 'lint']],
]) {
  test(`root make ${goals.join(' ')} stops on an over-limit authored JavaScript source during linting`, t => {
    const sandbox = buildSandbox(t);
    const result = sandbox.run(['make', ...goals], { overLimit: true });
    assert.notEqual(result.status, 0, result.output);
    assert.deepEqual(result.stages, expectedStages);
    assert.match(result.output, /tools\/TooBig\.mjs: File has too many lines \(501\)\. Maximum allowed is 500/);
    assert.equal(sandbox.published(), undefined);
  });
}

for (const goals of [['test'], ['compile'], ['frontend-dist'], ['build']]) {
  test(`root make ${goals.join(' ')} rejects an over-limit non-JavaScript source before publication`, t => {
    const sandbox = buildSandbox(t);
    const result = sandbox.run(['make', ...goals], { overLimitNonJs: true });
    assert.notEqual(result.status, 0, result.output);
    assert.deepEqual(result.stages, ['test', 'build'].includes(goals[0]) ? ['orchestration-tests', 'backend-lint'] : ['backend-lint']);
    assert.match(result.output, /TooBig\.kt:1: File length is 501 lines \(max allowed is 500\)/);
    assert.equal(sandbox.published(), undefined);
  });
}

test('backend standalone test and compile reject an over-limit non-JavaScript source', t => {
  const sandbox = buildSandbox(t);
  for (const goal of ['test', 'compile']) {
    const result = sandbox.run(['make', goal], { directory: 'backend', overLimitNonJs: true });
    assert.notEqual(result.status, 0, result.output);
    assert.deepEqual(result.stages, ['backend-lint']);
  }
});
