import { lstat, readdir, readFile } from 'node:fs/promises';
import { isUtf8 } from 'node:buffer';
import { relative, resolve, sep } from 'node:path';

export const MAX_LINES = 500;
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.kt', '.kts', '.css', '.sql', '.html']);
const ignoredDirectories = new Set(['.git', '.gradle', 'node_modules', 'build', 'coverage', 'dist', '.vite']);
const ignoredFiles = new Set(['backend/gradlew']);

function extension(path) {
  const dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.slice(dot).toLowerCase();
}

export function countPhysicalLines(contents) {
  if (contents.length === 0) return 0;
  const lines = contents.split(/\r\n|\n|\r/).length;
  return /\r\n$|\n$|\r$/.test(contents) ? lines - 1 : lines;
}

async function isSourceFile(path, relativePath) {
  if (sourceExtensions.has(extension(path))) return true;
  if (ignoredFiles.has(relativePath)) return false;
  return (await lstat(path)).mode & 0o111 ? true : false;
}

function isTextFile(contents) {
  return !contents.includes(0) && isUtf8(contents);
}

export async function validateSourceLines(root = process.cwd()) {
  const absoluteRoot = resolve(root);
  const errors = [];
  const violations = [];

  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      errors.push(`${relative(absoluteRoot, directory) || '.'}: ${error.message}`);
      return;
    }
    for (const entry of entries) {
      const path = `${directory}${sep}${entry.name}`;
      const relativePath = relative(absoluteRoot, path);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(path);
        continue;
      }
      if (!entry.isFile() || !(await isSourceFile(path, relativePath))) continue;
      try {
        const contents = await readFile(path);
        if (!isTextFile(contents)) continue;
        const lines = countPhysicalLines(contents.toString('utf8'));
        if (lines > MAX_LINES) violations.push({ path: relativePath, lines });
      } catch (error) {
        errors.push(`${relativePath}: ${error.message}`);
      }
    }
  }

  try {
    const rootEntry = await lstat(absoluteRoot);
    if (!rootEntry.isDirectory()) throw new Error('not a directory');
    await visit(absoluteRoot);
  } catch (error) {
    errors.push(`${absoluteRoot}: ${error.message}`);
  }
  return { violations, errors };
}

export async function run(root = process.cwd(), output = console.error) {
  const { violations, errors } = await validateSourceLines(root);
  for (const violation of violations) output(`${violation.path}: ${violation.lines} lines (maximum ${MAX_LINES})`);
  for (const error of errors) output(`Unable to scan ${error}`);
  return violations.length === 0 && errors.length === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await run(process.argv[2]);
}
