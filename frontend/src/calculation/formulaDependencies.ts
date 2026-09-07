import type {
  CalculationCellChange,
  CalculationProjection,
  CalculationSheet,
} from '@workbook/read/calculationProjection';
import { calculationCellKey } from '@workbook/read/calculationProjection';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import { sheetCellNodeId } from './nodeIdentity';
import {
  collectFormulaReferences,
  parseFormula,
  type FormulaReference,
} from '@workbook/formula/syntax';

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
    const currentSheet = sheetsById.get(change.sheetId);
    const changedKey = cellIdentityAt(currentSheet?.rows && currentSheet?.columns ? { kind: 'tabular', rows: [...currentSheet.rows], columns: [...currentSheet.columns], cells: {} } : { kind: 'tabular', rows: [], columns: [], cells: {} }, change.key);
    const formulaNode = sheetCellNodeId(change.sheetId, changedKey ? cellIdentityKey(changedKey) : change.key);
    if (changedNodes.has(formulaNode)) {
      continue;
    }
    changedNodes.add(formulaNode);
    removeFormulaEdges(formulaNode, dependencies, dependents);

    const raw = currentSheet?.cells[changedKey ? cellIdentityKey(changedKey) : change.key];
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
  if (reference.kind === 'cell') return new Set([sheetCellNodeId(targetSheet.id, reference.address.columnIndex >= 0 ? legacyKey(targetSheet, reference.address.rowIndex, reference.address.columnIndex) : '')]);
  if (reference.kind === 'range') {
    const dependencies = new Set<string>();
    for (let row = Math.min(reference.range.start.rowIndex, reference.range.end.rowIndex); row <= Math.max(reference.range.start.rowIndex, reference.range.end.rowIndex); row += 1) for (let column = Math.min(reference.range.start.columnIndex, reference.range.end.columnIndex); column <= Math.max(reference.range.start.columnIndex, reference.range.end.columnIndex); column += 1) dependencies.add(sheetCellNodeId(targetSheet.id, legacyKey(targetSheet, row, column)));
    return dependencies;
  }
  if (!reference.range) {
    const key = calculationCellKey(targetSheet, reference.coordinate);
    return key ? new Set([sheetCellNodeId(targetSheet.id, key)]) : new Set();
  }
  const startRow = targetSheet.rows.indexOf(reference.range.start.rowId), endRow = targetSheet.rows.indexOf(reference.range.end.rowId);
  const startColumn = targetSheet.columns.indexOf(reference.range.start.columnId), endColumn = targetSheet.columns.indexOf(reference.range.end.columnId);
  if (Math.min(startRow, endRow, startColumn, endColumn) < 0) return new Set();
  const dependencies = new Set<string>();
  for (let row = Math.min(startRow, endRow); row <= Math.max(startRow, endRow); row += 1) for (let column = Math.min(startColumn, endColumn); column <= Math.max(startColumn, endColumn); column += 1) dependencies.add(sheetCellNodeId(targetSheet.id, calculationCellKey(targetSheet, { rowId: targetSheet.rows[row]!, columnId: targetSheet.columns[column]! })!));
  return dependencies;
}

function legacyKey(sheet: CalculationSheet, rowIndex: number, columnIndex: number): string {
  if (!sheet.rows || !sheet.columns) {
    return `${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`;
  }
  return calculationCellKey(sheet, { rowId: sheet.rows[rowIndex]!, columnId: sheet.columns[columnIndex]! })!;
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
