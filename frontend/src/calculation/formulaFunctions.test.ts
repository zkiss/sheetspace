import { describe, expect, it, vi } from 'vitest';
import {
  evaluateFunctionCall,
  type EagerFormulaFunction,
  type FormulaFunctionDefinition,
  type FormulaFunctionRegistry,
  type LazyFormulaFunction,
} from '@calculation/formulaFunctions';
import { parseFormula, type FormulaExpression, type FunctionFormula } from '@workbook/formula/syntax';
import { formulaDiagnostic, formulaScalarValue, type FormulaValue } from '@calculation/formulaValue';
import { conditionalAggregateFunctions } from '@calculation/formulaConditionalAggregates';

describe('formula function protocol', () => {
  it('explains missing injected reference resolution and bare eager failures', () => {
    const context = { evaluateExpression: () => ({ kind: 'error' as const, error: '#REF!' as const }) };
    expect(formulaDiagnostic(evaluateFunctionCall(functionExpression('=COUNTIF(@A[1],1)'), context, conditionalAggregateFunctions))?.message).toBe('Cannot resolve criteria reference.');
    expect(formulaDiagnostic(evaluateFunctionCall(functionExpression('=SUMIF(@A[1],1)'), context, conditionalAggregateFunctions))?.message).toBe('Cannot resolve criteria reference.');
    const multiple = evaluateFunctionCall(functionExpression('=TEST(1,2)'), context, registry('TEST', eager({ min: 2 }, vi.fn())));
    expect(formulaDiagnostic(multiple)).toMatchObject({ causes: [{ message: '#REF!' }, { message: '#REF!' }] });
  });

  it('explains bare errors from injected conditional aggregate references', () => {
    const expression = functionExpression('=SUMIF(@A[1]:A[2],1,@B[1]:B[2])');
    const error = { kind: 'error' as const, error: '#REF!' as const };
    const evaluateExpression = () => ({ kind: 'number' as const, value: 1 });
    const unresolved = evaluateFunctionCall(expression, {
      evaluateExpression,
      evaluateReferenceArgument: (() => {
        let calls = 0;
        return () => ++calls === 1
          ? { ok: true as const, value: { values: [], rowCount: 2, columnCount: 1 } }
          : { ok: false as const, error: '#REF!' as const };
      })(),
    }, conditionalAggregateFunctions);
    expect(formulaDiagnostic(unresolved)?.message).toBe('Cannot resolve sum reference.');
    const failures = evaluateFunctionCall(functionExpression('=COUNTIF(@A[1]:A[2],1)'), {
      evaluateExpression,
      evaluateReferenceArgument: () => ({ ok: true, value: { values: [error, error], rowCount: 2, columnCount: 1 } }),
    }, conditionalAggregateFunctions);
    expect(formulaDiagnostic(failures)).toMatchObject({ message: 'Multiple criteria cells failed.', causes: [{ message: '#REF!' }, { message: '#REF!' }] });
  });
  it('evaluates eager arguments left to right and returns the first error', () => {
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
    expect(visited).toEqual([1, 2, 3]);
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
      functionExpression('=ONE(@A[1]:A[2])'),
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

  it('materializes collection arguments in order and retains the first error code', () => {
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
      functionExpression('=TEST(@A[1]:C[1])'),
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
    expect(visited).toEqual(['A1', 'B1', 'C1']);
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
