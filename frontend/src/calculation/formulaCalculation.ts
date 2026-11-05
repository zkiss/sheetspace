import type {
  CalculationImpact,
  CalculationProjection,
} from '@workbook/read/calculationProjection';
import {
  buildFormulaDependencyGraph,
  dependentClosure,
  emptyFormulaDependencyGraph,
  formulaNodes,
  updateFormulaDependencyGraph,
  storedFormulaParser,
  type FormulaDependencyGraph,
} from '@calculation/formulaDependencies';
import { cycleAffectedFormulaNodes, cycleFormulaNodes } from '@calculation/formulaCycles';
import {
  FormulaEvaluator,
  type FormulaEvaluationObserver,
} from '@calculation/formulaEvaluator';
import { sheetCellNodeId } from './nodeIdentity';
import type {
  FormulaEvaluationSnapshot,
  FormulaScalarValue,
} from '@calculation/formulaValue';
import { formulaDiagnostic, structuralDiagnosticError, type FormulaDiagnostic } from '@calculation/formulaValue';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import { cellIdentityFromKey } from '@workbook/core/cellIdentity';
import type { Workbook } from '@workbook/core/model';
import { collectFormulaReferences, parseFormula } from '@workbook/formula/syntax';
import { builtInFormulaFunctions } from '@calculation/formulaBuiltins';

/**
 * Owns dependency edges and derived values for the calculation projection.
 * Callers explicitly describe content or structure impacts.
 */
export class FormulaCalculation {
  private initialized = false;
  private graph: FormulaDependencyGraph = emptyFormulaDependencyGraph();
  private results = new Map<string, FormulaScalarValue>();
  private snapshot: FormulaEvaluationSnapshot = {};
  private previousProjection?: CalculationProjection;

  diagnostic(sheetId: string, key: string): FormulaDiagnostic | undefined {
    const value = this.results.get(sheetCellNodeId(sheetId, key));
    return value && formulaDiagnostic(value);
  }

  fork(): FormulaCalculation {
    const calculation = new FormulaCalculation();
    calculation.initialized = this.initialized;
    calculation.graph = this.graph;
    calculation.results = new Map(this.results);
    calculation.snapshot = this.snapshot;
    calculation.previousProjection = this.previousProjection;
    return calculation;
  }

  update(
    projection: CalculationProjection,
    impact: CalculationImpact,
    onEvaluate?: FormulaEvaluationObserver,
  ): FormulaEvaluationSnapshot {
    return this.calculate(projection, impact, onEvaluate);
  }

  updateStored(projection: CalculationProjection, workbook: Workbook, impact: CalculationImpact, onEvaluate?: FormulaEvaluationObserver): FormulaEvaluationSnapshot {
    return this.calculate(projection, impact, onEvaluate, storedFormulaParser(workbook));
  }

  private calculate(
    projection: CalculationProjection,
    impact: CalculationImpact,
    onEvaluate?: FormulaEvaluationObserver,
    parse?: ReturnType<typeof storedFormulaParser>,
  ): FormulaEvaluationSnapshot {
    if (impact.kind === 'none' && this.initialized) {
      return this.snapshot;
    }

    const effectiveImpact = !this.initialized || impact.kind === 'none'
      ? { kind: 'structure' } as const
      : impact;
    const previousGraph = this.graph;
    const nextGraph = effectiveImpact.kind === 'structure'
      ? buildFormulaDependencyGraph(projection, parse)
      : updateFormulaDependencyGraph(this.graph, projection, effectiveImpact.cells, parse);
    const nextFormulaNodes = formulaNodes(nextGraph);
    const orderOnly = effectiveImpact.kind === 'structure' && this.previousProjection && isRowOrderOnly(this.previousProjection, projection);
    const impacted = effectiveImpact.kind === 'structure'
      ? orderOnly ? orderImpactedNodes(projection, previousGraph, nextGraph, parse ?? parseFormula) : new Set(nextFormulaNodes)
      : dependentClosure(
          new Set(effectiveImpact.cells.map(({ sheetId, key }) => {
            const sheet = projection.sheets.find((candidate) => candidate.id === sheetId);
            const identity = sheet && cellIdentityAt({ kind: 'tabular', rows: [...sheet.rows], columns: [...sheet.columns], cells: {} }, key);
            return sheetCellNodeId(sheetId, identity ? cellIdentityKey(identity) : key);
          })),
          previousGraph.dependents,
          nextGraph.dependents,
        );
    const reusableResults = new Map(
      [...this.results].filter(([nodeId]) =>
        nextFormulaNodes.has(nodeId) && !impacted.has(nodeId),
      ),
    );
    const cycleMembers = cycleFormulaNodes(nextGraph);
    const affected = cycleAffectedFormulaNodes(nextGraph);
    const nodes = new Map([...affected].map((nodeId) => {
      const separator = nodeId.indexOf('\u0000');
      const identity = cellIdentityFromKey(nodeId.slice(separator + 1));
      return [nodeId, {
        cell: identity ? { sheetId: nodeId.slice(0, separator), ...identity } : undefined,
        message: cycleMembers.has(nodeId)
          ? 'Structural dependency cycle detected; expression blocked before evaluation.'
          : 'Structural dependency on a cycle; expression blocked before evaluation.',
        dependencies: [...(nextGraph.dependencies.get(nodeId) ?? [])].filter((dependency) => affected.has(dependency)).sort(),
      }] as const;
    }));
    const structuralGraph = { nodes };
    for (const nodeId of affected) reusableResults.set(nodeId, structuralDiagnosticError(structuralGraph, nodeId));
    const evaluator = new FormulaEvaluator(projection, reusableResults, onEvaluate, builtInFormulaFunctions, parse);

    this.snapshot = evaluator.evaluate();
    this.results = evaluator.formulaResults();
    this.graph = nextGraph;
    this.initialized = true;
    this.previousProjection = projection;
    return this.snapshot;
  }
}

function isRowOrderOnly(previous: CalculationProjection, next: CalculationProjection): boolean {
  if (previous.sheets.length !== next.sheets.length) return false;
  return previous.sheets.every((oldSheet) => {
    const sheet = next.sheets.find((candidate) => candidate.id === oldSheet.id);
    if (!sheet) return false;
    const metadata = (value: typeof sheet) => JSON.stringify({
      columns: value.columns, cells: value.cells, bindings: value.modelColumnBindings,
      properties: [...(value.modelPropertyIds ?? [])].sort(), names: [...(value.ordinaryNamedColumnIds ?? [])].sort(), types: value.columnTypes,
      rows: [...value.rows].sort(),
    });
    return metadata(oldSheet) === metadata(sheet);
  });
}

function orderImpactedNodes(projection: CalculationProjection, previous: FormulaDependencyGraph, next: FormulaDependencyGraph, parse: ReturnType<typeof storedFormulaParser>): Set<string> {
  const changed = new Set<string>();
  for (const [node, dependencies] of next.dependencies) {
    const old = previous.dependencies.get(node);
    if (!old || old.size !== dependencies.size || [...dependencies].some((dependency) => !old.has(dependency))) changed.add(node);
  }
  for (const sheet of projection.sheets) for (const [key, raw] of Object.entries(sheet.cells)) {
    if (!raw.startsWith('=')) continue;
    const parsed = parse(raw, sheet.id);
    if (parsed.kind === 'formula' && collectFormulaReferences(parsed.expression).some((reference) => reference.kind === 'range' || (reference.kind === 'canonical' && reference.range) || (reference.kind === 'row-reference' && reference.endpoints.length > 1))) changed.add(sheetCellNodeId(sheet.id, key));
  }
  return dependentClosure(changed, previous.dependents, next.dependents);
}
