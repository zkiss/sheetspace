import { describe, expect, it, vi } from 'vitest';
import {
  evaluateFunctionCall,
  type EagerFormulaFunction,
  type FormulaFunctionDefinition,
  type FormulaFunctionRegistry,
  type LazyFormulaFunction,
} from './formulaFunctions';
import { parseFormula, type FormulaExpression, type FunctionFormula } from './workbook/formula/syntax';
import { formulaScalarValue, type FormulaValue } from './formulaValue';

describe('formula function protocol', () => {
  it('evaluates eager arguments left to right and stops at the first error', () => {
    const invoke = vi.fn();
    const expression = functionExpression('=TEST(1, 2, 3)');
    const visited: number[] = [];
    const result = evaluateFunctionCall(
      expression,
      {
        evaluateExpression: (argument) => {
          const value = numberExpressionValue(argument);
          visited.push(value);
          return value === 2
            ? { kind: 'error', error: '#DIV/0!' }
            : { kind: 'number', value };
        },
      },
      registry('TEST', eager({ min: 0 }, invoke)),
    );

    expect(result).toEqual({ kind: 'error', error: '#DIV/0!' });
    expect(visited).toEqual([1, 2]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('validates function name, arity, and scalar form before evaluating arguments', () => {
    const evaluateExpression = vi.fn<() => FormulaValue>(() => ({ kind: 'number', value: 1 }));
    const oneScalar = eager({ min: 1, max: 1 }, vi.fn(), 'scalar');

    expect(evaluateFunctionCall(
      functionExpression('=MISSING(1)'),
      { evaluateExpression },
      registry('ONE', oneScalar),
    )).toEqual({ kind: 'error', error: '#NAME!' });
    expect(evaluateFunctionCall(
      functionExpression('=ONE(1, 2)'),
      { evaluateExpression },
      registry('ONE', oneScalar),
    )).toEqual({ kind: 'error', error: '#VALUE!' });
    expect(evaluateFunctionCall(
      functionExpression('=ONE(A1:A2)'),
      { evaluateExpression },
      registry('ONE', oneScalar),
    )).toEqual({ kind: 'error', error: '#VALUE!' });
    expect(evaluateExpression).not.toHaveBeenCalled();
  });

  it('lets lazy functions choose which argument expression to evaluate', () => {
    const lazy: LazyFormulaFunction = {
      evaluation: 'lazy',
      arity: { min: 2, max: 2 },
      argumentKind: () => 'scalar',
      invoke: (arguments_, context) => formulaScalarValue(
        context.evaluateArgument(arguments_[0], 'scalar'),
      ),
    };
    const visited: number[] = [];
    const result = evaluateFunctionCall(
      functionExpression('=FIRST(7, 9)'),
      {
        evaluateExpression: (argument) => {
          const value = numberExpressionValue(argument);
          visited.push(value);
          return value === 9
            ? { kind: 'error', error: '#DIV/0!' }
            : { kind: 'number', value };
        },
      },
      registry('FIRST', lazy),
    );

    expect(result).toEqual({ kind: 'number', value: 7 });
    expect(visited).toEqual([7]);
  });

  it('materializes collection arguments in order and propagates the first cell error', () => {
    const invoke = vi.fn();
    const visited: string[] = [];
    const values = function* () {
      visited.push('A1');
      yield { kind: 'number' as const, value: 1 };
      visited.push('B1');
      yield { kind: 'error' as const, error: '#REF!' as const };
      visited.push('C1');
      yield { kind: 'error' as const, error: '#DIV/0!' as const };
    };
    const result = evaluateFunctionCall(
      functionExpression('=TEST(A1:C1)'),
      {
        evaluateExpression: () => ({
          kind: 'range',
          values: values(),
          rowCount: 1,
          columnCount: 3,
        }),
      },
      registry('TEST', eager({ min: 1 }, invoke)),
    );

    expect(result).toEqual({ kind: 'error', error: '#REF!' });
    expect(visited).toEqual(['A1', 'B1']);
    expect(invoke).not.toHaveBeenCalled();
  });
});

function functionExpression(raw: string): FunctionFormula {
  const parsed = parseFormula(raw);
  if (parsed.kind !== 'formula' || parsed.expression.kind !== 'function') {
    throw new Error(`Expected function expression for ${raw}`);
  }
  return parsed.expression;
}

function numberExpressionValue(expression: FormulaExpression): number {
  if (expression.kind !== 'number') {
    throw new Error('Expected number expression');
  }
  return expression.value;
}

function registry(
  name: string,
  definition: FormulaFunctionDefinition,
): FormulaFunctionRegistry {
  return new Map([[name, definition]]);
}

function eager(
  arity: { min: number; max?: number },
  invoke: EagerFormulaFunction['invoke'],
  argumentKind: 'scalar' | 'collection' = 'collection',
): EagerFormulaFunction {
  return {
    evaluation: 'eager',
    arity,
    argumentKind: () => argumentKind,
    invoke,
  };
}
