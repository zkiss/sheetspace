import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const reports = {
  backend: resolve(repositoryRoot, 'backend/build/reports/jacoco/test/jacocoTestReport.xml'),
  frontend: resolve(repositoryRoot, 'frontend/coverage/coverage-final.json'),
};

function fail(message) {
  throw new Error(`Coverage report validation failed: ${message}`);
}

function readReport(name) {
  const path = reports[name];
  if (!existsSync(path)) fail(`${name} report is missing at ${relative(repositoryRoot, path)}`);
  return readFileSync(path, 'utf8');
}

function attributes(fragment) {
  return Object.fromEntries([...fragment.matchAll(/([a-z]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
}

function verifyBackend() {
  const xml = readReport('backend');
  if (!xml.includes('<report ') || !xml.includes('</report>')) fail('backend JaCoCo XML is malformed');

  const packages = [...xml.matchAll(/<package name="([^"]+)">([\s\S]*?)<\/package>/g)];
  const sourceFiles = packages.flatMap(([, packageName, body]) =>
    [...body.matchAll(/<sourcefile name="([^"]+)"(?:>|\/>)(([\s\S]*?)<\/sourcefile>)?/g)]
      .map(([, sourceName, , sourceBody]) => ({ packageName, sourceName, sourceBody: sourceBody ?? '' }))
  );
  if (sourceFiles.length === 0) fail('backend JaCoCo XML has no source files');

  let hasLocationAndCounter = false;
  for (const { packageName, sourceName, sourceBody } of sourceFiles) {
    const sourcePath = resolve(repositoryRoot, 'backend/src/main/kotlin', packageName, sourceName);
    if (!existsSync(sourcePath)) fail(`backend JaCoCo source does not map to a project file: ${packageName}/${sourceName}`);
    const lines = [...sourceBody.matchAll(/<line\s+([^/>]+)\/>/g)].map(([, fragment]) => attributes(fragment));
    if (lines.some((line) => line.nr && (line.mi !== undefined || line.mb !== undefined))) hasLocationAndCounter = true;
  }
  if (!hasLocationAndCounter) fail('backend JaCoCo XML has no line locations with missed-instruction or missed-branch counters');
}

function verifyFrontend() {
  let coverage;
  try {
    coverage = JSON.parse(readReport('frontend'));
  } catch (error) {
    fail(`frontend Istanbul JSON is malformed (${error.message})`);
  }
  const entries = Object.entries(coverage);
  if (entries.length === 0) fail('frontend Istanbul JSON has no covered source files');

  let hasLocationAndCounter = false;
  for (const [sourcePath, fileCoverage] of entries) {
    if (typeof fileCoverage !== 'object' || fileCoverage === null) fail(`frontend coverage entry is invalid: ${sourcePath}`);
    const absoluteSourcePath = resolve(sourcePath);
    if (!absoluteSourcePath.startsWith(`${resolve(repositoryRoot, 'frontend/src')}/`) || !existsSync(absoluteSourcePath)) {
      fail(`frontend coverage source does not map to a project file: ${sourcePath}`);
    }
    const statements = Object.entries(fileCoverage.statementMap ?? {});
    const statementCounts = fileCoverage.s ?? {};
    const branches = Object.entries(fileCoverage.branchMap ?? {});
    const branchCounts = fileCoverage.b ?? {};
    if (statements.some(([id, location]) => location.start?.line && Number.isFinite(statementCounts[id]))) hasLocationAndCounter = true;
    if (branches.some(([id, location]) => location.loc?.start?.line && Array.isArray(branchCounts[id]))) hasLocationAndCounter = true;
  }
  if (!hasLocationAndCounter) fail('frontend Istanbul JSON has no statement or branch locations with counters');
}

verifyBackend();
verifyFrontend();
console.log('Coverage reports verified: backend JaCoCo XML and frontend Istanbul JSON.');
