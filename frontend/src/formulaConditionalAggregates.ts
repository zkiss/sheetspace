import { matchFormulaCriterion, parseFormulaCriterion } from './formulaCriteria';
import type {
  FormulaFunctionRegistry,
  LazyFormulaFunction,
  FormulaReferenceArgument,
} from './formulaFunctions';
import type { FormulaErrorCode, FormulaExpression } from './formulaSyntax';
import { formulaErrorValue, formulaScalarValue, type FormulaScalarValue } from './formulaValue';

const conditionalArgumentKind = (index: number) => index === 1 ? 'scalar' as const : 'reference' as const;

const countIf: LazyFormulaFunction = {
  evaluation: 'lazy',
  arity: { min: 2, max: 2 },
  argumentKind: conditionalArgumentKind,
  invoke: (arguments_, context) => {
    const criteriaInput = context.evaluateReferenceArgument(arguments_[0]);
    if (!criteriaInput.ok) return formulaErrorValue(criteriaInput.error);

    const candidates = materializeCriteria(criteriaInput.value);
    if (!candidates.ok) return formulaErrorValue(candidates.error);

    const criterionValue = formulaScalarValue(context.evaluateArgument(arguments_[1], 'scalar'));
    const criterion = parseFormulaCriterion(criterionValue);
    if (!criterion.ok) return formulaErrorValue(criterion.error);

    let count = 0;
    for (const candidate of candidates.value) {
      const match = matchFormulaCriterion(criterion.value, candidate);
      if (!match.ok) return formulaErrorValue(match.error);
      if (match.value) count += 1;
    }
    return { kind: 'number', value: count };
  },
};

const sumIf: LazyFormulaFunction = {
  evaluation: 'lazy',
  arity: { min: 2, max: 3 },
  argumentKind: conditionalArgumentKind,
  validateArguments: validateSumIfShapes,
  invoke: (arguments_, context) => {
    const criteriaInput = context.evaluateReferenceArgument(arguments_[0]);
    if (!criteriaInput.ok) return formulaErrorValue(criteriaInput.error);

    let sumInput: FormulaReferenceArgument | undefined;
    if (arguments_.length === 3) {
      const evaluatedSumInput = context.evaluateReferenceArgument(arguments_[2]);
      if (!evaluatedSumInput.ok) return formulaErrorValue(evaluatedSumInput.error);
      if (!sameShape(criteriaInput.value, evaluatedSumInput.value)) {
        return formulaErrorValue('#VALUE!');
      }
      sumInput = evaluatedSumInput.value;
    }

    const candidates = materializeCriteria(criteriaInput.value);
    if (!candidates.ok) return formulaErrorValue(candidates.error);

    const criterionValue = formulaScalarValue(context.evaluateArgument(arguments_[1], 'scalar'));
    const criterion = parseFormulaCriterion(criterionValue);
    if (!criterion.ok) return formulaErrorValue(criterion.error);

    const matchingIndexes: number[] = [];
    for (let index = 0; index < candidates.value.length; index += 1) {
      const match = matchFormulaCriterion(criterion.value, candidates.value[index]);
      if (!match.ok) return formulaErrorValue(match.error);
      if (match.value) matchingIndexes.push(index);
    }

    let sumValues = candidates.value;
    if (sumInput) {
      if (matchingIndexes.length === 0) return { kind: 'number', value: 0 };
      sumValues = [...sumInput.values];
    }

    let total = 0;
    for (const index of matchingIndexes) {
      const value = sumValues[index];
      if (value.kind === 'error') return value;
      if (value.kind === 'number') total += value.value;
    }
    return Number.isFinite(total)
      ? { kind: 'number', value: total }
      : formulaErrorValue('#VALUE!');
  },
};

export const conditionalAggregateFunctions: FormulaFunctionRegistry = new Map([
  ['COUNTIF', countIf],
  ['SUMIF', sumIf],
]);

function materializeCriteria(
  input: FormulaReferenceArgument,
): { ok: true; value: FormulaScalarValue[] } | { ok: false; error: FormulaErrorCode } {
  const values = [...input.values];
  const error = values.find((value): value is FormulaScalarValue & { kind: 'error' } => value.kind === 'error');
  return error ? { ok: false, error: error.error } : { ok: true, value: values };
}

function sameShape(
  first: FormulaReferenceArgument,
  second: FormulaReferenceArgument,
): boolean {
  return first.rowCount === second.rowCount && first.columnCount === second.columnCount;
}

function validateSumIfShapes(arguments_: readonly FormulaExpression[]) {
  if (arguments_.length !== 3) return undefined;
  // Canonical coordinates have no intrinsic position; their current rectangle
  // is resolved by the evaluator against the sheet's ordered axes.
  if (containsCanonicalReference(arguments_[0]) || containsCanonicalReference(arguments_[2])) return undefined;
  const criteriaShape = referenceShape(arguments_[0]);
  const sumShape = referenceShape(arguments_[2]);
  return criteriaShape !== undefined
    && sumShape !== undefined
    && criteriaShape.rowCount === sumShape.rowCount
    && criteriaShape.columnCount === sumShape.columnCount
    ? undefined
    : '#VALUE!' as const;
}

function containsCanonicalReference(expression: FormulaExpression): boolean {
  return expression.kind === 'canonical'
    || (expression.kind === 'group' && containsCanonicalReference(expression.expression));
}

function referenceShape(expression: FormulaExpression): Pick<FormulaReferenceArgument, 'rowCount' | 'columnCount'> | undefined {
  if (expression.kind === 'group') return referenceShape(expression.expression);
  if (expression.kind === 'cell') return { rowCount: 1, columnCount: 1 };
  if (expression.kind !== 'range') return undefined;
  return {
    rowCount: expression.range.end.rowIndex - expression.range.start.rowIndex + 1,
    columnCount: expression.range.end.columnIndex - expression.range.start.columnIndex + 1,
  };
}
