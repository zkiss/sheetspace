import {
  cellKey,
  expandRange,
} from './cellAddress';
import type {
  CalculationCellChange,
  CalculationProjection,
  CalculationSheet,
} from './calculationProjection';
import { sheetCellNodeId } from './formulaEvaluator';
import {
  collectFormulaReferences,
  parseFormula,
  type FormulaReference,
} from './formulaSyntax';

export type FormulaDependencyGraph = {
  readonly dependencies: ReadonlyMap<string, ReadonlySet<string>>;
  readonly dependents: ReadonlyMap<string, ReadonlySet<string>>;
};

export function emptyFormulaDependencyGraph(): FormulaDependencyGraph {
  return {
    dependencies: new Map(),
    dependents: new Map(),
  };
}

export function buildFormulaDependencyGraph(
  projection: CalculationProjection,
): FormulaDependencyGraph {
  const formulaChanges: CalculationCellChange[] = [];
  for (const sheet of projection.sheets) {
    for (const [key, raw] of Object.entries(sheet.cells)) {
      if (raw.startsWith('=')) {
        formulaChanges.push({ sheetId: sheet.id, key });
      }
    }
  }
  return updateFormulaDependencyGraph(
    emptyFormulaDependencyGraph(),
    projection,
    formulaChanges,
  );
}

/**
 * Replaces edges only for changed cells. Callers remain responsible for using
 * both old and new graphs when calculating affected dependents.
 */
export function updateFormulaDependencyGraph(
  graph: FormulaDependencyGraph,
  projection: CalculationProjection,
  changes: readonly CalculationCellChange[],
): FormulaDependencyGraph {
  const dependencies = cloneAdjacencyMap(graph.dependencies);
  const dependents = cloneAdjacencyMap(graph.dependents);
  const sheetsById = new Map(projection.sheets.map((sheet) => [sheet.id, sheet]));
  const changedNodes = new Set<string>();

  for (const change of changes) {
    const formulaNode = sheetCellNodeId(change.sheetId, change.key);
    if (changedNodes.has(formulaNode)) {
      continue;
    }
    changedNodes.add(formulaNode);
    removeFormulaEdges(formulaNode, dependencies, dependents);

    const currentSheet = sheetsById.get(change.sheetId);
    const raw = currentSheet?.cells[change.key];
    if (!currentSheet || !raw?.startsWith('=')) {
      continue;
    }

    const parsed = parseFormula(raw);
    const nextDependencies = parsed.kind === 'formula'
      ? formulaDependencies(parsed.expression, projection, currentSheet)
      : new Set<string>();
    dependencies.set(formulaNode, nextDependencies);
    for (const dependency of nextDependencies) {
      const formulas = dependents.get(dependency) ?? new Set<string>();
      formulas.add(formulaNode);
      dependents.set(dependency, formulas);
    }
  }

  return { dependencies, dependents };
}

export function dependentClosure(
  changedCells: ReadonlySet<string>,
  previousDependents: ReadonlyMap<string, ReadonlySet<string>>,
  nextDependents: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const impacted = new Set(changedCells);
  const pending = [...changedCells];
  while (pending.length > 0) {
    const nodeId = pending.pop()!;
    const dependents = new Set([
      ...(previousDependents.get(nodeId) ?? []),
      ...(nextDependents.get(nodeId) ?? []),
    ]);
    for (const dependent of dependents) {
      if (!impacted.has(dependent)) {
        impacted.add(dependent);
        pending.push(dependent);
      }
    }
  }
  return impacted;
}

export function formulaNodes(graph: FormulaDependencyGraph): Set<string> {
  return new Set(graph.dependencies.keys());
}

function formulaDependencies(
  expression: Parameters<typeof collectFormulaReferences>[0],
  projection: CalculationProjection,
  currentSheet: CalculationSheet,
): Set<string> {
  const dependencies = new Set<string>();
  for (const reference of collectFormulaReferences(expression)) {
    for (const dependency of referenceDependencies(reference, projection, currentSheet)) {
      dependencies.add(dependency);
    }
  }
  return dependencies;
}

function referenceDependencies(
  reference: FormulaReference,
  projection: CalculationProjection,
  currentSheet: CalculationSheet,
): Set<string> {
  const targetSheet = reference.sheetId
    ? projection.sheets.find((sheet) => sheet.id === reference.sheetId)
    : currentSheet;
  if (!targetSheet) {
    return new Set();
  }
  if (reference.kind === 'cell') {
    return new Set([sheetCellNodeId(targetSheet.id, cellKey(reference.address))]);
  }

  const addresses = expandRange(reference.range, targetSheet);
  return addresses.ok
    ? new Set(addresses.value.map((address) => sheetCellNodeId(targetSheet.id, cellKey(address))))
    : new Set();
}

function removeFormulaEdges(
  formulaNode: string,
  dependencies: Map<string, Set<string>>,
  dependents: Map<string, Set<string>>,
): void {
  for (const dependency of dependencies.get(formulaNode) ?? []) {
    const formulas = dependents.get(dependency);
    formulas?.delete(formulaNode);
    if (formulas?.size === 0) {
      dependents.delete(dependency);
    }
  }
  dependencies.delete(formulaNode);
}

function cloneAdjacencyMap(
  source: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, Set<string>> {
  return new Map([...source].map(([nodeId, adjacent]) => [nodeId, new Set(adjacent)]));
}
