import {
  applyComparisonOperator,
  compareFormulaScalars,
  type FormulaComparisonOperator,
} from './formulaComparison';
import type { FormulaErrorCode } from './workbook/formula/syntax';
import type { FormulaScalarValue } from './formulaValue';

type CriterionOperand = Exclude<FormulaScalarValue, { kind: 'error' }>;

export type FormulaCriterion = {
  operator: FormulaComparisonOperator;
  operand: CriterionOperand;
};

export type FormulaCriterionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: FormulaErrorCode };

export function parseFormulaCriterion(
  value: FormulaScalarValue,
): FormulaCriterionResult<FormulaCriterion> {
  if (value.kind === 'error') {
    return { ok: false, error: value.error };
  }
  if (value.kind !== 'text') {
    return { ok: true, value: { operator: '=', operand: value } };
  }

  const { operator, operandText } = splitTextCriterion(value.value);
  if (operandText.length === 0 && operator !== '=') {
    if (operator === '<>') {
      return { ok: true, value: { operator, operand: { kind: 'blank' } } };
    }
    return { ok: false, error: '#VALUE!' };
  }
  if (operandText.length === 0 && operator === '=' && value.value.startsWith('=')) {
    return { ok: true, value: { operator, operand: { kind: 'blank' } } };
  }

  const forcedText = parseForcedText(operandText);
  if (forcedText.kind === 'invalid') {
    return { ok: false, error: '#VALUE!' };
  }
  if (forcedText.kind === 'text') {
    return { ok: true, value: { operator, operand: { kind: 'text', value: forcedText.value } } };
  }

  return { ok: true, value: { operator, operand: classifyCriterionOperand(operandText) } };
}

export function matchFormulaCriterion(
  criterion: FormulaCriterion,
  candidate: FormulaScalarValue,
): FormulaCriterionResult<boolean> {
  if (candidate.kind === 'error') {
    return { ok: false, error: candidate.error };
  }

  if (criterion.operator === '<>' && criterion.operand.kind === 'blank') {
    return { ok: true, value: candidate.kind !== 'blank' };
  }
  if (candidate.kind !== criterion.operand.kind) {
    return { ok: true, value: false };
  }

  const comparison = compareFormulaScalars(candidate, criterion.operand);
  return comparison === undefined
    ? { ok: true, value: false }
    : { ok: true, value: applyComparisonOperator(comparison, criterion.operator) };
}

function splitTextCriterion(value: string): {
  operator: FormulaComparisonOperator;
  operandText: string;
} {
  for (const operator of ['<=', '>=', '<>', '=', '<', '>'] as const) {
    if (value.startsWith(operator)) {
      return { operator, operandText: value.slice(operator.length) };
    }
  }
  return { operator: '=', operandText: value };
}

type ForcedTextResult =
  | { kind: 'not-forced' }
  | { kind: 'text'; value: string }
  | { kind: 'invalid' };

function parseForcedText(value: string): ForcedTextResult {
  if (!value.startsWith('"')) {
    return { kind: 'not-forced' };
  }

  let parsed = '';
  for (let index = 1; index < value.length; index += 1) {
    if (value[index] !== '"') {
      parsed += value[index];
      continue;
    }
    if (value[index + 1] === '"') {
      parsed += '"';
      index += 1;
      continue;
    }
    return index === value.length - 1
      ? { kind: 'text', value: parsed }
      : { kind: 'invalid' };
  }
  return { kind: 'invalid' };
}

function classifyCriterionOperand(value: string): CriterionOperand {
  const numeric = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(value)
    ? Number(value)
    : undefined;
  if (numeric !== undefined && Number.isFinite(numeric)) {
    return { kind: 'number', value: numeric };
  }
  if (/^TRUE$/i.test(value)) {
    return { kind: 'boolean', value: true };
  }
  if (/^FALSE$/i.test(value)) {
    return { kind: 'boolean', value: false };
  }
  return { kind: 'text', value };
}
