import { buildFormulaDependencyGraph, type FormulaDependencyGraph } from './formulaDependencies';
import { sheetCellNodeId } from './nodeIdentity';
import { calculationProjection, type CalculationProjection } from '@workbook/read/calculationProjection';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import type { StableCellIdentity, Workbook } from '@workbook/core/model';

export type UsageCellTarget = {
  readonly sheetId: string;
  readonly cell: StableCellIdentity;
};

export type CellUsageTarget = UsageCellTarget;

export type PropertyUsageTarget = {
  readonly modelId: string;
  readonly propertyId: string;
};

export type UsageQueryResult = {
  readonly available: boolean;
  readonly directUsages: readonly UsageCellTarget[];
  readonly transitiveDependents: readonly UsageCellTarget[];
};

/**
 * A workbook-snapshot query service. Construct it once for a workbook revision
 * and reuse it for palette filtering rather than rebuilding dependency edges on
 * each render or keystroke.
 */
export class UsageQueries {
  private readonly modelIdsBySheet: ReadonlyMap<string, string | undefined>;
  private readonly propertyIdsByModel: ReadonlyMap<string, ReadonlySet<string>>;
  private readonly graph: FormulaDependencyGraph;
  private readonly targetsByNode: ReadonlyMap<string, UsageCellTarget>;
  private readonly orderByNode: ReadonlyMap<string, number>;
  private readonly projection: CalculationProjection;

  constructor(workbook: Workbook) {
    this.projection = calculationProjection(workbook);
    this.graph = buildFormulaDependencyGraph(this.projection);
    this.modelIdsBySheet = new Map(
      Object.values(workbook.documents).map((sheet) => [sheet.id, sheet.modelId]),
    );
    this.propertyIdsByModel = new Map(
      Object.values(workbook.dataModels ?? {}).map((model) => [
        model.id,
        new Set(model.columns.map((property) => property.id)),
      ]),
    );
    const targetsByNode = new Map<string, UsageCellTarget>();
    const orderByNode = new Map<string, number>();
    let order = 0;
    for (const sheet of this.projection.sheets) {
      for (const rowId of sheet.rows) {
        for (const columnId of sheet.columns) {
          const nodeId = sheetCellNodeId(sheet.id, cellIdentityKey({ rowId, columnId }));
          targetsByNode.set(nodeId, { sheetId: sheet.id, cell: { rowId, columnId } });
          orderByNode.set(nodeId, order++);
        }
      }
    }
    this.targetsByNode = targetsByNode;
    this.orderByNode = orderByNode;
  }

  forCell(target: CellUsageTarget): UsageQueryResult {
    const sheet = this.projection.sheets.find((candidate) => candidate.id === target.sheetId);
    if (!sheet || !sheet.rows.includes(target.cell.rowId) || !sheet.columns.includes(target.cell.columnId)) {
      return unavailableResult();
    }
    return this.forSeeds(new Set([sheetCellNodeId(target.sheetId, cellIdentityKey(target.cell))]));
  }

  forProperty(target: PropertyUsageTarget): UsageQueryResult {
    if (!this.propertyIdsByModel.get(target.modelId)?.has(target.propertyId)) return unavailableResult();
    const seeds = new Set<string>();
    for (const sheet of this.projection.sheets) {
      if (!sheet.modelPropertyIds?.has(target.propertyId) || sheet.modelColumnBindings?.[target.propertyId] === undefined) continue;
      // modelPropertyIds is derived from this sheet's currently bound model.
      // Checking the ID below prevents an identically named property elsewhere
      // from becoming a substitute target.
      const model = this.modelIdForSheet(sheet.id);
      if (model !== target.modelId) continue;
      const columnId = sheet.modelColumnBindings[target.propertyId]!;
      if (!sheet.columns.includes(columnId)) continue;
      for (const rowId of sheet.rows) seeds.add(sheetCellNodeId(sheet.id, cellIdentityKey({ rowId, columnId })));
    }
    return this.forSeeds(seeds);
  }

  private modelIdForSheet(sheetId: string): string | undefined { return this.modelIdsBySheet.get(sheetId); }

  private forSeeds(seeds: ReadonlySet<string>): UsageQueryResult {
    const direct = new Set<string>();
    for (const seed of seeds) {
      for (const dependent of this.graph.dependents.get(seed) ?? []) {
        if (!seeds.has(dependent)) direct.add(dependent);
      }
    }

    const reached = new Set<string>(seeds);
    const pending = [...seeds].map((nodeId) => ({ nodeId, distance: 0 }));
    const transitive = new Set<string>();
    while (pending.length > 0) {
      const { nodeId, distance } = pending.shift()!;
      for (const dependent of this.graph.dependents.get(nodeId) ?? []) {
        if (distance >= 1 && !seeds.has(dependent) && !direct.has(dependent)) transitive.add(dependent);
        if (!reached.has(dependent)) {
          reached.add(dependent);
          pending.push({ nodeId: dependent, distance: distance + 1 });
        }
      }
    }

    return {
      available: true,
      directUsages: this.targets(direct),
      transitiveDependents: this.targets(transitive),
    };
  }

  private targets(nodes: ReadonlySet<string>): UsageCellTarget[] {
    return [...nodes]
      .filter((nodeId) => this.targetsByNode.has(nodeId))
      .sort((left, right) => (this.orderByNode.get(left)! - this.orderByNode.get(right)!))
      .map((nodeId) => this.targetsByNode.get(nodeId)!);
  }
}

export function usageQueries(workbook: Workbook): UsageQueries {
  return new UsageQueries(workbook);
}

function unavailableResult(): UsageQueryResult {
  return { available: false, directUsages: [], transitiveDependents: [] };
}
