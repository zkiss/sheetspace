import { describe, expect, it } from 'vitest';
import { sheetCellNodeId } from '@calculation/nodeIdentity';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import type { Workbook } from '@workbook/core/model';
import {
  buildFormulaDependencyGraph,
  dependentClosure,
  formulaNodes,
  updateFormulaDependencyGraph,
} from '@calculation/formulaDependencies';
import { calculationProjection as workbookCalculationProjection, type CalculationProjection } from '@workbook/read/calculationProjection';
import { commitCellRawContent } from '@workbook/mutations/operations';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

describe('formula dependencies', () => {
  it('builds direct, range, and cross-sheet edges', () => {
    const projection = calculationProjection({
      inputs: { A1: '1', A2: '2' },
      outputs: { A1: '=SUM(@inputs!A[1]:A[2])', B1: '=@A[1] * 2' },
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
      sheet: { A1: '1', B1: '2', C1: '=@A[1]' },
    });
    const previousGraph = buildFormulaDependencyGraph(previous);
    const next = calculationProjection({
      sheet: { A1: '1', B1: '2', C1: '=@B[1]' },
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
      sheet: { A1: '1', B1: '=@A[1]' },
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
      sheet: { A1: '1', B1: '=@A[1]', C1: '=@B[1]' },
    });
    const previousGraph = buildFormulaDependencyGraph(previous);
    const next = calculationProjection({
      sheet: { A1: '1', B1: '=@D[1]', C1: '=@B[1]', D1: '2' },
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

  it('tracks persisted named range edges and removes them when a binding becomes stale', () => {
    let workbook = namedBoundWorkbook();
    workbook = commitCellRawContent(workbook, 'sheet-budget', 'D1', "=SUM(@'Revenue'[1]:'Cost'[2])");
    const graph = buildFormulaDependencyGraph(workbookCalculationProjection(workbook));
    const formula = namedNode(workbook, 'D1');

    expect(graph.dependencies.get(formula)).toEqual(new Set([
      namedNode(workbook, 'A1'), namedNode(workbook, 'B1'),
      namedNode(workbook, 'A2'), namedNode(workbook, 'B2'),
    ]));
    expect(graph.dependents.get(namedNode(workbook, 'A1'))).toEqual(new Set([formula]));

    const staleSheet = {
      ...workbook.documents['sheet-budget']!,
      modelColumnBindings: { revenue: 'sheet-budget:column:3', cost: 'sheet-budget:column:2' },
    };
    workbook = { ...workbook, documents: { ...workbook.documents, [staleSheet.id]: staleSheet } };
    const stale = buildFormulaDependencyGraph(workbookCalculationProjection(workbook));
    expect(stale.dependencies.get(formula)).toEqual(new Set());
    expect(stale.dependents.has(namedNode(workbook, 'A1'))).toBe(false);
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

function namedBoundWorkbook(): Workbook {
  const sheet = {
    ...sheetDocument({ id: 'sheet-budget', name: 'Budget', cells: { A1: '2', A2: '3', B1: '4', B2: '5' } }),
    modelId: 'budget',
    modelColumnBindings: { revenue: 'sheet-budget:column:1', cost: 'sheet-budget:column:2' },
  };
  return {
    ...workbookWithSheets([sheet]),
    dataModels: {
      budget: {
        id: 'budget', name: 'Budget', columns: [
          { id: 'revenue', name: 'Revenue', kind: 'manual' as const, type: 'float' as const },
          { id: 'cost', name: 'Cost', kind: 'manual' as const, type: 'float' as const },
        ],
      },
    },
  };
}

function namedNode(workbook: Workbook, address: string): string {
  const sheet = workbook.documents['sheet-budget']!;
  const match = /^([A-Z]+)(\d+)$/.exec(address)!;
  const columnIndex = match[1]!.charCodeAt(0) - 'A'.charCodeAt(0);
  const rowIndex = Number(match[2]) - 1;
  return sheetCellNodeId(sheet.id, cellIdentityKey({
    rowId: sheet.content.rows[rowIndex]!, columnId: sheet.content.columns[columnIndex]!,
  }));
}
