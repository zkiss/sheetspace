import { describe, expect, it } from 'vitest';

type SourceMap = Readonly<Record<string, string>>;
type DomainLayer = 'core' | 'read' | 'formula' | 'mutations';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { eager: boolean; query: string; import: string }): Record<string, unknown>;
  }
}

const sourceEntries = import.meta.glob('../src/**/*.{ts,tsx}', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const sources: SourceMap = Object.fromEntries(Object.entries(sourceEntries)
  .map(([path, source]) => [moduleName(path.slice('../src/'.length)), source]));
const domainModules = Object.keys(sources).filter((module) => domainLayer(module) !== undefined && !/\.test$/.test(module));

describe('workbook architecture', () => {
  it('does not restore the removed workbook facade through any source kind', () => {
    expect(sources.workbook).toBeUndefined();

    for (const [file, source] of Object.entries(sources)) {
      const removedFacadeImports = importSpecifiers(source)
        .filter((specifier) => resolveRelativeModule(file, specifier) === 'workbook');
      expect(removedFacadeImports, file).toEqual([]);
    }
  });

  it('keeps every workbook domain module inside its package and dependency layer', () => {
    for (const module of domainModules) {
      expect(forbiddenDependenciesFor(module, sources), module).toEqual([]);
    }
  });

  it('keeps the workbook domain dependency graph acyclic', () => {
    expect(findCycle(dependencyGraph(sources, domainModules))).toBeUndefined();
  });

  it('rejects representative package escapes, upward dependencies, and circular graphs', () => {
    const boundaryFixtures = {
      'workbook/core/address': "import '../.@application/react/useWorkbookController';",
      'workbook/core/model': "import React from 'react';",
      'workbook/core/cellIdentity': "import '../../workbookApi';",
      'workbook/read/queries': "import '../.@workspace/SheetFrame';",
      'workbook/read/calculationProjection': "import '../mutations/operations';",
      'workbook/formula/syntax': "import '../mutations/operations';",
      'workbook/formula/reference': "import '../../workbookOutbox';",
      'workbook/mutations/operations': "import React from 'react';",
    };
    const cycleFixture = {
      'workbook/core/alpha': "import './beta';",
      'workbook/core/beta': "import './alpha';",
    };

    for (const module of Object.keys(boundaryFixtures)) {
      expect(forbiddenDependenciesFor(module, boundaryFixtures), module).not.toEqual([]);
    }
    expect(findCycle(dependencyGraph(cycleFixture, Object.keys(cycleFixture))))
      .toEqual(['workbook/core/alpha', 'workbook/core/beta', 'workbook/core/alpha']);
  });
});

function moduleName(path: string): string {
  return path.replace(/\.[jt]sx?$/, '').replace(/\\/g, '/');
}

function importSpecifiers(source: string): string[] {
  return Array.from(source.matchAll(/\b(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g), (match) => match[1]!);
}

function importsFor(module: string, sourceMap: SourceMap): string[] {
  const source = sourceMap[module];
  if (source === undefined) throw new Error(`Expected source module ${module}`);
  return importSpecifiers(source);
}

function forbiddenDependenciesFor(module: string, sourceMap: SourceMap): string[] {
  const moduleSet = new Set(Object.keys(sourceMap).filter((candidate) => domainLayer(candidate) !== undefined));
  const fromLayer = domainLayer(module);
  if (!fromLayer) throw new Error(`Expected workbook domain module ${module}`);

  return importsFor(module, sourceMap).filter((specifier) => {
    const dependency = resolveRelativeModule(module, specifier);
    if (!dependency || !moduleSet.has(dependency)) return true;
    const dependencyLayer = domainLayer(dependency);
    return !dependencyLayer || layerRank(dependencyLayer) > layerRank(fromLayer);
  });
}

function domainLayer(module: string): DomainLayer | undefined {
  const match = /^workbook\/(core|read|formula|mutations)\//.exec(module);
  return match?.[1] as DomainLayer | undefined;
}

function layerRank(layer: DomainLayer): number {
  return ['core', 'read', 'formula', 'mutations'].indexOf(layer);
}

function dependencyGraph(sourceMap: SourceMap, modules: readonly string[]): Map<string, string[]> {
  const set = new Set(modules);
  return new Map(modules.map((module) => [module, importsFor(module, sourceMap)
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
