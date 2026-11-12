import type { Workbook } from '@workbook/core/model';
import type { CalculationImpact } from '@workbook/read/calculationProjection';
import { calculationProjection } from '@workbook/read/calculationProjection';
import type { FormulaCalculation } from '@calculation/formulaCalculation';
import type { ContentHistory } from '@application/core/contentHistory';
import { settleSorting } from '@application/core/settleSorting';
import type { TransitionFailure } from './workbookControllerTypes';

type Result = { ok: true; value: Workbook } | TransitionFailure | { ok: false; reason: 'sorting-history-too-large' };

export function submitSortedOrigin(options: {
  before: Workbook;
  candidate: Workbook;
  impact: CalculationImpact;
  calculation: FormulaCalculation;
  history: ContentHistory;
  submit: (candidate: Workbook, success: (before: Workbook, after: Workbook) => void) => { result: { ok: true; value: Workbook } | TransitionFailure };
  publish: () => void;
  isNoop?: (final: Workbook) => boolean;
}): Result {
  const baseline = options.calculation.fork();
  baseline.updateStored(calculationProjection(options.before), options.before, { kind: 'structure' });
  const final = settleSorting(options.candidate, baseline, options.impact).workbook;
  if (options.isNoop?.(final)) return { ok: true, value: options.before };
  if (!options.history.canRecordSemantic(options.before, final)) return { ok: false, reason: 'sorting-history-too-large' };
  return options.submit(final, (before, after) => {
    options.history.recordSemantic(before, after);
    options.publish();
  }).result;
}
