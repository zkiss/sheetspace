import {
  type EagerFormulaFunction,
  type FormulaFunctionDefinition,
  type FormulaFunctionRegistry,
} from './formulaFunctions';
import {
  formulaCollectionValues,
  formulaErrorValue,
  formulaScalarValue,
  type FormulaScalarValue,
  type FormulaValue,
} from './formulaValue';

const collectionArgument = () => 'collection' as const;
const scalarArgument = () => 'scalar' as const;

const sum: EagerFormulaFunction = {
  evaluation: 'eager',
  arity: { min: 0 },
  argumentKind: collectionArgument,
  invoke: (arguments_) => finiteNumber(
    collectNumbers(arguments_).reduce((total, value) => total + value, 0),
  ),
};

const average: EagerFormulaFunction = numericAggregate(
  (values) => values.length === 0
    ? formulaErrorValue('#DIV/0!')
    : finiteNumber(values.reduce((total, value) => total + value, 0) / values.length),
);

const minimum: EagerFormulaFunction = numericAggregate(
  (values) => values.length === 0
    ? formulaErrorValue('#VALUE!')
    : { kind: 'number', value: values.reduce((result, value) => Math.min(result, value)) },
);

const maximum: EagerFormulaFunction = numericAggregate(
  (values) => values.length === 0
    ? formulaErrorValue('#VALUE!')
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
        return formulaErrorValue('#VALUE!');
      }
      const result = calculate(value.value);
      return result === undefined ? formulaErrorValue('#VALUE!') : finiteNumber(result);
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

function finiteNumber(value: number): FormulaScalarValue {
  return Number.isFinite(value) ? { kind: 'number', value } : formulaErrorValue('#VALUE!');
}
