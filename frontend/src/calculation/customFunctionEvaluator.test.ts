import { describe, expect, it } from 'vitest';
import { evaluateFormulaCells, evaluateStoredFormulaCells, FormulaEvaluator } from './formulaEvaluator';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import type { CustomFunction, ModelColumnType } from '@workbook/core/model';

const definition = (name: string, body: string, parameters: [string, ModelColumnType][] = []): CustomFunction => ({ name, body, parameters: parameters.map(([name, type]) => ({ name, type })) });
function evaluator(functions: CustomFunction[]) {
  const first = sheetDocument({ id: 'first', name: 'First', cells: { A1: '7' } });
  const second = sheetDocument({ id: 'second', name: 'Second', cells: { A1: '10' } });
  return new FormulaEvaluator(calculationProjection({ ...workbookWithSheets([first, second]), functions }));
}
const number = (value: number) => ({ kind: 'number', value });
const error = (error: string) => ({ kind: 'error', error });

describe('custom function evaluation', () => {
  it('evaluates nested calls, expressions, references and arbitrary argument counts', () => {
    const many = Array.from({ length: 50 }, (_, i): [string, ModelColumnType] => [`p${i}`, 'int']);
    const engine = evaluator([definition('fibonacci', '=SUM(a,b)', [['a', 'int'], ['b', 'int']]), definition('zero', '=3'), definition('many', '=p49', many)]);
    expect(engine.evaluateExpressionContent('=fibonacci(3,5)', 'first')).toEqual(number(8));
    expect(engine.evaluateExpressionContent('=FIBONACCI(SUM(1,2),@A[1])', 'first')).toEqual(number(10));
    expect(engine.evaluateExpressionContent('=zero()', 'first')).toEqual(number(3));
    expect(engine.evaluateExpressionContent(`=many(${many.map((_, i) => i).join(',')})`, 'first')).toEqual(number(49));
  });
  it('validates used arguments according to declared types and preserves errors', () => {
    const engine = evaluator((['int', 'float', 'string', 'boolean'] as ModelColumnType[]).map((type) => definition(type, '=x', [['x', type]])));
    expect(engine.evaluateExpressionContent('=int(1.5)', 'first')).toEqual(error('#VALUE!'));
    expect(engine.evaluateExpressionContent('=float(1.5)', 'first')).toEqual(number(1.5));
    expect(engine.evaluateExpressionContent('=string("x")', 'first')).toEqual({ kind: 'text', value: 'x' });
    expect(engine.evaluateExpressionContent('=boolean(TRUE)', 'first')).toEqual({ kind: 'boolean', value: true });
    expect(engine.evaluateExpressionContent('=string(1)', 'first')).toEqual(error('#VALUE!'));
    expect(engine.evaluateExpressionContent('=boolean(1)', 'first')).toEqual(error('#VALUE!'));
    expect(engine.evaluateExpressionContent('=int(1/0)', 'first')).toEqual(error('#DIV/0!'));
    expect(engine.evaluateExpressionContent('=int()', 'first')).toEqual(error('#VALUE!'));
  });
  it('preserves lexical contexts and evaluates only demanded arguments', () => {
    const engine = evaluator([definition('inc', '=x+1', [['x', 'int']]), definition('outer', '=inner(x+1)', [['x', 'int']]), definition('inner', '=x*2', [['x', 'int']]), definition('choose', '=IF(flag,x,42)', [['flag', 'boolean'], ['x', 'int']])]);
    expect(engine.evaluateExpressionContent('=inc(inc(1))', 'first')).toEqual(number(3));
    expect(engine.evaluateExpressionContent('=outer(2*3)', 'first')).toEqual(number(14));
    expect(engine.evaluateExpressionContent('=choose(FALSE,1/0)', 'first')).toEqual(number(42));
    expect(engine.evaluateExpressionContent('=choose(FALSE,"wrong type")', 'first')).toEqual(number(42));
    expect(engine.evaluateExpressionContent('=choose(TRUE,1/0)', 'first')).toEqual(error('#DIV/0!'));
  });
  it('handles unknown, invalid and recursive bodies without traversing unused branches', () => {
    const engine = evaluator([definition('forward', '=later()'), definition('later', '=9'), definition('bad', '=SUM('), definition('self', '=self()'), definition('one', '=two()'), definition('two', '=one()'), definition('safe', '=IF(FALSE,safe(),4)'), definition('quoted', '="x"', [['x', 'int']])]);
    expect(engine.evaluateExpressionContent('=forward()', 'first')).toEqual(number(9));
    expect(engine.evaluateExpressionContent('=missing()', 'first')).toEqual(error('#NAME!'));
    expect(engine.evaluateExpressionContent('=bad()', 'first')).toEqual(error('#PARSE!'));
    expect(engine.evaluateExpressionContent('=self()', 'first')).toEqual(error('#CYCLE!'));
    expect(engine.evaluateExpressionContent('=one()', 'first')).toEqual(error('#CYCLE!'));
    expect(engine.evaluateExpressionContent('=safe()', 'first')).toEqual(number(4));
    expect(engine.evaluateExpressionContent('=quoted(1/0)', 'first')).toEqual({ kind: 'text', value: 'x' });
    expect(evaluator([definition('bad', '=unknownIdentifier')]).evaluateExpressionContent('=bad()', 'first')).toEqual(error('#PARSE!'));
    expect(evaluator([definition('bad', 'plain')]).evaluateExpressionContent('=bad()', 'first')).toEqual(error('#PARSE!'));
    expect(evaluator([definition('bad', '=2')]).evaluateExpressionContent('=bad()', 'first')).toEqual(number(2));
    expect(evaluator([definition('forward', '=later()')]).evaluateExpressionContent('=forward()', 'first')).toEqual(error('#NAME!'));
  });
  it('resolves body references in the caller sheet and explicit sheet', () => {
    const engine = evaluator([definition('refs', '=@A[1]+@Second!A[1]')]);
    expect(engine.evaluateExpressionContent('=refs()', 'first')).toEqual(number(17));
    expect(engine.evaluateExpressionContent('=refs()', 'second')).toEqual(number(20));
  });
  it('preserves reference identity through nested typed parameters to reference builtins', () => {
    const engine = evaluator([definition('mycount', '=COUNTIF(x,7)', [['x', 'int']]), definition('outer', '=mycount(y)', [['y', 'int']])]);
    expect(engine.evaluateExpressionContent('=COUNTIF(@second!A[1],7)', 'first')).toEqual(number(0));
    expect(engine.evaluateExpressionContent('=outer(@A[1])', 'first')).toEqual(number(1));
    expect(engine.evaluateExpressionContent('=outer(@second!A[1])', 'first')).toEqual(number(0));
    expect(engine.evaluateExpressionContent('=outer(7)', 'first')).toEqual(error('#VALUE!'));
    expect(evaluator([definition('counttext', '=COUNTIF(x,7)', [['x', 'string']])]).evaluateExpressionContent('=counttext(@A[1])', 'first')).toEqual(error('#VALUE!'));
  });
  it('validates reference values only when conditional aggregates consume them', () => {
    const sheet = sheetDocument({ id: 'first', name: 'First', cells: { A1: '7', A2: '8', B1: '=1/0', B2: '4', C1: 'wrong', C2: '2' } });
    const functions = [definition('sumref', '=SUMIF(@A[1],99,x)', [['x', 'int']]), definition('countref', '=COUNTIF(x,">0")', [['x', 'int']]), definition('sumrange', '=SUMIF(@A[1]:A[2],">0",x)', [['x', 'int']]), definition('outer', '=countref(y)', [['y', 'int']]), definition('outerstring', '=countref(y)', [['y', 'string']])];
    const engine = new FormulaEvaluator(calculationProjection({ ...workbookWithSheets([sheet]), functions }));
    expect(engine.evaluateExpressionContent('=sumref(@B[1])', 'first')).toEqual(number(0));
    expect(engine.evaluateExpressionContent('=countref(@A[1]:A[2])', 'first')).toEqual(number(2));
    expect(engine.evaluateExpressionContent('=outer(@A[1]:A[2])', 'first')).toEqual(number(2));
    expect(engine.evaluateExpressionContent('=sumrange(@A[1]:A[2])', 'first')).toEqual(number(15));
    expect(engine.evaluateExpressionContent('=countref(@C[1]:C[2])', 'first')).toEqual(error('#VALUE!'));
    expect(engine.evaluateExpressionContent('=outerstring(@A[1]:A[2])', 'first')).toEqual(error('#VALUE!'));
    expect(engine.evaluateExpressionContent('=sumrange(@B[1]:B[2])', 'first')).toEqual(error('#DIV/0!'));
  });
  it('evaluates normal and stored formula cell entry points', () => {
    const sheet = sheetDocument({ id: 'first', name: 'First', cells: { A1: '=fibonacci(3,5)' } });
    const workbook = { ...workbookWithSheets([sheet]), functions: [definition('fibonacci', '=SUM(a,b)', [['a', 'int'], ['b', 'int']])] };
    const projection = calculationProjection(workbook);
    expect(evaluateFormulaCells(projection).first.A1).toMatchObject(number(8));
    expect(evaluateStoredFormulaCells(projection, workbook).first.A1).toMatchObject(number(8));
    expect(evaluateStoredFormulaCells({ sheets: projection.sheets }, workbook).first.A1).toMatchObject(number(8));
  });
  it('does not mistake another cell calling the same function for recursion', () => {
    const sheet = sheetDocument({ id: 'first', name: 'First', cells: { A1: '=inc(@A[2])', A2: '=inc(1)' } });
    const workbook = { ...workbookWithSheets([sheet]), functions: [definition('inc', '=x+1', [['x', 'int']])] };
    expect(evaluateFormulaCells(calculationProjection(workbook)).first.A1).toMatchObject(number(3));
  });
});
