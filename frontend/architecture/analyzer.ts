import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

export type FileRole = 'production' | 'test' | 'test-support' | 'tooling' | 'test-data';

export interface Owner {
  name: string;
  /** A path relative to rootDir. The first matching owner is not selected: exactly one must match. */
  files: RegExp;
  role: FileRole;
  mayImport?: readonly string[];
  external?: readonly string[];
}

export interface StyleClassification {
  files: RegExp;
  kind: 'global' | 'scoped';
  /** The only modules allowed to import a global stylesheet. */
  importers?: readonly string[];
}

export interface ArchitecturePolicy {
  owners: readonly Owner[];
  /** Exact root-relative tool trees which are not repository-owned source. */
  excludedDirectories?: readonly string[];
  /** Every stylesheet must match exactly one declared architectural classification. */
  styles?: readonly StyleClassification[];
  /** Files allowed to use import.meta.glob. */
  globFiles?: readonly string[];
  /** Exact data files, including shared repository fixtures, and their sole permitted test importers. */
  exactTestData?: readonly { file: string; importers: readonly string[] }[];
  forbiddenFiles?: readonly string[];
}

export interface AnalysisOptions {
  rootDir: string;
  tsconfigPath: string;
  policy: ArchitecturePolicy;
}

export interface Diagnostic {
  code: string;
  file: string;
  message: string;
}

export interface AnalysisResult {
  diagnostics: readonly Diagnostic[];
  files: readonly string[];
}

const assetExtensions = new Set(['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.woff', '.woff2', '.ttf', '.otf']);
const sourceExtensions = new Set(['.ts', '.tsx', '.css', '.json', ...assetExtensions]);
const remoteUrl = /^(?:[a-z]+:|\/\/|#)/i;
type Resolution = { kind: 'local'; file: string } | { kind: 'external'; package: string } | { kind: 'unresolved' };

export function analyzeArchitecture(options: AnalysisOptions): AnalysisResult {
  const root = real(options.rootDir);
  const diagnostics: Diagnostic[] = [];
  const report = (code: string, file: string, message: string) => diagnostics.push({ code, file, message });
  const excluded = excludedDirectories(options.policy.excludedDirectories ?? [], report);
  const inventory = enumerate(root, excluded, report);
  const files = inventory.files;
  const testData = new Map<string, readonly string[]>();
  for (const rule of options.policy.exactTestData ?? []) {
    const candidate = path.resolve(root, rule.file);
    const target = realIfExists(candidate);
    if (!target || target !== candidate || path.extname(target) !== '.json' || testData.has(target)) {
      report('invalid-test-data', rule.file, 'test data must be a distinct, existing JSON file without symlink traversal');
      continue;
    }
    testData.set(target, rule.importers);
    if (!files.includes(target)) files.push(target);
  }
  const fileSet = new Set(files);
  const configPath = realIfExists(options.tsconfigPath);
  if (!configPath || !validateLocalTarget(root, configPath, fileSet, excluded, report, relative(root, options.tsconfigPath), 'tsconfigPath')) {
    return { diagnostics, files: files.map((file) => relative(root, file)) };
  }
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
  const owners = new Map<string, Owner>();
  const graph = new Map<string, string[]>();
  const styles = new Map<string, StyleClassification>();

  for (const file of files) {
    const rel = relative(root, file);
    const matches = options.policy.owners.filter((owner) => owner.files.test(rel));
    if (testData.has(file)) matches.push({ name: 'exact-test-data', files: /$^/, role: 'test-data', external: [] });
    if (matches.length !== 1) report(matches.length ? 'multiple-owner' : 'unowned-file', rel, `${rel} has ${matches.length} owners`);
    else owners.set(file, matches[0]!);
    if (options.policy.forbiddenFiles?.includes(rel)) report('forbidden-file', rel, `${rel} is forbidden`);
    if (path.extname(file) === '.css') {
      const matches = options.policy.styles?.filter((style) => style.files.test(rel)) ?? [];
      if (matches.length !== 1) report(matches.length ? 'multiple-style-classification' : 'missing-style-classification', rel, `${rel} has ${matches.length} style classifications`);
      else styles.set(file, matches[0]!);
    }
  }

  for (const file of files.filter(isCode)) {
    const fromOwner = owners.get(file);
    const rel = relative(root, file);
    const edges: string[] = [];
    for (const request of importsFrom(file)) {
      if (request.kind === 'dynamic-nonliteral') {
        if (fromOwner?.role === 'production') report('nonliteral-dynamic-import', rel, 'production dynamic imports must be literals');
        continue;
      }
      if (request.kind === 'glob') {
        if (!options.policy.globFiles?.includes(rel)) report('unapproved-glob', rel, 'import.meta.glob is not approved here');
        continue;
      }
      const resolved = resolveRequest(file, request.specifier!, parsed.options);
      if (resolved.kind === 'external') {
        if (!fromOwner?.external?.includes(resolved.package)) report('forbidden-external', rel, `${request.specifier} is not allowed for ${fromOwner?.name ?? 'an unowned file'}`);
        continue;
      }
      if (resolved.kind === 'unresolved') {
        report('unresolved-import', rel, `cannot resolve ${request.specifier}`);
        continue;
      }
      const target = resolved.file;
      if (testData.has(target)) {
        if (fromOwner?.role !== 'test' || !testData.get(target)!.includes(rel)) report('test-data-import', rel, `${request.specifier} is reserved for its exact contract test`);
        if (request.kind === 'reexport') report('cross-package-reexport', rel, 'barrels may only re-export their own package');
        continue;
      }
      if (!validateLocalTarget(root, target, fileSet, excluded, report, rel, request.specifier!)) continue;
      const targetOwner = owners.get(target);
      if (!targetOwner) { report('unowned-import', rel, `${request.specifier} has no owner`); continue; }
      if (fromOwner?.role === 'production' && targetOwner.role !== 'production') report('test-role-import', rel, `production cannot import ${targetOwner.role}`);
      if (fromOwner && targetOwner && fromOwner.name !== targetOwner.name && !fromOwner.mayImport?.includes(targetOwner.name)) report('forbidden-package-import', rel, `${fromOwner.name} cannot import ${targetOwner.name}`);
      if (request.kind === 'reexport' && fromOwner && targetOwner && fromOwner.name !== targetOwner.name) report('cross-package-reexport', rel, 'barrels may only re-export their own package');
      if (path.extname(target) === '.css' && styles.get(target)?.kind === 'global' && !styles.get(target)?.importers?.includes(rel)) report('global-css', rel, `${relative(root, target)} global CSS may only be imported by app bootstrap`);
      edges.push(target);
    }
    graph.set(file, edges);
  }

  for (const file of files.filter((candidate) => path.extname(candidate) === '.css')) analyzeCss(file, root, owners, fileSet, excluded, report, graph);
  const cycle = cycleIn(graph, owners);
  if (cycle) report('dependency-cycle', relative(root, cycle[0]!), cycle.map((item) => relative(root, item)).join(' -> '));
  return { diagnostics, files: files.map((file) => relative(root, file)) };
}

function enumerate(root: string, excluded: ReadonlySet<string>, report: (code: string, file: string, message: string) => void): { files: string[] } {
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const candidate = path.join(dir, entry.name);
    const rel = relative(root, candidate);
    if (entry.isSymbolicLink()) {
      const target = realIfExists(candidate);
      if (!target) report('invalid-symlink', rel, `${rel} is a broken symbolic link`);
      else if (!insideOrEqual(root, target) || inExcluded(root, target, excluded)) report('source-escape', rel, `${rel} symbolic link escapes the repository-owned tree`);
      else report('symlink-traversal', rel, `${rel} symbolic links are not allowed`);
      continue;
    }
    if (entry.isDirectory()) { if (!excluded.has(rel)) visit(candidate); continue; }
    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name).toLowerCase())) files.push(real(candidate));
    }
  };
  visit(root);
  return { files: files.sort() };
}

function importsFrom(file: string): Array<{ kind: 'import' | 'reexport' | 'dynamic-nonliteral' | 'glob'; specifier?: string }> {
  const text = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const imports: Array<{ kind: 'import' | 'reexport' | 'dynamic-nonliteral' | 'glob'; specifier?: string }> = [];
  const literal = (node: ts.Expression): string | undefined => ts.isStringLiteralLike(node) ? node.text : undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) imports.push({ kind: ts.isExportDeclaration(node) ? 'reexport' : 'import', specifier: node.moduleSpecifier.text });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) imports.push({ kind: 'import', specifier: node.moduleReference.expression.text });
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) imports.push({ kind: 'import', specifier: node.argument.literal.text });
    else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const value = node.arguments[0] && literal(node.arguments[0]);
        imports.push(value ? { kind: 'import', specifier: value } : { kind: 'dynamic-nonliteral' });
      } else if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'glob' && node.expression.expression.getText(ast) === 'import.meta') imports.push({ kind: 'glob' });
      else if ((node.expression.getText(ast) === 'require' || /(?:^|\.)mock$/.test(node.expression.getText(ast))) && node.arguments[0]) {
        const value = literal(node.arguments[0]);
        if (value) imports.push({ kind: 'import', specifier: value });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return imports;
}

function analyzeCss(file: string, root: string, owners: ReadonlyMap<string, Owner>, fileSet: ReadonlySet<string>, excluded: ReadonlySet<string>, report: (code: string, file: string, message: string) => void, graph: Map<string, string[]>): void {
  const rel = relative(root, file);
  const text = fs.readFileSync(file, 'utf8');
  if (/^\s*@import\b/m.test(text)) report('css-import', rel, 'CSS @import is not supported');
  const edges = graph.get(file) ?? [];
  for (const match of text.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)) {
    const specifier = match[2]!.trim();
    if (!specifier || remoteUrl.test(specifier)) continue;
    const target = realIfExists(path.resolve(path.dirname(file), specifier));
    if (!target || !validateLocalTarget(root, target, fileSet, excluded, report, rel, specifier)) { report('invalid-css-asset', rel, `invalid local url ${specifier}`); continue; }
    if (!assetExtensions.has(path.extname(target).toLowerCase())) { report('invalid-css-asset', rel, `unsupported local url ${specifier}`); continue; }
    const sourceOwner = owners.get(file);
    const targetOwner = owners.get(target);
    if (!targetOwner) { report('unowned-css-asset', rel, `local url ${specifier} has no owner`); continue; }
    if (sourceOwner?.role === 'production' && targetOwner.role !== 'production') report('test-role-import', rel, `production cannot import ${targetOwner.role}`);
    if (sourceOwner && targetOwner && sourceOwner.name !== targetOwner.name && !sourceOwner.mayImport?.includes(targetOwner.name)) report('forbidden-package-import', rel, `${sourceOwner.name} cannot use ${targetOwner.name} asset`);
    edges.push(target);
  }
  graph.set(file, edges);
}

function resolveRequest(from: string, specifier: string, compilerOptions: ts.CompilerOptions): Resolution {
  const resolved = ts.resolveModuleName(specifier, from, compilerOptions, ts.sys).resolvedModule;
  if (resolved) {
    const file = realIfExists(resolved.resolvedFileName);
    if (file) return localIntent(specifier, compilerOptions, file) || !resolved.isExternalLibraryImport ? { kind: 'local', file } : { kind: 'external', package: packageName(specifier) };
  }
  for (const direct of assetCandidates(from, specifier, compilerOptions)) {
    for (const candidate of [direct, ...['.css', ...assetExtensions].map((extension) => `${direct}${extension}`), path.join(direct, 'index.css')]) {
      const found = realIfExists(candidate);
      if (found) return { kind: 'local', file: found };
    }
  }
  return localIntent(specifier, compilerOptions) ? { kind: 'unresolved' } : { kind: 'external', package: packageName(specifier) };
}
function assetCandidates(from: string, specifier: string, options: ts.CompilerOptions): string[] {
  if (specifier.startsWith('.') || path.isAbsolute(specifier)) return [path.resolve(path.dirname(from), specifier)];
  const aliases = Object.entries(options.paths ?? {}).filter(([pattern]) => aliasMatch(specifier, pattern) !== undefined);
  // TypeScript prefers an exact alias, then the matching wildcard with the longest prefix.
  aliases.sort(([a], [b]) => Number(b === specifier) - Number(a === specifier) || b.split('*')[0]!.length - a.split('*')[0]!.length);
  const match = aliases[0];
  if (match) return match[1].map((target) => path.resolve(options.baseUrl ?? path.dirname(from), target.replace('*', aliasMatch(specifier, match[0])!)));
  return options.baseUrl ? [path.resolve(options.baseUrl, specifier)] : [];
}
function aliasMatch(specifier: string, pattern: string): string | undefined {
  if (!pattern.includes('*')) return specifier === pattern ? '' : undefined;
  const [start, end = ''] = pattern.split('*');
  return specifier.startsWith(start!) && specifier.endsWith(end) && specifier.length >= start!.length + end.length
    ? specifier.slice(start!.length, specifier.length - end.length) : undefined;
}
function localIntent(specifier: string, compilerOptions: ts.CompilerOptions, resolvedFile?: string): boolean {
  return specifier.startsWith('.')
    || path.isAbsolute(specifier)
    || matchesPathAlias(specifier, compilerOptions.paths)
    || (Boolean(resolvedFile) && baseUrlTarget(specifier, compilerOptions, resolvedFile!));
}
function baseUrlTarget(specifier: string, compilerOptions: ts.CompilerOptions, resolvedFile: string): boolean {
  if (!compilerOptions.baseUrl || specifier.startsWith('.') || path.isAbsolute(specifier)) return false;
  // A bare package can also live below baseUrl. It is baseUrl-local only when the
  // resolved target is at the path TypeScript would probe from baseUrl directly.
  return insideOrEqual(path.resolve(compilerOptions.baseUrl, specifier), resolvedFile);
}
function matchesPathAlias(specifier: string, paths: ts.MapLike<readonly string[]> | undefined): boolean {
  return Object.keys(paths ?? {}).some((pattern) => aliasMatch(specifier, pattern) !== undefined);
}
function cycleIn(graph: ReadonlyMap<string, readonly string[]>, owners: ReadonlyMap<string, Owner>): string[] | undefined {
  const done = new Set<string>(); const active: string[] = [];
  const visit = (node: string): string[] | undefined => {
    if (owners.get(node)?.role !== 'production') return undefined;
    const index = active.indexOf(node); if (index >= 0) return [...active.slice(index), node];
    if (done.has(node)) return undefined;
    active.push(node);
    for (const edge of graph.get(node) ?? []) { const found = visit(edge); if (found) return found; }
    active.pop(); done.add(node); return undefined;
  };
  for (const node of graph.keys()) { const found = visit(node); if (found) return found; }
  return undefined;
}
function isCode(file: string): boolean { return ['.ts', '.tsx'].includes(path.extname(file)); }
function packageName(specifier: string): string { return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!; }
function real(file: string): string { return fs.realpathSync.native(file); }
function realIfExists(file: string): string | undefined { try { return real(file); } catch { return undefined; } }
function inside(root: string, file: string): boolean { const rel = path.relative(root, file); return rel !== '' && !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel); }
function insideOrEqual(root: string, file: string): boolean { return file === root || inside(root, file); }
function relative(root: string, file: string): string { return path.relative(root, file).replace(/\\/g, '/'); }
function excludedDirectories(entries: readonly string[], report: (code: string, file: string, message: string) => void): Set<string> {
  const result = new Set<string>();
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, '/').replace(/\/$/, '');
    if (!normalized || path.isAbsolute(entry) || normalized.split('/').some((part) => !part || part === '.' || part === '..') || result.has(normalized) || [...result].some((other) => other.startsWith(`${normalized}/`) || normalized.startsWith(`${other}/`))) report('invalid-excluded-directory', entry, `${entry} is not a distinct root-relative directory`);
    else result.add(normalized);
  }
  return result;
}
function inExcluded(root: string, file: string, excluded: ReadonlySet<string>): boolean { const rel = relative(root, file); return [...excluded].some((entry) => rel === entry || rel.startsWith(`${entry}/`)); }
function validateLocalTarget(root: string, target: string, inventory: ReadonlySet<string>, excluded: ReadonlySet<string>, report: (code: string, file: string, message: string) => void, from: string, specifier: string): boolean {
  if (!inside(root, target) || inExcluded(root, target, excluded)) { report('source-escape', from, `${specifier} resolves outside the repository-owned tree`); return false; }
  if (!inventory.has(target)) { report('unowned-import', from, `${specifier} is absent from the repository-owned inventory`); return false; }
  return true;
}
