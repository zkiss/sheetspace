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

export interface ArchitecturePolicy {
  owners: readonly Owner[];
  /** Global styles may only be imported by these files (relative to rootDir). */
  globalStyles?: readonly string[];
  /** Files allowed to use import.meta.glob. */
  globFiles?: readonly string[];
  /** Test-data files intentionally outside their owner's normal pattern. */
  exactTestData?: readonly string[];
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

export function analyzeArchitecture(options: AnalysisOptions): AnalysisResult {
  const root = real(options.rootDir);
  const config = ts.readConfigFile(options.tsconfigPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(options.tsconfigPath));
  const files = enumerate(root);
  const diagnostics: Diagnostic[] = [];
  const owners = new Map<string, Owner>();
  const graph = new Map<string, string[]>();
  const report = (code: string, file: string, message: string) => diagnostics.push({ code, file, message });

  for (const file of files) {
    const rel = relative(root, file);
    const matches = options.policy.owners.filter((owner) => owner.files.test(rel));
    if (options.policy.exactTestData?.includes(rel) && matches.length === 0) matches.push({ name: 'exact-test-data', files: /$^/, role: 'test-data', external: [] });
    if (matches.length !== 1) report(matches.length ? 'multiple-owner' : 'unowned-file', rel, `${rel} has ${matches.length} owners`);
    else owners.set(file, matches[0]!);
    if (options.policy.forbiddenFiles?.includes(rel)) report('forbidden-file', rel, `${rel} is forbidden`);
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
      if (!resolved) {
        if (!request.specifier!.startsWith('.') && !path.isAbsolute(request.specifier!)) {
          if (!fromOwner?.external?.includes(packageName(request.specifier!))) report('forbidden-external', rel, `${request.specifier} is not allowed for ${fromOwner?.name ?? 'an unowned file'}`);
        } else report('unresolved-import', rel, `cannot resolve ${request.specifier}`);
        continue;
      }
      if (!request.specifier!.startsWith('.') && !path.isAbsolute(request.specifier!) && !inside(root, resolved)) {
        if (!fromOwner?.external?.includes(packageName(request.specifier!))) report('forbidden-external', rel, `${request.specifier} is not allowed for ${fromOwner?.name ?? 'an unowned file'}`);
        continue;
      }
      if (!inside(root, resolved)) {
        report('source-escape', rel, `${request.specifier} resolves outside the source tree`);
        continue;
      }
      const targetOwner = owners.get(resolved);
      if (!targetOwner) continue;
      if (fromOwner?.role === 'production' && targetOwner.role !== 'production') report('test-role-import', rel, `production cannot import ${targetOwner.role}`);
      if (fromOwner && targetOwner && fromOwner.name !== targetOwner.name && !fromOwner.mayImport?.includes(targetOwner.name)) report('forbidden-package-import', rel, `${fromOwner.name} cannot import ${targetOwner.name}`);
      if (request.kind === 'reexport' && fromOwner && targetOwner && fromOwner.name !== targetOwner.name) report('cross-package-reexport', rel, 'barrels may only re-export their own package');
      edges.push(resolved);
    }
    graph.set(file, edges);
  }

  for (const file of files.filter((candidate) => path.extname(candidate) === '.css')) analyzeCss(file, root, owners, options.policy, report, graph);
  const cycle = cycleIn(graph, owners);
  if (cycle) report('dependency-cycle', relative(root, cycle[0]!), cycle.map((item) => relative(root, item)).join(' -> '));
  return { diagnostics, files: files.map((file) => relative(root, file)) };
}

function enumerate(root: string): string[] {
  const visit = (dir: string): string[] => (fs.readdirSync(dir, { withFileTypes: true }) as Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>).flatMap((entry) => {
    const candidate = path.join(dir, entry.name);
    if (entry.isDirectory()) return visit(candidate);
    if (!entry.isFile() || !sourceExtensions.has(path.extname(entry.name).toLowerCase())) return [];
    return [real(candidate)];
  });
  return visit(root).sort();
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

function analyzeCss(file: string, root: string, owners: ReadonlyMap<string, Owner>, policy: ArchitecturePolicy, report: (code: string, file: string, message: string) => void, graph: Map<string, string[]>): void {
  const rel = relative(root, file);
  const text = fs.readFileSync(file, 'utf8');
  if (/^\s*@import\b/m.test(text)) report('css-import', rel, 'CSS @import is not supported');
  const edges = graph.get(file) ?? [];
  for (const match of text.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)) {
    const specifier = match[2]!.trim();
    if (!specifier || remoteUrl.test(specifier)) continue;
    const target = realIfExists(path.resolve(path.dirname(file), specifier));
    if (!target || !inside(root, target)) { report('invalid-css-asset', rel, `invalid local url ${specifier}`); continue; }
    if (!assetExtensions.has(path.extname(target).toLowerCase())) { report('invalid-css-asset', rel, `unsupported local url ${specifier}`); continue; }
    const sourceOwner = owners.get(file);
    const targetOwner = owners.get(target);
    if (!targetOwner) { report('unowned-css-asset', rel, `local url ${specifier} has no owner`); continue; }
    if (sourceOwner && targetOwner && sourceOwner.name !== targetOwner.name && !sourceOwner.mayImport?.includes(targetOwner.name)) report('forbidden-package-import', rel, `${sourceOwner.name} cannot use ${targetOwner.name} asset`);
    edges.push(target);
  }
  graph.set(file, edges);
  if (/(?:^|\n)\s*(?:html|body|:root)\b/.test(text)) {
    for (const [importer, imports] of graph) {
      if (imports.includes(file) && !policy.globalStyles?.includes(relative(root, importer))) report('global-css', relative(root, importer), `${rel} global CSS may only be imported by app bootstrap`);
    }
  }
}

function resolveRequest(from: string, specifier: string, compilerOptions: ts.CompilerOptions): string | undefined {
  const resolution = ts.resolveModuleName(specifier, from, compilerOptions, ts.sys).resolvedModule?.resolvedFileName;
  if (resolution) return realIfExists(resolution);
  if (specifier.startsWith('.') || path.isAbsolute(specifier)) {
    const direct = path.resolve(path.dirname(from), specifier);
    for (const candidate of [direct, ...['.css', ...assetExtensions].map((extension) => `${direct}${extension}`), path.join(direct, 'index.css')]) {
      const found = realIfExists(candidate);
      if (found) return found;
    }
  }
  return undefined;
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
function relative(root: string, file: string): string { return path.relative(root, file).replace(/\\/g, '/'); }
