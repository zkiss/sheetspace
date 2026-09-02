import { describe, expect, it } from 'vitest';
import { sheetCellNodeId } from './formulaEvaluator';
import {
  buildFormulaDependencyGraph,
  dependentClosure,
  formulaNodes,
  updateFormulaDependencyGraph,
} from './formulaDependencies';
import type { CalculationProjection } from './workbook/read/calculationProjection';

describe('formula dependencies', () => {
  it('builds direct, range, and cross-sheet edges', () => {
    const projection = calculationProjection({
      inputs: { A1: '1', A2: '2' },
      outputs: { A1: '=SUM(inputs!A1:A2)', B1: '=A1 * 2' },
    });

    const graph = buildFormulaDependencyGraph(projection);

    expect(graph.dependencies.get(node('outputs', 'A1'))).toEqual(new Set([
      node('inputs', 'A1'),
      node('inputs', 'A2'),
    ]));
    expect(graph.dependents.get(node('outputs', 'A1'))).toEqual(new Set([
      node('outputs', 'B1'),
    ]));
    expect(formulaNodes(graph)).toEqual(new Set([
      node('outputs', 'A1'),
      node('outputs', 'B1'),
    ]));
  });

  it('replaces old edges when a changed formula points elsewhere', () => {
    const previous = calculationProjection({
      sheet: { A1: '1', B1: '2', C1: '=A1' },
    });
    const previousGraph = buildFormulaDependencyGraph(previous);
    const next = calculationProjection({
      sheet: { A1: '1', B1: '2', C1: '=B1' },
    });

    const nextGraph = updateFormulaDependencyGraph(
      previousGraph,
      next,
      [{ sheetId: 'sheet', key: 'C1' }],
    );

    expect(nextGraph.dependents.has(node('sheet', 'A1'))).toBe(false);
    expect(nextGraph.dependents.get(node('sheet', 'B1'))).toEqual(new Set([
      node('sheet', 'C1'),
    ]));
    expect(previousGraph.dependents.get(node('sheet', 'A1'))).toEqual(new Set([
      node('sheet', 'C1'),
    ]));
  });

  it('removes formula edges when a changed cell becomes plain', () => {
    const previous = calculationProjection({
      sheet: { A1: '1', B1: '=A1' },
    });
    const graph = buildFormulaDependencyGraph(previous);
    const next = calculationProjection({
      sheet: { A1: '1', B1: 'plain' },
    });

    const updated = updateFormulaDependencyGraph(
      graph,
      next,
      [{ sheetId: 'sheet', key: 'B1' }],
    );

    expect(updated.dependencies.has(node('sheet', 'B1'))).toBe(false);
    expect(updated.dependents.has(node('sheet', 'A1'))).toBe(false);
  });

  it('finds transitive dependents across previous and next edges', () => {
    const previous = calculationProjection({
      sheet: { A1: '1', B1: '=A1', C1: '=B1' },
    });
    const previousGraph = buildFormulaDependencyGraph(previous);
    const next = calculationProjection({
      sheet: { A1: '1', B1: '=D1', C1: '=B1', D1: '2' },
    });
    const nextGraph = updateFormulaDependencyGraph(
      previousGraph,
      next,
      [{ sheetId: 'sheet', key: 'B1' }],
    );

    expect(dependentClosure(
      new Set([node('sheet', 'A1')]),
      previousGraph.dependents,
      nextGraph.dependents,
    )).toEqual(new Set([
      node('sheet', 'A1'),
      node('sheet', 'B1'),
      node('sheet', 'C1'),
    ]));
  });
});

function calculationProjection(
  sheets: Record<string, Record<string, string>>,
): CalculationProjection {
  return {
    sheets: Object.entries(sheets).map(([id, cells]) => ({
      id,
      rowCount: 10,
      columnCount: 10,
      cells,
    })),
  } as unknown as CalculationProjection;
}

function node(sheetId: string, key: string): string {
  return sheetCellNodeId(sheetId, key);
}
