import type { FormulaExpression, FunctionFormula } from './formulaSyntax';
import {
  formulaErrorValue,
  type FormulaRangeValue,
  type FormulaScalarValue,
  type FormulaValue,
} from './formulaValue';

export type FormulaFunctionArgumentKind = 'scalar' | 'collection';

export type FormulaFunctionArity = {
  min: number;
  max?: number;
};

type FormulaFunctionDefinitionBase = {
  arity: FormulaFunctionArity;
  argumentKind: (index: number) => FormulaFunctionArgumentKind;
};

export type EagerFormulaFunction = FormulaFunctionDefinitionBase & {
  evaluation: 'eager';
  invoke: (arguments_: readonly FormulaValue[]) => FormulaScalarValue;
};

export type LazyFormulaFunctionContext = {
  evaluateArgument: (
    expression: FormulaExpression,
    kind: FormulaFunctionArgumentKind,
  ) => FormulaValue;
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
    if (
      definition.argumentKind(index) === 'scalar'
      && isSyntacticRange(expression.arguments[index])
    ) {
      return formulaErrorValue('#VALUE!');
    }
  }

  const invocationContext: LazyFormulaFunctionContext = {
    evaluateArgument: (argument, kind) => evaluateArgument(argument, kind, context),
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
    || (expression.kind === 'group' && isSyntacticRange(expression.expression));
}

function evaluateArgument(
  expression: FormulaExpression,
  kind: FormulaFunctionArgumentKind,
  context: FormulaFunctionEvaluationContext,
): FormulaValue {
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
