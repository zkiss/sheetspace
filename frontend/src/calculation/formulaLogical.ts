import type {
  EagerFormulaFunction,
  FormulaFunctionDefinition,
  LazyFormulaFunction,
} from '@calculation/formulaFunctions';
import {
  formulaCollectionValues,
  formulaErrorValue,
  formulaScalarValue,
  type FormulaScalarValue,
} from '@calculation/formulaValue';

const conditional: LazyFormulaFunction = {
  evaluation: 'lazy',
  arity: { min: 3, max: 3 },
  argumentKind: (index) => index === 0 ? 'scalar' : 'collection',
  invoke: (arguments_, context) => {
    const condition = formulaScalarValue(context.evaluateArgument(arguments_[0], 'scalar'));
    if (condition.kind === 'error') {
      return condition;
    }
    if (condition.kind !== 'boolean') {
      return formulaErrorValue('#VALUE!');
    }
    return formulaScalarValue(context.evaluateArgument(
      arguments_[condition.value ? 1 : 2],
      'scalar',
    ));
  },
};

const and = logicalCollectionFunction(false);
const or = logicalCollectionFunction(true);

const not: EagerFormulaFunction = {
  evaluation: 'eager',
  arity: { min: 1, max: 1 },
  argumentKind: () => 'scalar',
  invoke: (arguments_) => {
    const value = formulaScalarValue(arguments_[0]);
    return value.kind === 'boolean'
      ? { kind: 'boolean', value: !value.value }
      : formulaErrorValue('#VALUE!');
  },
};

export const logicalFormulaFunctions: readonly [string, FormulaFunctionDefinition][] = [
  ['IF', conditional],
  ['AND', and],
  ['OR', or],
  ['NOT', not],
];

function logicalCollectionFunction(decisiveValue: boolean): LazyFormulaFunction {
  return {
    evaluation: 'lazy',
    arity: { min: 1 },
    argumentKind: () => 'collection',
    invoke: (arguments_, context) => {
      let foundBoolean = false;
      for (const argument of arguments_) {
        const collection = context.evaluateCollectionArgument(argument);
        if (collection.kind === 'error') {
          return collection;
        }
        for (const value of formulaCollectionValues(collection)) {
          const result = inspectLogicalValue(value, decisiveValue);
          if (result) {
            return result;
          }
          if (value.kind === 'boolean') {
            foundBoolean = true;
          }
        }
      }
      return foundBoolean
        ? { kind: 'boolean', value: !decisiveValue }
        : formulaErrorValue('#VALUE!');
    },
  };
}

function inspectLogicalValue(
  value: FormulaScalarValue,
  decisiveValue: boolean,
): FormulaScalarValue | undefined {
  if (value.kind === 'error') {
    return value;
  }
  if (value.kind === 'number' || value.kind === 'text') {
    return formulaErrorValue('#VALUE!');
  }
  if (value.kind === 'boolean' && value.value === decisiveValue) {
    return value;
  }
  return undefined;
}
