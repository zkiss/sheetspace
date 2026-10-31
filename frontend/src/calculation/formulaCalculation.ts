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
import { cycleFormulaComponents } from '@calculation/formulaCycles';
import {
  FormulaEvaluator,
  type FormulaEvaluationObserver,
} from '@calculation/formulaEvaluator';
import { sheetCellNodeId } from './nodeIdentity';
import type {
  FormulaEvaluationSnapshot,
  FormulaScalarValue,
} from '@calculation/formulaValue';
import { diagnosticAtCell, diagnosticError, formulaDiagnostic, type FormulaDiagnostic } from '@calculation/formulaValue';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import { cellIdentityFromKey } from '@workbook/core/cellIdentity';
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
    const components = cycleFormulaComponents(nextGraph);
    const cycleResults = new Map<string, FormulaScalarValue>();
    const witnesses = new Map<string, FormulaDiagnostic[]>();
    for (const component of components) {
      const pending = [...component];
      const seen = new Set(pending);
      const paths = new Map<string, FormulaDiagnostic>();
      for (const nodeId of pending) {
      const separator = nodeId.indexOf('\u0000');
      const sheetId = nodeId.slice(0, separator);
      const key = nodeId.slice(separator + 1);
      const identity = cellIdentityFromKey(key);
        paths.set(nodeId, formulaDiagnostic(diagnosticAtCell(diagnosticError('#CYCLE!', 'Structural dependency cycle detected; expression blocked before evaluation.'), identity ? { sheetId, ...identity } : undefined))!);
      }
      for (let index = 0; index < pending.length; index += 1) {
        const nodeId = pending[index];
        for (const dependent of [...(nextGraph.dependents.get(nodeId) ?? [])].sort()) {
          if (!nextFormulaNodes.has(dependent) || seen.has(dependent)) continue;
          seen.add(dependent);
          pending.push(dependent);
          const separator = dependent.indexOf('\u0000');
          const identity = cellIdentityFromKey(dependent.slice(separator + 1));
          paths.set(dependent, formulaDiagnostic(diagnosticAtCell(
            diagnosticError('#CYCLE!', 'Structural dependency on a cycle; expression blocked before evaluation.', [paths.get(nodeId)!]),
            identity ? { sheetId: dependent.slice(0, separator), ...identity } : undefined,
          ))!);
        }
      }
      for (const [nodeId, path] of paths) {
        const entries = witnesses.get(nodeId) ?? [];
        entries.push(path);
        witnesses.set(nodeId, entries);
      }
    }
    for (const [nodeId, paths] of witnesses) {
      const separator = nodeId.indexOf('\u0000');
      const sheetId = nodeId.slice(0, separator);
      const identity = cellIdentityFromKey(nodeId.slice(separator + 1));
      cycleResults.set(nodeId, diagnosticAtCell(
        diagnosticError('#CYCLE!', paths.length === 1 ? paths[0].message : 'Structural dependency on a cycle; expression blocked before evaluation.', paths.length === 1 ? paths[0].causes : paths.flatMap((path) => path.causes.length ? path.causes : [path])),
        identity ? { sheetId, ...identity } : undefined,
      ));
    }
    for (const [nodeId, value] of cycleResults) reusableResults.set(nodeId, value);
    const evaluator = new FormulaEvaluator(projection, reusableResults, onEvaluate, builtInFormulaFunctions, parse);

    this.snapshot = evaluator.evaluate();
    this.results = evaluator.formulaResults();
    this.graph = nextGraph;
    this.initialized = true;
    return this.snapshot;
  }
}
