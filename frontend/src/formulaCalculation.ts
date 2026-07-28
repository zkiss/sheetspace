import type {
  CalculationImpact,
  CalculationProjection,
} from './calculationProjection';
import {
  buildFormulaDependencyGraph,
  dependentClosure,
  emptyFormulaDependencyGraph,
  formulaNodes,
  updateFormulaDependencyGraph,
  type FormulaDependencyGraph,
} from './formulaDependencies';
import {
  FormulaEvaluator,
  sheetCellNodeId,
  type FormulaEvaluationObserver,
} from './formulaEvaluator';
import type {
  FormulaEvaluationSnapshot,
  FormulaScalarValue,
} from './formulaValue';

/**
 * Owns dependency edges and derived values for the calculation projection.
 * Callers explicitly describe content or structure impacts.
 */
export class FormulaCalculation {
  private initialized = false;
  private graph: FormulaDependencyGraph = emptyFormulaDependencyGraph();
  private results = new Map<string, FormulaScalarValue>();
  private snapshot: FormulaEvaluationSnapshot = {};

  fork(): FormulaCalculation {
    const calculation = new FormulaCalculation();
    calculation.initialized = this.initialized;
    calculation.graph = this.graph;
    calculation.results = new Map(this.results);
    calculation.snapshot = this.snapshot;
    return calculation;
  }

  update(
    projection: CalculationProjection,
    impact: CalculationImpact,
    onEvaluate?: FormulaEvaluationObserver,
  ): FormulaEvaluationSnapshot {
    if (impact.kind === 'none' && this.initialized) {
      return this.snapshot;
    }

    const effectiveImpact = !this.initialized || impact.kind === 'none'
      ? { kind: 'structure' } as const
      : impact;
    const previousGraph = this.graph;
    const nextGraph = effectiveImpact.kind === 'structure'
      ? buildFormulaDependencyGraph(projection)
      : updateFormulaDependencyGraph(this.graph, projection, effectiveImpact.cells);
    const nextFormulaNodes = formulaNodes(nextGraph);
    const impacted = effectiveImpact.kind === 'structure'
      ? new Set(nextFormulaNodes)
      : dependentClosure(
          new Set(effectiveImpact.cells.map(({ sheetId, key }) => sheetCellNodeId(sheetId, key))),
          previousGraph.dependents,
          nextGraph.dependents,
        );
    const reusableResults = new Map(
      [...this.results].filter(([nodeId]) =>
        nextFormulaNodes.has(nodeId) && !impacted.has(nodeId),
      ),
    );
    const evaluator = new FormulaEvaluator(projection, reusableResults, onEvaluate);

    this.snapshot = evaluator.evaluate();
    this.results = evaluator.formulaResults();
    this.graph = nextGraph;
    this.initialized = true;
    return this.snapshot;
  }
}
