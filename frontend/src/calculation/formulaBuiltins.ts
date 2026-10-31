import {
  type EagerFormulaFunction,
  type FormulaFunctionDefinition,
  type FormulaFunctionRegistry,
} from '@calculation/formulaFunctions';
import {
  formulaCollectionValues,
  formulaScalarValue,
  diagnosticError,
  type FormulaScalarValue,
  type FormulaValue,
} from '@calculation/formulaValue';
import { conditionalAggregateFunctions } from '@calculation/formulaConditionalAggregates';
import { logicalFormulaFunctions } from '@calculation/formulaLogical';

const collectionArgument = () => 'collection' as const;
const scalarArgument = () => 'scalar' as const;

const sum: EagerFormulaFunction = {
  evaluation: 'eager',
  arity: { min: 0 },
  argumentKind: collectionArgument,
  invoke: (arguments_) => sumNumbers(collectNumbers(arguments_), 'SUM'),
};

const average: EagerFormulaFunction = numericAggregate(
  (values) => values.length === 0
    ? diagnosticError('#DIV/0!', 'AVERAGE requires at least one number.')
    : averageNumbers(values),
);

const minimum: EagerFormulaFunction = numericAggregate(
  (values) => values.length === 0
    ? diagnosticError('#VALUE!', 'MIN requires at least one number.')
    : { kind: 'number', value: values.reduce((result, value) => Math.min(result, value)) },
);

const maximum: EagerFormulaFunction = numericAggregate(
  (values) => values.length === 0
    ? diagnosticError('#VALUE!', 'MAX requires at least one number.')
    : { kind: 'number', value: values.reduce((result, value) => Math.max(result, value)) },
);

const count: EagerFormulaFunction = numericAggregate(
  (values) => ({ kind: 'number', value: values.length }),
);

const counta: EagerFormulaFunction = {
  evaluation: 'eager',
  arity: { min: 1 },
  argumentKind: collectionArgument,
  invoke: (arguments_) => {
    let count = 0;
    for (const argument of arguments_) {
      for (const value of formulaCollectionValues(argument)) {
        if (value.kind !== 'blank') {
          count += 1;
        }
      }
    }
    return { kind: 'number', value: count };
  },
};

const absolute: EagerFormulaFunction = numericScalar((value) => Math.abs(value));
const squareRoot: EagerFormulaFunction = numericScalar(
  (value) => value < 0 ? undefined : Math.sqrt(value),
);

export const builtInFormulaFunctions: FormulaFunctionRegistry = new Map<
  string,
  FormulaFunctionDefinition
>([
  ['SUM', sum],
  ['AVERAGE', average],
  ['MIN', minimum],
  ['MAX', maximum],
  ['COUNT', count],
  ['COUNTA', counta],
  ['ABS', absolute],
  ['SQRT', squareRoot],
  ...logicalFormulaFunctions,
  ...conditionalAggregateFunctions,
]);

function numericAggregate(
  calculate: (values: readonly number[]) => FormulaScalarValue,
): EagerFormulaFunction {
  return {
    evaluation: 'eager',
    arity: { min: 1 },
    argumentKind: collectionArgument,
    invoke: (arguments_) => calculate(collectNumbers(arguments_)),
  };
}

function numericScalar(
  calculate: (value: number) => number | undefined,
): EagerFormulaFunction {
  return {
    evaluation: 'eager',
    arity: { min: 1, max: 1 },
    argumentKind: scalarArgument,
    invoke: (arguments_) => {
      const value = formulaScalarValue(arguments_[0]);
      if (value.kind !== 'number') {
        const actual = value.kind === 'blank' ? 'blank' : value.kind === 'error' ? value.error : `${value.kind} ${JSON.stringify(value.value)}`;
        return diagnosticError('#VALUE!', `Expected a number, got ${actual}.`);
      }
      const result = calculate(value.value);
      return result === undefined ? diagnosticError('#VALUE!', `Invalid numeric argument ${value.value}.`) : finiteNumber(result);
    },
  };
}

function collectNumbers(arguments_: readonly FormulaValue[]): number[] {
  const values: number[] = [];
  for (const argument of arguments_) {
    for (const value of formulaCollectionValues(argument)) {
      if (value.kind === 'number') {
        values.push(value.value);
      }
    }
  }
  return values;
}

function sumNumbers(values: readonly number[], name: string): FormulaScalarValue {
  let total = 0;
  let overflow: string | undefined;
  for (const value of values) {
    const next = total + value;
    if (!Number.isFinite(next) && overflow === undefined) overflow = `${name} produced a nonfinite result adding ${value} to ${total}.`;
    total = next;
  }
  return Number.isFinite(total) ? { kind: 'number', value: total } : diagnosticError('#VALUE!', overflow!);
}

function averageNumbers(values: readonly number[]): FormulaScalarValue {
  const total = sumNumbers(values, 'AVERAGE');
  return total.kind === 'number' ? finiteNumber(total.value / values.length) : total;
}

function finiteNumber(value: number): FormulaScalarValue {
  return Number.isFinite(value) ? { kind: 'number', value } : diagnosticError('#VALUE!', `Numeric result ${value} is not finite.`);
}
