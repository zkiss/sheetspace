import type { FormulaScalarValue } from './formulaValue';

export type FormulaComparisonOperator = '=' | '<>' | '<' | '<=' | '>' | '>=';
export type FormulaComparison = -1 | 0 | 1;

export function isComparisonOperator(operator: string): operator is FormulaComparisonOperator {
  return operator === '='
    || operator === '<>'
    || operator === '<'
    || operator === '<='
    || operator === '>'
    || operator === '>=';
}

export function compareFormulaScalars(
  left: FormulaScalarValue,
  right: FormulaScalarValue,
): FormulaComparison | undefined {
  if (left.kind === 'number' && right.kind === 'number') {
    return left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
  }
  if (left.kind === 'text' && right.kind === 'text') {
    return compareTextByCodePoint(left.value, right.value);
  }
  if (left.kind === 'boolean' && right.kind === 'boolean') {
    return left.value === right.value ? 0 : left.value ? 1 : -1;
  }
  if (left.kind === 'blank' && right.kind === 'blank') {
    return 0;
  }
  return undefined;
}

export function applyComparisonOperator(
  comparison: FormulaComparison,
  operator: FormulaComparisonOperator,
): boolean {
  switch (operator) {
    case '=':
      return comparison === 0;
    case '<>':
      return comparison !== 0;
    case '<':
      return comparison < 0;
    case '<=':
      return comparison <= 0;
    case '>':
      return comparison > 0;
    case '>=':
      return comparison >= 0;
  }
}

function compareTextByCodePoint(left: string, right: string): FormulaComparison {
  const leftCodePoints = [...left].map((value) => value.codePointAt(0) as number);
  const rightCodePoints = [...right].map((value) => value.codePointAt(0) as number);
  const sharedLength = Math.min(leftCodePoints.length, rightCodePoints.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (leftCodePoints[index] !== rightCodePoints[index]) {
      return leftCodePoints[index] < rightCodePoints[index] ? -1 : 1;
    }
  }
  return leftCodePoints.length < rightCodePoints.length
    ? -1
    : leftCodePoints.length > rightCodePoints.length
      ? 1
      : 0;
}
