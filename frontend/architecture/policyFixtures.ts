import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach } from 'vitest';
import { analyzeArchitecture } from './analyzer';
import { frontendPolicy } from './policy';

const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

export function diagnostics(files: Record<string, string>) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-policy-'));
  temporary.push(repo);
  const root = path.join(repo, 'frontend');
  const contents = {
    'tsconfig.json': JSON.stringify({ compilerOptions: { moduleResolution: 'bundler', resolveJsonModule: true, baseUrl: 'src', paths: { '@grid/*': ['grid/*'], '@workspace/*': ['workspace/*'] } } }),
    '../test-fixtures/workbook-read-contract.json': '{}',
    ...files,
  };
  for (const [file, content] of Object.entries(contents)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return analyzeArchitecture({ rootDir: root, tsconfigPath: path.join(root, 'tsconfig.json'), policy: frontendPolicy }).diagnostics;
}
