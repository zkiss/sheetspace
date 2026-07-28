import {
  calculationProjection,
  type CalculationImpact,
  type CalculationProjection,
} from './calculationProjection';
import type { Workbook } from './workbook';

export type CalculationRequest = {
  projection: CalculationProjection;
  impact: CalculationImpact;
};

export type SetWorkbook = (
  update: Workbook | ((current: Workbook) => Workbook),
  impact: CalculationImpact,
) => void;

export { calculationProjection } from './calculationProjection';

export function calculationRequest(
  workbook: Workbook,
  impact: CalculationImpact,
): CalculationRequest {
  return {
    projection: calculationProjection(workbook),
    impact,
  };
}

export function mergeCalculationImpacts(
  first: CalculationImpact,
  second: CalculationImpact,
): CalculationImpact {
  if (first.kind === 'structure' || second.kind === 'structure') {
    return { kind: 'structure' };
  }
  if (first.kind === 'none') {
    return second;
  }
  if (second.kind === 'none') {
    return first;
  }

  const cells = new Map(
    [...first.cells, ...second.cells].map((cell) => [
      `${cell.sheetId}\u0000${cell.key}`,
      cell,
    ]),
  );
  return { kind: 'cells', cells: [...cells.values()] };
}
