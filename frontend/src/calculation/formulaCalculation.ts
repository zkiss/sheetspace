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
import { cycleAffectedFormulaNodes } from '@calculation/formulaCycles';
import {
  FormulaEvaluator,
  type FormulaEvaluationObserver,
} from '@calculation/formulaEvaluator';
import { sheetCellNodeId } from './nodeIdentity';
import type {
  FormulaEvaluationSnapshot,
  FormulaScalarValue,
} from '@calculation/formulaValue';
import { formulaErrorValue } from '@calculation/formulaValue';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import type { Workbook } from '@workbook/core/model';
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
    const impacted = effectiveImpact.kind === 'structure'
      ? new Set(nextFormulaNodes)
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
    for (const nodeId of cycleAffectedFormulaNodes(nextGraph)) {
      reusableResults.set(nodeId, formulaErrorValue('#CYCLE!'));
    }
    const evaluator = new FormulaEvaluator(projection, reusableResults, onEvaluate, builtInFormulaFunctions, parse);

    this.snapshot = evaluator.evaluate();
    this.results = evaluator.formulaResults();
    this.graph = nextGraph;
    this.initialized = true;
    return this.snapshot;
  }
}
