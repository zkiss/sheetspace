import { describe, expect, it } from 'vitest';

type SourceMap = Readonly<Record<string, string>>;

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { eager: boolean; query: string; import: string }): Record<string, unknown>;
  }
}

const sourceEntries = import.meta.glob('./**/*.{ts,tsx}', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const sources: SourceMap = Object.fromEntries(Object.entries(sourceEntries)
  .map(([path, source]) => [moduleName(path.slice(2)), source]));
const tsxModules = new Set(Object.keys(sourceEntries)
  .filter((path) => path.endsWith('.tsx'))
  .map((path) => moduleName(path.slice(2))));
const domainModules = [
  'cellAddress',
  'workbookModel',
  'stableCellIdentity',
  'workbookQueries',
  'calculationProjection',
  'formulaSyntax',
  'formulaReference',
  'workbookOperations',
] as const;
const lowerLevelModules = ['cellAddress', 'workbookModel', 'stableCellIdentity'] as const;
const readOnlyModules = ['workbookQueries', 'calculationProjection'] as const;

describe('workbook architecture', () => {
  it('does not restore the removed workbook facade through any source kind', () => {
    expect(sources.workbook).toBeUndefined();

    for (const [file, source] of Object.entries(sources)) {
      expect(importSpecifiers(source), file).not.toContainEqual(expect.stringMatching(/(?:^|\/)workbook(?:\.[cm]?[jt]sx?)?$/));
    }
  });

  it('keeps every workbook domain module independent of UI, controllers, and transports', () => {
    for (const module of domainModules) {
      const forbidden = importsFor(module, sources).filter((specifier) => isForbiddenLayer(specifier, module, sources));
      expect(forbidden, `${module} imports forbidden layers`).toEqual([]);
    }
  });

  it('keeps model and identity modules independent of UI, controllers, transports, and mutations', () => {
    for (const module of lowerLevelModules) {
      const forbidden = importsFor(module, sources).filter((specifier) => isForbiddenLowerDependency(specifier, module, sources));
      expect(forbidden, `${module} imports forbidden layers`).toEqual([]);
    }
  });

  it('keeps read-only queries and projections independent of mutations', () => {
    for (const module of readOnlyModules) {
      expect(importsFor(module, sources).some((specifier) => resolveRelativeModule(module, specifier) === 'workbookOperations'), module).toBe(false);
    }
  });

  it('keeps the workbook domain dependency graph acyclic', () => {
    expect(findCycle(dependencyGraph(sources, domainModules))).toBeUndefined();
  });

  it('rejects representative forbidden dependencies and circular graphs', () => {
    const forbiddenLayerFixture = {
      cellAddress: "import React from 'react';",
      workbookModel: "import './useWorkbookController';",
      stableCellIdentity: "import './workbookApi';",
      workbookQueries: "import React from 'react';",
      calculationProjection: "import './workbookOutbox';",
      formulaSyntax: "import './workbookPersistenceCoordinator';",
      formulaReference: "import './useWorkbookController';",
      workbookOperations: "import React from 'react';",
    };
    const mutationFixture = {
      cellAddress: "import { renameSheet } from './workbookOperations';",
      workbookModel: "import { renameSheet } from './workbookOperations';",
      stableCellIdentity: "import { renameSheet } from './workbookOperations';",
      workbookQueries: "import { renameSheet } from './workbookOperations';",
      calculationProjection: "import { renameSheet } from './workbookOperations';",
      workbookOperations: '',
    };
    const cycleFixture = {
      alpha: "import './beta';",
      beta: "import './alpha';",
    };

    for (const module of domainModules) {
      expect(importsFor(module, forbiddenLayerFixture)
        .some((specifier) => isForbiddenLayer(specifier, module, forbiddenLayerFixture)), module).toBe(true);
    }
    for (const module of lowerLevelModules) {
      expect(importsFor(module, mutationFixture)
        .some((specifier) => isForbiddenLowerDependency(specifier, module, mutationFixture)), module).toBe(true);
    }
    for (const module of readOnlyModules) {
      expect(importsFor(module, mutationFixture)
        .some((specifier) => resolveRelativeModule(module, specifier) === 'workbookOperations'), module).toBe(true);
    }
    expect(findCycle(dependencyGraph(cycleFixture, ['alpha', 'beta']))).toEqual(['alpha', 'beta', 'alpha']);
  });
});

function moduleName(path: string): string {
  return path.replace(/\.[jt]sx?$/, '').replace(/\\/g, '/');
}

function importSpecifiers(source: string): string[] {
  return Array.from(source.matchAll(/\b(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g), (match) => match[1]!);
}

function importsFor(module: string, sources: SourceMap): string[] {
  const source = sources[module];
  if (source === undefined) throw new Error(`Expected source module ${module}`);
  return importSpecifiers(source);
}

function isForbiddenLowerDependency(specifier: string, fromModule: string, sources: SourceMap): boolean {
  return resolveRelativeModule(fromModule, specifier) === 'workbookOperations' || isForbiddenLayer(specifier, fromModule, sources);
}

function isForbiddenLayer(specifier: string, fromModule: string, sources: SourceMap): boolean {
  if (specifier === 'react' || specifier.startsWith('react/')) return true;
  const resolved = resolveRelativeModule(fromModule, specifier);
  if (!resolved) return false;
  return resolved.startsWith('use') || /(?:^|\/)(?:workbookApi|workbookOutbox|workbookPersistenceCoordinator)$/.test(resolved) || isTsxModule(resolved, sources);
}

function isTsxModule(module: string, sources: SourceMap): boolean {
  return sources[module] !== undefined && tsxModules.has(module);
}

function dependencyGraph(sources: SourceMap, modules: readonly string[]): Map<string, string[]> {
  const set = new Set(modules);
  return new Map(modules.map((module) => [module, importsFor(module, sources)
    .map((specifier) => resolveRelativeModule(module, specifier))
    .filter((dependency): dependency is string => dependency !== null && set.has(dependency))]));
}

function resolveRelativeModule(fromModule: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = fromModule.split('/');
  base.pop();
  for (const part of specifier.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') base.pop();
    else base.push(part.replace(/\.[cm]?[jt]sx?$/, ''));
  }
  return base.join('/');
}

function findCycle(graph: ReadonlyMap<string, readonly string[]>): string[] | undefined {
  const visited = new Set<string>();
  const active: string[] = [];
  const visit = (module: string): string[] | undefined => {
    const cycleStart = active.indexOf(module);
    if (cycleStart >= 0) return [...active.slice(cycleStart), module];
    if (visited.has(module)) return undefined;
    active.push(module);
    for (const dependency of graph.get(module) ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    active.pop();
    visited.add(module);
    return undefined;
  };
  for (const module of graph.keys()) {
    const cycle = visit(module);
    if (cycle) return cycle;
  }
  return undefined;
}
