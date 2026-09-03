import type { FormulaErrorCode, FormulaExpression, FunctionFormula } from '@workbook/formula/syntax';
import {
  formulaErrorValue,
  type FormulaRangeValue,
  type FormulaScalarValue,
  type FormulaValue,
} from '@calculation/formulaValue';

export type FormulaFunctionArgumentKind = 'scalar' | 'collection' | 'reference';

export type FormulaFunctionArity = {
  min: number;
  max?: number;
};

type FormulaFunctionDefinitionBase = {
  arity: FormulaFunctionArity;
  argumentKind: (index: number) => FormulaFunctionArgumentKind;
  validateArguments?: (arguments_: readonly FormulaExpression[]) => FormulaErrorCode | undefined;
};

export type FormulaReferenceArgument = {
  values: Iterable<FormulaScalarValue>;
  rowCount: number;
  columnCount: number;
};

export type FormulaReferenceArgumentResult =
  | { ok: true; value: FormulaReferenceArgument }
  | { ok: false; error: FormulaErrorCode };

export type EagerFormulaFunction = FormulaFunctionDefinitionBase & {
  evaluation: 'eager';
  invoke: (arguments_: readonly FormulaValue[]) => FormulaScalarValue;
};

export type LazyFormulaFunctionContext = {
  evaluateArgument: (
    expression: FormulaExpression,
    kind: FormulaFunctionArgumentKind,
  ) => FormulaValue;
  evaluateCollectionArgument: (expression: FormulaExpression) => FormulaValue;
  evaluateReferenceArgument: (expression: FormulaExpression) => FormulaReferenceArgumentResult;
};

export type LazyFormulaFunction = FormulaFunctionDefinitionBase & {
  evaluation: 'lazy';
  invoke: (
    arguments_: readonly FormulaExpression[],
    context: LazyFormulaFunctionContext,
  ) => FormulaScalarValue;
};

export type FormulaFunctionDefinition = EagerFormulaFunction | LazyFormulaFunction;
export type FormulaFunctionRegistry = ReadonlyMap<string, FormulaFunctionDefinition>;

export type FormulaFunctionEvaluationContext = {
  evaluateExpression: (expression: FormulaExpression) => FormulaValue;
  evaluateReferenceArgument?: (expression: FormulaExpression) => FormulaReferenceArgumentResult;
};

export function evaluateFunctionCall(
  expression: FunctionFormula,
  context: FormulaFunctionEvaluationContext,
  registry: FormulaFunctionRegistry,
): FormulaScalarValue {
  const definition = registry.get(expression.functionName.toUpperCase());
  if (!definition) {
    return formulaErrorValue('#NAME!');
  }
  if (!acceptsArity(definition.arity, expression.arguments.length)) {
    return formulaErrorValue('#VALUE!');
  }

  for (let index = 0; index < expression.arguments.length; index += 1) {
    const kind = definition.argumentKind(index);
    if (kind === 'scalar' && isSyntacticRange(expression.arguments[index])) {
      return formulaErrorValue('#VALUE!');
    }
    if (kind === 'reference' && !isSyntacticReference(expression.arguments[index])) {
      return formulaErrorValue('#VALUE!');
    }
  }
  const validationError = definition.validateArguments?.(expression.arguments);
  if (validationError) {
    return formulaErrorValue(validationError);
  }

  const invocationContext: LazyFormulaFunctionContext = {
    evaluateArgument: (argument, kind) => evaluateArgument(argument, kind, context),
    evaluateCollectionArgument: (argument) => context.evaluateExpression(argument),
    evaluateReferenceArgument: context.evaluateReferenceArgument
      ?? (() => ({ ok: false, error: '#VALUE!' })),
  };
  if (definition.evaluation === 'lazy') {
    return definition.invoke(expression.arguments, invocationContext);
  }

  const values: FormulaValue[] = [];
  for (let index = 0; index < expression.arguments.length; index += 1) {
    const value = invocationContext.evaluateArgument(
      expression.arguments[index],
      definition.argumentKind(index),
    );
    if (value.kind === 'error') {
      return value;
    }
    values.push(value);
  }
  return definition.invoke(values);
}

function acceptsArity(arity: FormulaFunctionArity, argumentCount: number): boolean {
  return argumentCount >= arity.min && (arity.max === undefined || argumentCount <= arity.max);
}

function isSyntacticRange(expression: FormulaExpression): boolean {
  return expression.kind === 'range'
    || (expression.kind === 'canonical' && expression.range !== undefined)
    || (expression.kind === 'group' && isSyntacticRange(expression.expression));
}

function isSyntacticReference(expression: FormulaExpression): boolean {
  return expression.kind === 'cell'
    || expression.kind === 'range'
    || expression.kind === 'canonical'
    || (expression.kind === 'group' && isSyntacticReference(expression.expression));
}

function evaluateArgument(
  expression: FormulaExpression,
  kind: FormulaFunctionArgumentKind,
  context: FormulaFunctionEvaluationContext,
): FormulaValue {
  if (kind === 'reference') {
    return formulaErrorValue('#VALUE!');
  }
  const value = context.evaluateExpression(expression);
  if (value.kind === 'error') {
    return value;
  }
  if (kind === 'scalar') {
    return value.kind === 'range' ? formulaErrorValue('#VALUE!') : value;
  }
  if (value.kind !== 'range') {
    return value;
  }

  const values: FormulaScalarValue[] = [];
  for (const item of value.values) {
    if (item.kind === 'error') {
      return item;
    }
    values.push(item);
  }
  const materialized: FormulaRangeValue = { ...value, values };
  return materialized;
}
