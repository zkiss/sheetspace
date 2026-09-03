import { describe, expect, it } from 'vitest';
import type { FormulaDependencyGraph } from '@calculation/formulaDependencies';
import { cycleAffectedFormulaNodes } from '@calculation/formulaCycles';

describe('formula cycles', () => {
  it('finds self and multi-node cycles plus downstream formulas', () => {
    const graph = dependencyGraph({
      self: ['self'],
      first: ['second'],
      second: ['third'],
      third: ['first'],
      downstream: ['second'],
      independent: ['plain'],
    });

    expect(cycleAffectedFormulaNodes(graph)).toEqual(new Set([
      'self',
      'first',
      'second',
      'third',
      'downstream',
    ]));
  });

  it('handles long acyclic chains without recursive traversal', () => {
    const length = 20_000;
    const dependencies: Record<string, string[]> = {};
    for (let index = 0; index < length; index += 1) {
      dependencies[`node-${index}`] = index === 0 ? ['plain'] : [`node-${index - 1}`];
    }

    expect(cycleAffectedFormulaNodes(dependencyGraph(dependencies))).toEqual(new Set());
  });
});

function dependencyGraph(
  dependenciesByNode: Readonly<Record<string, readonly string[]>>,
): FormulaDependencyGraph {
  const dependencies = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  for (const [nodeId, nodeDependencies] of Object.entries(dependenciesByNode)) {
    dependencies.set(nodeId, new Set(nodeDependencies));
    for (const dependency of nodeDependencies) {
      const nodes = dependents.get(dependency) ?? new Set<string>();
      nodes.add(nodeId);
      dependents.set(dependency, nodes);
    }
  }
  return { dependencies, dependents };
}
