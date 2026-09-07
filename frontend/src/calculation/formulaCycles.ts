import type { FormulaDependencyGraph } from '@calculation/formulaDependencies';

/**
 * Finds formula cells that belong to a dependency cycle or transitively depend
 * on one. Traversal is iterative so workbook-sized chains cannot overflow the
 * JavaScript call stack.
 */
export function cycleAffectedFormulaNodes(
  graph: FormulaDependencyGraph,
): Set<string> {
  const formulas = new Set(graph.dependencies.keys());
  const finishOrder = dependencyFinishOrder(graph, formulas);
  const cycleMembers = new Set<string>();
  const assigned = new Set<string>();

  for (let index = finishOrder.length - 1; index >= 0; index -= 1) {
    const start = finishOrder[index];
    if (assigned.has(start)) {
      continue;
    }

    const component: string[] = [];
    const pending = [start];
    assigned.add(start);
    while (pending.length > 0) {
      const nodeId = pending.pop()!;
      component.push(nodeId);
      for (const dependent of sortedFormulaNeighbors(
        graph.dependents.get(nodeId),
        formulas,
      )) {
        if (!assigned.has(dependent)) {
          assigned.add(dependent);
          pending.push(dependent);
        }
      }
    }

    const isCycle = component.length > 1
      || (graph.dependencies.get(component[0])?.has(component[0]) ?? false);
    if (isCycle) {
      component.forEach((nodeId) => cycleMembers.add(nodeId));
    }
  }

  return dependentFormulaClosure(cycleMembers, graph, formulas);
}

function dependencyFinishOrder(
  graph: FormulaDependencyGraph,
  formulas: ReadonlySet<string>,
): string[] {
  const visited = new Set<string>();
  const finishOrder: string[] = [];

  for (const start of [...formulas].sort()) {
    if (visited.has(start)) {
      continue;
    }

    visited.add(start);
    const stack = [{
      nodeId: start,
      neighbors: sortedFormulaNeighbors(graph.dependencies.get(start), formulas),
      nextIndex: 0,
    }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const neighbor = frame.neighbors[frame.nextIndex];
      if (neighbor !== undefined) {
        frame.nextIndex += 1;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push({
            nodeId: neighbor,
            neighbors: sortedFormulaNeighbors(graph.dependencies.get(neighbor), formulas),
            nextIndex: 0,
          });
        }
        continue;
      }

      finishOrder.push(frame.nodeId);
      stack.pop();
    }
  }

  return finishOrder;
}

function dependentFormulaClosure(
  starts: ReadonlySet<string>,
  graph: FormulaDependencyGraph,
  formulas: ReadonlySet<string>,
): Set<string> {
  const affected = new Set(starts);
  const pending = [...starts].sort();
  while (pending.length > 0) {
    const nodeId = pending.pop()!;
    for (const dependent of sortedFormulaNeighbors(graph.dependents.get(nodeId), formulas)) {
      if (!affected.has(dependent)) {
        affected.add(dependent);
        pending.push(dependent);
      }
    }
  }
  return affected;
}

function sortedFormulaNeighbors(
  neighbors: ReadonlySet<string> | undefined,
  formulas: ReadonlySet<string>,
): string[] {
  return [...(neighbors ?? [])]
    .filter((nodeId) => formulas.has(nodeId))
    .sort();
}
